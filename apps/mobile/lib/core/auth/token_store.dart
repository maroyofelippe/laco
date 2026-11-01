import 'dart:convert';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Tokens e dados da sessão no armazenamento seguro do Android (Keystore).
/// O app nunca guarda a senha.
class TokenStore {
  TokenStore([FlutterSecureStorage? storage]) : _s = storage ?? const FlutterSecureStorage();

  final FlutterSecureStorage _s;
  String? _accessCache;

  static const _kAccess = 'laco.access';
  static const _kRefresh = 'laco.refresh';
  static const _kExp = 'laco.accessExp';
  static const _kUser = 'laco.user';

  Future<String?> accessToken() async => _accessCache ??= await _s.read(key: _kAccess);
  Future<String?> refreshToken() => _s.read(key: _kRefresh);

  Future<void> saveTokens({required String access, required String refresh, required int expiresIn}) async {
    _accessCache = access;
    await _s.write(key: _kAccess, value: access);
    await _s.write(key: _kRefresh, value: refresh);
    await _s.write(key: _kExp, value: DateTime.now().add(Duration(seconds: expiresIn)).toIso8601String());
  }

  Future<void> saveUser(Map<String, dynamic> user) => _s.write(key: _kUser, value: jsonEncode(user));

  Future<Map<String, dynamic>?> user() async {
    final raw = await _s.read(key: _kUser);
    return raw == null ? null : jsonDecode(raw) as Map<String, dynamic>;
  }

  Future<bool> hasSession() async => (await refreshToken()) != null;

  Future<void> clear() async {
    _accessCache = null;
    await _s.delete(key: _kAccess);
    await _s.delete(key: _kRefresh);
    await _s.delete(key: _kExp);
    await _s.delete(key: _kUser);
  }
}
