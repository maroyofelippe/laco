import 'dart:convert';

import 'package:uuid/uuid.dart';

import '../db/local_db.dart';

/// Escrita aguardando envio. Cada uma tem sua Idempotency-Key (o próprio id):
/// reenviar depois de uma queda de conexão nunca duplica o lançamento.
class OutboxEntry {
  OutboxEntry({
    String? id,
    required this.familyId,
    required this.kind,
    required this.method,
    required this.path,
    required this.label,
    this.body,
    this.headers,
    this.filePath,
    this.localTxId,
    DateTime? createdAt,
    this.attempts = 0,
    this.status = 'PENDING',
    this.lastError,
  })  : id = id ?? const Uuid().v4(),
        createdAt = createdAt ?? DateTime.now();

  final String id;
  final String familyId;
  final String kind; // TX_CREATE | TX_INSTALLMENTS | TX_UPDATE | TX_DELETE | RECURRENCE_CREATE | ATTACHMENT
  final String method;
  final String path;
  final String label; // texto para a pessoa: 'Lançamento "Padaria"'
  final Map<String, dynamic>? body;
  final Map<String, String>? headers;
  final String? filePath;
  final String? localTxId;
  final DateTime createdAt;
  final int attempts;
  final String status; // PENDING | FAILED
  final String? lastError;

  Map<String, Object?> toRow() => {
        'id': id, 'family_id': familyId, 'kind': kind, 'method': method, 'path': path, 'label': label,
        'body': body == null ? null : jsonEncode(body), 'headers': headers == null ? null : jsonEncode(headers),
        'file_path': filePath, 'local_tx_id': localTxId, 'created_at': createdAt.toIso8601String(),
        'attempts': attempts, 'status': status, 'last_error': lastError,
      };

  factory OutboxEntry.fromRow(Map<String, Object?> r) => OutboxEntry(
        id: r['id'] as String, familyId: r['family_id'] as String, kind: r['kind'] as String, method: r['method'] as String,
        path: r['path'] as String, label: r['label'] as String,
        body: r['body'] == null ? null : Map<String, dynamic>.from(jsonDecode(r['body'] as String) as Map),
        headers: r['headers'] == null ? null : Map<String, String>.from(jsonDecode(r['headers'] as String) as Map),
        filePath: r['file_path'] as String?, localTxId: r['local_tx_id'] as String?, createdAt: DateTime.parse(r['created_at'] as String),
        attempts: (r['attempts'] as int?) ?? 0, status: r['status'] as String, lastError: r['last_error'] as String?,
      );
}

class Outbox {
  Outbox(this._db);
  final LocalDb _db;

  Future<void> add(OutboxEntry e) => _db.db.insert('outbox', e.toRow());

  Future<List<OutboxEntry>> list({String? familyId, String? status}) async {
    final where = <String>[];
    final args = <Object?>[];
    if (familyId != null) {
      where.add('family_id = ?');
      args.add(familyId);
    }
    if (status != null) {
      where.add('status = ?');
      args.add(status);
    }
    final rows = await _db.db.query('outbox', where: where.isEmpty ? null : where.join(' AND '), whereArgs: args, orderBy: 'created_at');
    return rows.map(OutboxEntry.fromRow).toList();
  }

  Future<OutboxEntry?> pendingCreateFor(String localTxId) async {
    final rows = await _db.db.query('outbox', where: "local_tx_id = ? AND kind = 'TX_CREATE' AND status = 'PENDING'", whereArgs: [localTxId], limit: 1);
    return rows.isEmpty ? null : OutboxEntry.fromRow(rows.first);
  }

  Future<void> updateBody(String id, Map<String, dynamic> body) => _db.db.update('outbox', {'body': jsonEncode(body)}, where: 'id = ?', whereArgs: [id]);

  Future<void> remove(String id) => _db.db.delete('outbox', where: 'id = ?', whereArgs: [id]);

  Future<void> markFailed(String id, String error) =>
      _db.db.rawUpdate("UPDATE outbox SET status = 'FAILED', last_error = ?, attempts = attempts + 1 WHERE id = ?", [error, id]);

  Future<void> bumpAttempt(String id, String error) => _db.db.rawUpdate('UPDATE outbox SET attempts = attempts + 1, last_error = ? WHERE id = ?', [error, id]);

  Future<void> retry(String id) => _db.db.rawUpdate("UPDATE outbox SET status = 'PENDING', last_error = NULL WHERE id = ?", [id]);

  Future<int> count({String? status}) async {
    final r = await _db.db.rawQuery(status == null ? 'SELECT COUNT(*) AS n FROM outbox' : 'SELECT COUNT(*) AS n FROM outbox WHERE status = ?', status == null ? null : [status]);
    return (r.first['n'] as int?) ?? 0;
  }
}
