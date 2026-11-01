import 'dart:async';

import 'package:dio/dio.dart';

import '../auth/token_store.dart';
import '../config.dart';
import 'api_exception.dart';

/// Cliente HTTP da API do Laço.
/// - Anexa o access token; ao receber 401, renova UMA vez com o refresh token (rotação) e repete.
/// - Pedidos simultâneos esperam a mesma renovação (sem gastar o refresh token duas vezes).
/// - Erros viram [ApiException] com mensagem amigável.
class ApiClient {
  ApiClient(this._tokens, {this.onSessionExpired}) {
    _dio = Dio(BaseOptions(
      baseUrl: AppConfig.apiUrl,
      connectTimeout: const Duration(seconds: 10),
      receiveTimeout: const Duration(seconds: 45),
      sendTimeout: const Duration(seconds: 60),
      headers: {'Accept': 'application/json'},
    ));
    _dio.interceptors.add(QueuedInterceptorsWrapper(
      onRequest: (options, handler) async {
        final token = await _tokens.accessToken();
        if (token != null && !options.path.startsWith('/auth/')) options.headers['Authorization'] = 'Bearer $token';
        handler.next(options);
      },
      onError: (e, handler) async {
        final req = e.requestOptions;
        final isAuthCall = req.path.startsWith('/auth/');
        if (e.response?.statusCode == 401 && !isAuthCall && req.extra['retried'] != true) {
          final ok = await _refresh();
          if (ok) {
            req.extra['retried'] = true;
            req.headers['Authorization'] = 'Bearer ${await _tokens.accessToken()}';
            try {
              return handler.resolve(await _dio.fetch(req));
            } on DioException catch (again) {
              return handler.next(again);
            }
          }
          onSessionExpired?.call();
        }
        handler.next(e);
      },
    ));
  }

  final TokenStore _tokens;
  final void Function()? onSessionExpired;
  late final Dio _dio;
  Completer<bool>? _refreshing;

  Future<bool> _refresh() async {
    if (_refreshing != null) return _refreshing!.future;
    final c = Completer<bool>();
    _refreshing = c;
    try {
      final rt = await _tokens.refreshToken();
      if (rt == null) {
        c.complete(false);
      } else {
        // Dio separado: a renovação não passa pelos interceptors (evita laço)
        final res = await Dio(BaseOptions(baseUrl: AppConfig.apiUrl, connectTimeout: const Duration(seconds: 10)))
            .post<Map<String, dynamic>>('/auth/refresh', data: {'refreshToken': rt});
        final d = res.data!;
        await _tokens.saveTokens(access: d['accessToken'] as String, refresh: d['refreshToken'] as String, expiresIn: (d['accessTokenExpiresIn'] as num).toInt());
        c.complete(true);
      }
    } on DioException catch (e) {
      // Sem rede: mantém a sessão (tenta de novo depois). Refresh recusado: encerra.
      final network = e.response == null;
      if (!network) await _tokens.clear();
      c.complete(false);
    } catch (_) {
      c.complete(false);
    } finally {
      _refreshing = null;
    }
    return c.future;
  }

  Future<T> _wrap<T>(Future<Response<dynamic>> Function() call) async {
    try {
      final res = await call();
      return res.data as T;
    } on DioException catch (e) {
      throw ApiException.fromDio(e);
    }
  }

  Map<String, dynamic> _q(Map<String, Object?>? q) =>
      {for (final e in (q ?? const <String, Object?>{}).entries) if (e.value != null && '${e.value}'.isNotEmpty) e.key: e.value};

  Future<T> get<T>(String path, {Map<String, Object?>? query}) => _wrap<T>(() => _dio.get<dynamic>(path, queryParameters: _q(query)));

  Future<T> post<T>(String path, {Object? body, Map<String, String>? headers, void Function(int, int)? onSendProgress}) =>
      _wrap<T>(() => _dio.post<dynamic>(path, data: body, options: Options(headers: headers), onSendProgress: onSendProgress));

  Future<T> patch<T>(String path, {Object? body, Map<String, String>? headers, Map<String, Object?>? query}) =>
      _wrap<T>(() => _dio.patch<dynamic>(path, data: body, queryParameters: _q(query), options: Options(headers: headers)));

  Future<T> put<T>(String path, {Object? body, Map<String, Object?>? query}) =>
      _wrap<T>(() => _dio.put<dynamic>(path, data: body, queryParameters: _q(query)));

  Future<T> delete<T>(String path, {Map<String, Object?>? query, Map<String, String>? headers}) =>
      _wrap<T>(() => _dio.delete<dynamic>(path, queryParameters: _q(query), options: Options(headers: headers)));

  /// Requisição genérica usada pela fila offline (método e caminho guardados no banco local).
  Future<dynamic> send(String method, String path, {Object? body, Map<String, String>? headers, Map<String, Object?>? query}) =>
      _wrap<dynamic>(() => _dio.request<dynamic>(path, data: body, queryParameters: _q(query), options: Options(method: method, headers: headers)));

  Future<T> upload<T>(String path, FormData form, {void Function(int, int)? onSendProgress}) =>
      _wrap<T>(() => _dio.post<dynamic>(path, data: form, onSendProgress: onSendProgress));
}
