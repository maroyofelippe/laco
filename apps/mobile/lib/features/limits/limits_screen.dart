import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/data/remote_cache.dart';
import '../../core/providers.dart';
import '../../core/theme/laco_tokens.dart';
import '../../core/util/dates.dart';
import '../../core/util/money.dart';
import '../../shared/widgets/common.dart';

final _limitsProvider = FutureProvider.autoDispose<List<Map<String, dynamic>>>((ref) async {
  final fam = ref.watch(currentFamilyProvider)!;
  ref.watch(dataVersionProvider);
  return asList(await fetchWithCache(ref, 'limits:${fam.id}', '/families/${fam.id}/limits'));
});

const _scope = {'FAMILY': 'Toda a família', 'CATEGORY': 'Categoria', 'ACCOUNT': 'Conta', 'CARD': 'Cartão', 'MEMBER': 'Pessoa'};
const _period = {'WEEKLY': 'Semanal', 'MONTHLY': 'Mensal', 'CARD_CYCLE': 'Ciclo da fatura', 'CUSTOM': 'Personalizado'};

class LimitsScreen extends ConsumerWidget {
  const LimitsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final data = ref.watch(_limitsProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('Limites combinados'), backgroundColor: LacoColors.fundo),
      body: RefreshIndicator(
        onRefresh: () async => ref.invalidate(_limitsProvider),
        child: AsyncBody<List<Map<String, dynamic>>>(
          value: data,
          onRetry: () => ref.invalidate(_limitsProvider),
          builder: (list) {
            final active = list.where((l) => l['isActive'] == true).toList();
            if (active.isEmpty) {
              return ListView(children: const [SizedBox(height: 60), EmptyState(icon: Icons.flag_outlined, title: 'Nenhum limite combinado', message: 'Quem administra a família pode combinar limites no painel web. Avisamos aqui quando estiver chegando perto.')]);
            }
            return ListView(padding: const EdgeInsets.all(16), children: [
              const Text('Avisamos uma vez em cada faixa: quando estiver perto e se passar do combinado.', style: TextStyle(color: LacoColors.apoio)),
              const SizedBox(height: 12),
              for (final l in active)
                Padding(
                  padding: const EdgeInsets.only(bottom: 10),
                  child: LacoCard(
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Row(children: [
                        Expanded(child: Text('${l['name']}', style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 16))),
                        StatusPill(limitStatusLabels['${l['status']}'] ?? '', tone: toneForLimit('${l['status']}')),
                      ]),
                      Text('${_scope[l['scopeType']]} · ${_period[l['period']]} · avisos em ${(l['thresholds'] as List).join('% e ')}%', style: const TextStyle(fontSize: 12, color: LacoColors.apoio)),
                      const SizedBox(height: 12),
                      LimitBar(pct: (l['consumedPct'] as num?) ?? 0, warnAt: (l['thresholds'] as List).cast<num>().reduce((a, b) => a < b ? a : b)),
                      const SizedBox(height: 6),
                      Row(children: [
                        Expanded(child: Text('${Money.format('${l['consumed']}')} de ${Money.format('${l['amount']}')}', style: const TextStyle(fontWeight: FontWeight.w600))),
                        Text('${l['consumedPct']}%', style: const TextStyle(fontWeight: FontWeight.w800)),
                      ]),
                      if (l['currentPeriod'] is Map)
                        Text('Período: ${Dates.format('${(l['currentPeriod'] as Map)['start']}')} a ${Dates.format('${(l['currentPeriod'] as Map)['end']}')}', style: const TextStyle(fontSize: 12, color: LacoColors.apoio)),
                    ]),
                  ),
                ),
            ]);
          },
        ),
      ),
    );
  }
}
