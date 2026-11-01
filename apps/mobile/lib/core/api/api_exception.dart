import 'package:dio/dio.dart';

/// Erro da API (RFC 9457) ou de rede, com mensagem pronta para mostrar à pessoa.
class ApiException implements Exception {
  ApiException({required this.status, required this.code, required this.message, this.fieldErrors = const [], this.extra = const {}});

  final int status; // 0 = sem conexão
  final String code;
  final String message;
  final List<({String field, String message})> fieldErrors;
  final Map<String, dynamic> extra;

  bool get isNetwork => status == 0;
  bool get isUnauthorized => status == 401;

  /// Erros que não adianta reenviar (dados inválidos, sem permissão, conflito de versão...).
  bool get isPermanent => status >= 400 && status < 500 && status != 408 && status != 429 && code != 'IDEMPOTENCY_IN_PROGRESS';

  String get userMessage {
    if (fieldErrors.isEmpty) return message;
    return '$message: ${fieldErrors.map((e) => '${e.field} ${e.message}').join('; ')}';
  }

  factory ApiException.fromDio(DioException e) {
    final res = e.response;
    if (res == null || e.type == DioExceptionType.connectionError || e.type == DioExceptionType.connectionTimeout) {
      return ApiException(
        status: 0,
        code: 'NETWORK',
        message: 'Sem conexão com o servidor agora. O que você lançar fica guardado e é enviado depois.',
      );
    }
    if (e.type == DioExceptionType.receiveTimeout || e.type == DioExceptionType.sendTimeout) {
      return ApiException(status: 0, code: 'TIMEOUT', message: 'O servidor demorou para responder. Tente de novo em instantes.');
    }
    final data = res.data;
    if (data is Map) {
      final errors = (data['errors'] as List?)
              ?.whereType<Map>()
              .map((m) => (field: '${m['field']}', message: '${m['message']}'))
              .toList() ??
          const <({String field, String message})>[];
      return ApiException(
        status: res.statusCode ?? 500,
        code: '${data['code'] ?? 'ERROR'}',
        message: '${data['detail'] ?? 'Não deu certo. Tente novamente.'}',
        fieldErrors: errors,
        extra: Map<String, dynamic>.from(data),
      );
    }
    return ApiException(status: res.statusCode ?? 500, code: 'HTTP_${res.statusCode}', message: 'Não deu certo. Tente novamente.');
  }

  @override
  String toString() => 'ApiException($status $code: $message)';
}
