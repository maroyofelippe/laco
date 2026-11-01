import 'dart:io';

import 'package:dio/dio.dart';

import '../api/api_client.dart';
import '../api/api_exception.dart';
import '../data/lookups_repository.dart';
import '../data/models.dart';
import '../data/transactions_repository.dart';
import '../db/local_db.dart';
import 'outbox.dart';

class SyncResult {
  const SyncResult({this.pushed = 0, this.failed = 0, this.pulled = 0, this.offline = false, this.error});
  final int pushed;
  final int failed;
  final int pulled;
  final bool offline;
  final String? error;
}

/// Sincronização: 1) envia a fila (na ordem, com Idempotency-Key); 2) busca o que mudou
/// no servidor desde o último cursor e atualiza o banco local.
class SyncEngine {
  SyncEngine({required this.api, required this.db, required this.outbox, required this.txns, required this.lookups});

  final ApiClient api;
  final LocalDb db;
  final Outbox outbox;
  final TransactionsRepository txns;
  final LookupsRepository lookups;
  Future<SyncResult>? _running;

  /// Chamadas concorrentes reaproveitam a sincronização em andamento.
  Future<SyncResult> sync(String familyId) => _running ??= _sync(familyId).whenComplete(() => _running = null);

  Future<SyncResult> _sync(String familyId) async {
    var pushed = 0;
    var failed = 0;
    for (final e in await outbox.list(status: 'PENDING')) {
      try {
        await _send(e);
        pushed++;
      } on ApiException catch (err) {
        if (err.isNetwork) return SyncResult(pushed: pushed, failed: failed, offline: true, error: err.message);
        if (err.isPermanent) {
          failed++;
          await outbox.markFailed(e.id, err.userMessage);
          await _onPermanentFailure(e, err);
        } else {
          await outbox.bumpAttempt(e.id, err.userMessage);
          return SyncResult(pushed: pushed, failed: failed, error: err.message); // 5xx/429: tenta mais tarde
        }
      } on FileSystemException {
        failed++;
        await outbox.markFailed(e.id, 'A foto não está mais no aparelho.');
      }
    }
    try {
      final pulled = await pull(familyId);
      return SyncResult(pushed: pushed, failed: failed, pulled: pulled);
    } on ApiException catch (err) {
      return SyncResult(pushed: pushed, failed: failed, offline: err.isNetwork, error: err.message);
    }
  }

  Future<void> _send(OutboxEntry e) async {
    final headers = {...?e.headers, 'Idempotency-Key': e.id};
    if (e.kind == 'ATTACHMENT') {
      final form = FormData.fromMap({'file': await MultipartFile.fromFile(e.filePath!, filename: 'nota.jpg')});
      await api.upload<dynamic>(e.path, form);
      await outbox.remove(e.id);
      try {
        await File(e.filePath!).delete();
      } catch (_) {}
      return;
    }
    final res = await api.send(e.method, e.path, body: e.body, headers: headers);
    await outbox.remove(e.id);
    switch (e.kind) {
      case 'TX_CREATE':
      case 'TX_UPDATE':
        if (res is Map && res['id'] != null) await txns.upsertLocal(e.familyId, Txn.fromApi(Map<String, dynamic>.from(res)));
      case 'TX_INSTALLMENTS':
        await txns.deletePendingPlaceholders(e.localTxId!);
        if (res is Map && res['transactions'] is List) {
          for (final t in (res['transactions'] as List).whereType<Map>()) {
            await txns.upsertLocal(e.familyId, Txn.fromApi(Map<String, dynamic>.from(t)));
          }
        }
      default:
        break;
    }
  }

  /// Recusa definitiva (dados inválidos, conflito, sem permissão): o aparelho volta a
  /// refletir o servidor e o item fica na fila como "não enviado", com o motivo.
  Future<void> _onPermanentFailure(OutboxEntry e, ApiException err) async {
    final id = e.localTxId;
    if (id == null) return;
    switch (e.kind) {
      case 'TX_CREATE':
        final t = await txns.get(id);
        if (t != null) await txns.upsertLocal(e.familyId, t.copyWith(syncError: err.userMessage));
      case 'TX_INSTALLMENTS':
        await txns.deletePendingPlaceholders(id);
      case 'TX_UPDATE':
      case 'TX_DELETE':
        try {
          final fresh = await api.get<Map<String, dynamic>>('/families/${e.familyId}/transactions/$id');
          await txns.upsertLocal(e.familyId, Txn.fromApi(fresh));
        } on ApiException catch (inner) {
          if (inner.status == 404) await txns.deleteLocal(id);
        }
      default:
        break;
    }
  }

  /// Busca mudanças desde o cursor (paginado). Edições locais ainda não enviadas têm prioridade.
  Future<int> pull(String familyId) async {
    final cursorKey = 'cursor:$familyId';
    var cursor = await db.getJson(cursorKey) as String?;
    final firstSync = cursor == null;
    var total = 0;
    for (var page = 0; page < 40; page++) {
      final res = await api.get<Map<String, dynamic>>('/families/$familyId/sync/changes', query: {'since': cursor, 'limit': 500});
      final list = (res['transactions'] as List? ?? const []).whereType<Map>().map((m) => Map<String, dynamic>.from(m)).toList();
      final pendingIds = (await db.db.query('transactions', columns: ['id'], where: 'pending = 1')).map((r) => r['id'] as String).toSet();
      await db.db.transaction((tx) async {
        for (final j in list) {
          final id = '${j['id']}';
          if (pendingIds.contains(id)) continue;
          if (j['deleted'] == true) {
            await txns.deleteLocal(id, exec: tx);
          } else {
            await txns.upsertLocal(familyId, Txn.fromApi(j), exec: tx);
          }
        }
      });
      total += list.length;
      List<Map<String, dynamic>> maps(String k) => (res[k] as List? ?? const []).whereType<Map>().map((m) => Map<String, dynamic>.from(m)).toList();
      await lookups.save(
        familyId,
        categories: maps('categories').map(Category.fromJson).toList(),
        cards: maps('cards').map(CardInfo.fromJson).toList(),
        accounts: maps('accounts').map(Account.fromJson).toList(),
        members: maps('members').map(Member.fromJson).toList(),
        replace: firstSync && page == 0,
      );
      cursor = res['cursor'] as String?;
      if (cursor != null) await db.putJson(cursorKey, cursor);
      if (res['hasMore'] != true) break;
    }
    await db.putJson('lastSync:$familyId', DateTime.now().toIso8601String());
    return total;
  }

  /// Recomeça do zero (ex.: troca de família ou "Baixar tudo de novo" nos ajustes).
  Future<void> resetFamily(String familyId) async {
    await db.db.delete('transactions', where: 'family_id = ? AND pending = 0', whereArgs: [familyId]);
    await db.deleteKey('cursor:$familyId');
  }
}
