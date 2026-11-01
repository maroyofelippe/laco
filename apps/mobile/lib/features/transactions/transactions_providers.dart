import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/data/models.dart';
import '../../core/data/transactions_repository.dart';
import '../../core/providers.dart';
import '../../core/util/dates.dart';

class TxnFilterController extends Notifier<TxnFilter> {
  @override
  TxnFilter build() {
    ref.watch(currentFamilyProvider); // trocou de família: volta ao padrão
    final now = DateTime.now();
    return TxnFilter(from: Dates.iso(Dates.monthStart(now)), to: Dates.iso(Dates.monthEnd(now)));
  }

  DateTime get month => Dates.parse(state.from);

  void setMonth(DateTime m) => state = state.copyWith(from: Dates.iso(Dates.monthStart(m)), to: Dates.iso(Dates.monthEnd(m)));
  void setQuery(String q) => state = state.copyWith(query: q);
  void set(TxnFilter f) => state = f;
  void clearExtras() => state = TxnFilter(from: state.from, to: state.to);
}

final txnFilterProvider = NotifierProvider<TxnFilterController, TxnFilter>(TxnFilterController.new);

/// Lançamentos do banco local (funciona sem conexão).
final transactionsProvider = FutureProvider.autoDispose<List<Txn>>((ref) async {
  ref.watch(dataVersionProvider);
  final fam = ref.watch(currentFamilyProvider);
  if (fam == null) return const [];
  return ref.watch(transactionsRepositoryProvider).list(fam.id, ref.watch(txnFilterProvider));
});

final transactionProvider = FutureProvider.autoDispose.family<Txn?, String>((ref, id) async {
  ref.watch(dataVersionProvider);
  return ref.watch(transactionsRepositoryProvider).get(id);
});
