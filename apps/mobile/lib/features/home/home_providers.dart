import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/data/remote_cache.dart';
import '../../core/providers.dart';
import '../../core/util/dates.dart';

class HomeData {
  const HomeData({required this.summary, required this.limits, required this.upcoming, this.fromCache = false});
  final Map<String, dynamic> summary;
  final List<Map<String, dynamic>> limits;
  final List<Map<String, dynamic>> upcoming;
  final bool fromCache;
}

/// Painel do mês atual (online, com a última versão guardada para uso offline).
final homeProvider = FutureProvider.autoDispose<HomeData>((ref) async {
  final fam = ref.watch(currentFamilyProvider);
  if (fam == null) throw StateError('Sem família');
  ref.watch(dataVersionProvider); // recarrega depois de sincronizar
  final now = DateTime.now();
  final q = {'from': Dates.iso(Dates.monthStart(now)), 'to': Dates.iso(Dates.monthEnd(now))};
  final base = '/families/${fam.id}/dashboard';
  final results = await Future.wait([
    fetchWithCache(ref, 'home:summary:${fam.id}', '$base/summary', query: q),
    fetchWithCache(ref, 'home:limits:${fam.id}', '$base/limits-vs-actual'),
    fetchWithCache(ref, 'home:upcoming:${fam.id}', '$base/upcoming'),
  ]);
  return HomeData(summary: asMap(results[0]), limits: asList(asMap(results[1])['items']), upcoming: asList(asMap(results[2])['items']));
});
