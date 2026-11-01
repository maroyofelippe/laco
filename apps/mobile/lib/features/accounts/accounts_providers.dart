import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/data/remote_cache.dart';
import '../../core/providers.dart';

final accountsProvider = FutureProvider.autoDispose<List<Map<String, dynamic>>>((ref) async {
  final fam = ref.watch(currentFamilyProvider)!;
  ref.watch(dataVersionProvider);
  return asList(await fetchWithCache(ref, 'accounts:${fam.id}', '/families/${fam.id}/accounts'));
});

final cardsProvider = FutureProvider.autoDispose<List<Map<String, dynamic>>>((ref) async {
  final fam = ref.watch(currentFamilyProvider)!;
  ref.watch(dataVersionProvider);
  return asList(await fetchWithCache(ref, 'cards:${fam.id}', '/families/${fam.id}/cards'));
});

final statementsProvider = FutureProvider.autoDispose.family<List<Map<String, dynamic>>, String>((ref, cardId) async {
  final fam = ref.watch(currentFamilyProvider)!;
  return asList(await fetchWithCache(ref, 'statements:$cardId', '/families/${fam.id}/cards/$cardId/statements'));
});

final statementProvider = FutureProvider.autoDispose.family<Map<String, dynamic>, (String, String)>((ref, ids) async {
  final fam = ref.watch(currentFamilyProvider)!;
  return asMap(await fetchWithCache(ref, 'statement:${ids.$2}', '/families/${fam.id}/cards/${ids.$1}/statements/${ids.$2}'));
});

const statementStatus = {'OPEN': 'Aberta', 'CLOSED': 'Fechada', 'PAID': 'Paga', 'PARTIAL': 'Paga em parte', 'OVERDUE': 'Vencida'};
