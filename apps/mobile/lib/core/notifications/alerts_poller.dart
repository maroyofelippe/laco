import 'package:shared_preferences/shared_preferences.dart';

import '../api/api_client.dart';
import '../api/api_exception.dart';
import '../auth/token_store.dart';
import '../util/money.dart';
import 'notification_service.dart';

/// Busca alertas novos (GET /alerts?since=cursor) e mostra notificações locais.
/// Não depende do Riverpod: roda no app, no WorkManager e no handler de push em segundo plano.
abstract final class AlertsPoller {
  static String _cursorKey(String familyId) => 'alerts.cursor.$familyId';

  /// Retorna quantos alertas novos foram notificados.
  static Future<int> run({bool notify = true}) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.reload(); // outro isolate pode ter atualizado
    final familyId = prefs.getString('session.familyId');
    final tokens = TokenStore();
    if (familyId == null || !await tokens.hasSession()) return 0;
    final api = ApiClient(tokens);
    final cursor = prefs.getInt(_cursorKey(familyId));
    try {
      if (cursor == null) {
        // Primeira vez: começa do alerta mais recente, sem notificar o passado
        final latest = await api.get<Map<String, dynamic>>('/families/$familyId/alerts', query: {'limit': 1});
        await prefs.setInt(_cursorKey(familyId), (latest['cursor'] as num?)?.toInt() ?? 0);
        return 0;
      }
      final res = await api.get<Map<String, dynamic>>('/families/$familyId/alerts', query: {'since': cursor, 'limit': 50});
      final items = (res['data'] as List? ?? const []).whereType<Map>().where((a) => a['status'] == 'ACTIVE').toList();
      await prefs.setInt(_cursorKey(familyId), (res['cursor'] as num?)?.toInt() ?? cursor);
      if (!notify || items.isEmpty) return items.length;
      // Até 3 avisos individuais; acima disso, um resumo (sem encher a bandeja)
      for (final a in items.take(3)) {
        final limit = Map<String, dynamic>.from(a['limit'] as Map);
        final exceeded = a['level'] == 'EXCEEDED';
        final title = exceeded ? 'Passou do combinado' : 'Chegou a ${a['thresholdPct']}% do combinado';
        final body = '${limit['name']}: ${Money.format('${a['consumed']}')} de ${Money.format('${limit['amount']}')} neste período.';
        await NotificationService.show((a['seq'] as num).toInt(), title, body);
      }
      if (items.length > 3) {
        await NotificationService.show(0, 'Mais ${items.length - 3} alerta(s) da família', 'Abra o Laço para ver todos os limites.');
      }
      return items.length;
    } on ApiException {
      return 0; // sem conexão ou sessão expirada: tenta na próxima vez
    }
  }

  /// Ao trocar de família ou sair: recomeça o cursor.
  static Future<void> reset(String familyId) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_cursorKey(familyId));
  }
}
