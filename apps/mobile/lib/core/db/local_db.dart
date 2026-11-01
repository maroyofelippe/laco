import 'dart:convert';

import 'package:path/path.dart' as p;
import 'package:sqflite/sqflite.dart';

/// Banco local (SQLite) para uso offline:
/// - transactions: cópia dos lançamentos visíveis, atualizada pela sincronização;
/// - outbox: fila de escritas feitas sem conexão, reenviadas com Idempotency-Key;
/// - kv: listas de apoio (categorias, contas...) e respostas em cache (painel, alertas).
class LocalDb {
  LocalDb._(this.db);
  final Database db;

  static Future<LocalDb> open() async {
    final path = p.join(await getDatabasesPath(), 'laco.db');
    final db = await openDatabase(
      path,
      version: 1,
      onCreate: (db, version) async {
        await db.execute('''
          CREATE TABLE transactions (
            id TEXT PRIMARY KEY,
            family_id TEXT NOT NULL,
            occurred_on TEXT NOT NULL,
            search TEXT NOT NULL,
            pending INTEGER NOT NULL DEFAULT 0,
            json TEXT NOT NULL
          )''');
        await db.execute('CREATE INDEX ix_tx_family_date ON transactions (family_id, occurred_on DESC)');
        await db.execute('''
          CREATE TABLE outbox (
            id TEXT PRIMARY KEY,
            family_id TEXT NOT NULL,
            kind TEXT NOT NULL,
            method TEXT NOT NULL,
            path TEXT NOT NULL,
            body TEXT,
            headers TEXT,
            file_path TEXT,
            local_tx_id TEXT,
            label TEXT NOT NULL,
            created_at TEXT NOT NULL,
            attempts INTEGER NOT NULL DEFAULT 0,
            status TEXT NOT NULL DEFAULT 'PENDING',
            last_error TEXT
          )''');
        await db.execute('CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)');
      },
    );
    return LocalDb._(db);
  }

  // ------------------------------------------------------------------ kv
  Future<void> putJson(String key, Object value) => db.insert(
        'kv',
        {'key': key, 'value': jsonEncode(value), 'updated_at': DateTime.now().toIso8601String()},
        conflictAlgorithm: ConflictAlgorithm.replace,
      );

  Future<dynamic> getJson(String key) async {
    final rows = await db.query('kv', where: 'key = ?', whereArgs: [key], limit: 1);
    return rows.isEmpty ? null : jsonDecode(rows.first['value'] as String);
  }

  Future<DateTime?> updatedAt(String key) async {
    final rows = await db.query('kv', columns: ['updated_at'], where: 'key = ?', whereArgs: [key], limit: 1);
    return rows.isEmpty ? null : DateTime.tryParse(rows.first['updated_at'] as String);
  }

  Future<void> deleteKey(String key) => db.delete('kv', where: 'key = ?', whereArgs: [key]);

  /// Ao sair da conta: nada de dados financeiros fica no aparelho.
  Future<void> wipe() async {
    await db.delete('transactions');
    await db.delete('outbox');
    await db.delete('kv');
  }
}
