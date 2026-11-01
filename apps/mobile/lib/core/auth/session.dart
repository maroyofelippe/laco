import 'dart:convert';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api/api_exception.dart';
import '../data/models.dart';
import '../providers.dart';

class SessionState {
  const SessionState({this.user, this.families = const [], this.familyId});
  final UserInfo? user;
  final List<FamilyRef> families;
  final String? familyId;

  bool get loggedIn => user != null;
  FamilyRef? get family => familyId == null ? null : families.where((f) => f.id == familyId).firstOrNull;

  SessionState copyWith({UserInfo? user, List<FamilyRef>? families, String? familyId, bool clearFamily = false}) =>
      SessionState(user: user ?? this.user, families: families ?? this.families, familyId: clearFamily ? null : (familyId ?? this.familyId));
}

/// Sessão: login/cadastro, famílias da pessoa e família ativa no app.
class SessionController extends AsyncNotifier<SessionState> {
  static const _kFamilies = 'session.families';
  static const _kFamilyId = 'session.familyId';
  static const _kLastUser = 'session.lastUserId';

  @override
  Future<SessionState> build() async {
    final tokens = ref.read(tokenStoreProvider);
    if (!await tokens.hasSession()) return const SessionState();
    final userJson = await tokens.user();
    if (userJson == null) return const SessionState();
    final prefs = ref.read(prefsProvider);
    final cached = prefs.getString(_kFamilies);
    var families = cached == null ? <FamilyRef>[] : (jsonDecode(cached) as List).map((e) => FamilyRef.fromJson(Map<String, dynamic>.from(e as Map))).toList();
    try {
      families = await _fetchFamilies();
    } on ApiException catch (e) {
      if (e.isUnauthorized) return const SessionState(); // sessão expirou
      // Sem conexão: segue com a lista guardada
    }
    return SessionState(user: UserInfo.fromJson(userJson), families: families, familyId: _pickFamily(families, prefs.getString(_kFamilyId)));
  }

  String? _pickFamily(List<FamilyRef> families, String? saved) {
    if (saved != null && families.any((f) => f.id == saved)) return saved;
    return families.length == 1 ? families.first.id : null;
  }

  Future<List<FamilyRef>> _fetchFamilies() async {
    final list = await ref.read(apiClientProvider).get<List<dynamic>>('/me/families');
    final families = list.whereType<Map>().map((e) => FamilyRef.fromJson(Map<String, dynamic>.from(e))).toList();
    await ref.read(prefsProvider).setString(_kFamilies, jsonEncode(families.map((f) => f.toJson()).toList()));
    return families;
  }

  Future<void> _startSession(Map<String, dynamic> res) async {
    final tokens = ref.read(tokenStoreProvider);
    final prefs = ref.read(prefsProvider);
    final user = UserInfo.fromJson(Map<String, dynamic>.from(res['user'] as Map));
    // Outra pessoa entrando neste aparelho: apaga os dados locais da anterior
    if (prefs.getString(_kLastUser) != null && prefs.getString(_kLastUser) != user.id) {
      await ref.read(localDbProvider).wipe();
      await prefs.remove(_kFamilyId);
    }
    await prefs.setString(_kLastUser, user.id);
    await tokens.saveTokens(access: res['accessToken'] as String, refresh: res['refreshToken'] as String, expiresIn: (res['accessTokenExpiresIn'] as num).toInt());
    await tokens.saveUser(user.toJson());
    final families = (res['families'] as List? ?? const []).whereType<Map>().map((e) => FamilyRef.fromJson(Map<String, dynamic>.from(e))).toList();
    await prefs.setString(_kFamilies, jsonEncode(families.map((f) => f.toJson()).toList()));
    state = AsyncData(SessionState(user: user, families: families, familyId: _pickFamily(families, prefs.getString(_kFamilyId))));
  }

  Future<void> login(String email, String password) async {
    final res = await ref.read(apiClientProvider).post<Map<String, dynamic>>('/auth/login', body: {'email': email.trim(), 'password': password, 'client': 'ANDROID'});
    await _startSession(res);
  }

  Future<void> register(String name, String email, String password) async {
    final res = await ref.read(apiClientProvider).post<Map<String, dynamic>>('/auth/register', body: {'name': name.trim(), 'email': email.trim(), 'password': password, 'client': 'ANDROID'});
    await _startSession(res);
  }

  Future<void> selectFamily(String familyId) async {
    await ref.read(prefsProvider).setString(_kFamilyId, familyId);
    final current = state.valueOrNull ?? const SessionState();
    state = AsyncData(current.copyWith(familyId: familyId));
  }

  Future<void> refreshFamilies() async {
    final current = state.valueOrNull;
    if (current == null || !current.loggedIn) return;
    final families = await _fetchFamilies();
    state = AsyncData(current.copyWith(families: families, familyId: _pickFamily(families, current.familyId)));
  }

  Future<FamilyRef> acceptInvite(String token) async {
    final res = await ref.read(apiClientProvider).post<Map<String, dynamic>>('/invitations/accept', body: {'token': token.trim()});
    final fam = FamilyRef.fromJson(res);
    await refreshFamilies();
    await selectFamily(fam.id);
    return fam;
  }

  Future<FamilyRef> createFamily(String name) async {
    final res = await ref.read(apiClientProvider).post<Map<String, dynamic>>('/families', body: {'name': name.trim()});
    final fam = FamilyRef.fromJson(res);
    await refreshFamilies();
    await selectFamily(fam.id);
    return fam;
  }

  Future<void> logout() async {
    final tokens = ref.read(tokenStoreProvider);
    final rt = await tokens.refreshToken();
    if (rt != null) {
      try {
        await ref.read(apiClientProvider).post<dynamic>('/auth/logout', body: {'refreshToken': rt});
      } catch (_) {}
    }
    await tokens.clear();
    await ref.read(localDbProvider).wipe();
    final prefs = ref.read(prefsProvider);
    await prefs.remove(_kFamilies);
    await prefs.remove(_kFamilyId);
    await prefs.remove(_kLastUser);
    state = const AsyncData(SessionState());
  }

  /// Refresh token recusado pela API: volta ao login (os dados locais ficam até outro login).
  void expire() {
    ref.read(tokenStoreProvider).clear();
    state = const AsyncData(SessionState());
  }
}
