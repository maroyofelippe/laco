import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api/api_exception.dart';
import '../providers.dart';

/// Busca na API e guarda a resposta; sem conexão, devolve a última resposta guardada.
/// Usado nas telas de consulta (painel, faturas, orçamento, limites, alertas, relatórios).
Future<dynamic> fetchWithCache(Ref ref, String cacheKey, String path, {Map<String, Object?>? query}) async {
  final db = ref.read(localDbProvider);
  try {
    final data = await ref.read(apiClientProvider).get<dynamic>(path, query: query);
    await db.putJson(cacheKey, data as Object);
    return data;
  } on ApiException catch (e) {
    if (e.isNetwork) {
      final cached = await db.getJson(cacheKey);
      if (cached != null) return cached;
    }
    rethrow;
  }
}

Map<String, dynamic> asMap(dynamic v) => v is Map ? Map<String, dynamic>.from(v) : <String, dynamic>{};
List<Map<String, dynamic>> asList(dynamic v) => v is List ? v.whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList() : const [];
