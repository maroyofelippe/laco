import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/data/remote_cache.dart';
import '../../core/providers.dart';

class AlertItem {
  AlertItem(this.j);
  final Map<String, dynamic> j;
  String get id => '${j['id']}';
  bool get exceeded => j['level'] == 'EXCEEDED';
  int get thresholdPct => (j['thresholdPct'] as num?)?.toInt() ?? 0;
  int get consumedPct => (j['consumedPct'] as num?)?.toInt() ?? 0;
  String get status => '${j['status']}';
  bool get read => j['readAt'] != null;
  String get consumed => '${j['consumed']}';
  Map<String, dynamic> get limit => asMap(j['limit']);
  String get limitName => '${limit['name']}';
  String get limitAmount => '${limit['amount']}';
  String get periodStart => '${asMap(j['period'])['start']}';
  String get periodEnd => '${asMap(j['period'])['end']}';
  String get createdAt => '${j['createdAt']}';

  /// Texto no tom da marca: claro e sem alarmismo.
  String get title => exceeded ? 'Passou do combinado' : 'Chegou a $thresholdPct% do combinado';
}

class AlertsData {
  const AlertsData(this.active, this.history, this.unread);
  final List<AlertItem> active;
  final List<AlertItem> history;
  final int unread;
}

final alertsProvider = FutureProvider.autoDispose<AlertsData>((ref) async {
  final fam = ref.watch(currentFamilyProvider);
  if (fam == null) return const AlertsData([], [], 0);
  final active = asMap(await fetchWithCache(ref, 'alerts:active:${fam.id}', '/families/${fam.id}/alerts', query: {'status': 'ACTIVE'}));
  final all = asMap(await fetchWithCache(ref, 'alerts:all:${fam.id}', '/families/${fam.id}/alerts', query: {'limit': 200}));
  return AlertsData(
    asList(active['data']).map(AlertItem.new).toList(),
    asList(all['data']).where((a) => a['status'] != 'ACTIVE').map(AlertItem.new).toList(),
    (active['unreadCount'] as num?)?.toInt() ?? 0,
  );
});
