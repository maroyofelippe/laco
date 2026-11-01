import 'dart:async';

import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'api/api_client.dart';
import 'auth/session.dart';
import 'auth/token_store.dart';
import 'data/lookups_repository.dart';
import 'data/models.dart';
import 'data/transactions_repository.dart';
import 'db/local_db.dart';
import 'sync/outbox.dart';
import 'sync/sync_engine.dart';

/// Inicializados no main() e injetados com overrideWithValue.
final prefsProvider = Provider<SharedPreferences>((ref) => throw UnimplementedError('prefsProvider'));
final localDbProvider = Provider<LocalDb>((ref) => throw UnimplementedError('localDbProvider'));

final tokenStoreProvider = Provider<TokenStore>((ref) => TokenStore());

final apiClientProvider = Provider<ApiClient>((ref) {
  return ApiClient(ref.watch(tokenStoreProvider), onSessionExpired: () => ref.read(sessionProvider.notifier).expire());
});

final outboxProvider = Provider<Outbox>((ref) => Outbox(ref.watch(localDbProvider)));
final lookupsRepositoryProvider = Provider<LookupsRepository>((ref) => LookupsRepository(ref.watch(localDbProvider)));
final transactionsRepositoryProvider = Provider<TransactionsRepository>(
  (ref) => TransactionsRepository(ref.watch(localDbProvider), ref.watch(outboxProvider), ref.watch(lookupsRepositoryProvider)),
);
final syncEngineProvider = Provider<SyncEngine>((ref) => SyncEngine(
      api: ref.watch(apiClientProvider),
      db: ref.watch(localDbProvider),
      outbox: ref.watch(outboxProvider),
      txns: ref.watch(transactionsRepositoryProvider),
      lookups: ref.watch(lookupsRepositoryProvider),
    ));

final sessionProvider = AsyncNotifierProvider<SessionController, SessionState>(SessionController.new);

final currentFamilyProvider = Provider<FamilyRef?>((ref) => ref.watch(sessionProvider).valueOrNull?.family);

/// Incrementado quando dados locais mudam (lançamento novo, sincronização): telas que leem
/// do banco local observam este valor para recarregar.
class DataVersion extends Notifier<int> {
  @override
  int build() => 0;
  void bump() => state++;
}

final dataVersionProvider = NotifierProvider<DataVersion, int>(DataVersion.new);

final lookupsProvider = FutureProvider<Lookups>((ref) async {
  ref.watch(dataVersionProvider);
  final fam = ref.watch(currentFamilyProvider);
  if (fam == null) return const Lookups();
  return ref.watch(lookupsRepositoryProvider).load(fam.id);
});

// ------------------------------------------------------------------ sincronização
class SyncStatus {
  const SyncStatus({this.running = false, this.offline = false, this.pending = 0, this.failed = 0, this.lastSync, this.lastError});
  final bool running;
  final bool offline;
  final int pending;
  final int failed;
  final DateTime? lastSync;
  final String? lastError;

  SyncStatus copyWith({bool? running, bool? offline, int? pending, int? failed, DateTime? lastSync, String? lastError, bool clearError = false}) => SyncStatus(
        running: running ?? this.running, offline: offline ?? this.offline, pending: pending ?? this.pending, failed: failed ?? this.failed,
        lastSync: lastSync ?? this.lastSync, lastError: clearError ? null : (lastError ?? this.lastError),
      );
}

class SyncController extends Notifier<SyncStatus> {
  Timer? _debounce;
  StreamSubscription<List<ConnectivityResult>>? _conn;

  @override
  SyncStatus build() {
    _conn = Connectivity().onConnectivityChanged.listen((results) {
      final online = results.any((r) => r != ConnectivityResult.none);
      if (online && state.offline) syncNow();
      state = state.copyWith(offline: !online);
    });
    ref.onDispose(() {
      _debounce?.cancel();
      _conn?.cancel();
    });
    Future.microtask(refreshCounts);
    return const SyncStatus();
  }

  Future<void> refreshCounts() async {
    final outbox = ref.read(outboxProvider);
    state = state.copyWith(pending: await outbox.count(status: 'PENDING'), failed: await outbox.count(status: 'FAILED'));
  }

  /// Depois de uma escrita local: agrupa e sincroniza em seguida.
  void syncSoon() {
    ref.read(dataVersionProvider.notifier).bump();
    refreshCounts();
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 800), syncNow);
  }

  Future<SyncResult?> syncNow() async {
    final fam = ref.read(currentFamilyProvider);
    if (fam == null || state.running) return null;
    state = state.copyWith(running: true);
    final r = await ref.read(syncEngineProvider).sync(fam.id);
    await refreshCounts();
    state = state.copyWith(running: false, offline: r.offline, lastSync: r.error == null ? DateTime.now() : state.lastSync, lastError: r.error, clearError: r.error == null);
    ref.read(dataVersionProvider.notifier).bump();
    return r;
  }
}

final syncProvider = NotifierProvider<SyncController, SyncStatus>(SyncController.new);
