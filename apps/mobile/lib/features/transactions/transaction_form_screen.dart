import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/data/lookups_repository.dart';
import '../../core/data/models.dart';
import '../../core/data/transactions_repository.dart';
import '../../core/providers.dart';
import '../../core/theme/app_theme.dart';
import '../../core/theme/laco_tokens.dart';
import '../../core/util/color.dart';
import '../../core/util/dates.dart';
import '../../core/util/money.dart';
import '../../shared/widgets/common.dart';
import 'pickers.dart';

/// Abre o formulário: novo, edição ou pré-preenchido (nota fiscal / importação manual).
class TxnFormArgs {
  const TxnFormArgs({this.editId, this.type, this.amount, this.description, this.occurredOn, this.categoryId, this.accountId, this.cardId, this.source = 'MANUAL', this.receiptImagePath, this.notes});
  final String? editId;
  final String? type;
  final String? amount;
  final String? description;
  final String? occurredOn;
  final String? categoryId;
  final String? accountId;
  final String? cardId;
  final String source;
  final String? receiptImagePath;
  final String? notes;
}

class TransactionFormScreen extends ConsumerStatefulWidget {
  const TransactionFormScreen({super.key, required this.args});
  final TxnFormArgs args;

  @override
  ConsumerState<TransactionFormScreen> createState() => _TransactionFormScreenState();
}

class _TransactionFormScreenState extends ConsumerState<TransactionFormScreen> {
  final _form = GlobalKey<FormState>();
  final _amount = TextEditingController();
  final _description = TextEditingController();
  final _notes = TextEditingController();
  String _type = 'EXPENSE';
  String? _categoryId;
  Means? _means;
  String _date = Dates.today();
  String? _memberId;
  bool _installments = false;
  int _count = 2;
  bool _repeat = false;
  String _frequency = 'MONTHLY';
  String? _endDate;
  bool _attachPhoto = true;
  bool _saving = false;
  Txn? _editing;
  bool _loaded = false;

  bool get _isEdit => widget.args.editId != null;

  @override
  void dispose() {
    _amount.dispose();
    _description.dispose();
    _notes.dispose();
    super.dispose();
  }

  Future<void> _load(Lookups lk) async {
    if (_loaded) return;
    _loaded = true;
    final a = widget.args;
    final me = ref.read(sessionProvider).valueOrNull?.user?.id;
    _memberId = lk.member(me) != null ? me : null;
    if (_isEdit) {
      final t = await ref.read(transactionsRepositoryProvider).get(a.editId!);
      if (t == null) return;
      setState(() {
        _editing = t;
        _type = t.type == 'INCOME' ? 'INCOME' : 'EXPENSE';
        _amount.text = Money.toInput(t.amount);
        _description.text = t.description;
        _categoryId = t.categoryId;
        _means = Means(accountId: t.accountId, cardId: t.cardId, name: t.meansName);
        _date = t.occurredOn;
        _memberId = t.memberId;
      });
      return;
    }
    setState(() {
      _type = a.type ?? 'EXPENSE';
      if (a.amount != null) _amount.text = Money.toInput(a.amount);
      if (a.description != null) _description.text = a.description!;
      if (a.notes != null) _notes.text = a.notes!;
      _categoryId = a.categoryId != null && lk.category(a.categoryId)?.kind == _type ? a.categoryId : null;
      _date = a.occurredOn ?? Dates.today();
      if (a.accountId != null) _means = Means(accountId: a.accountId, name: lk.account(a.accountId)?.name ?? 'Conta');
      if (a.cardId != null) _means = Means(cardId: a.cardId, name: lk.card(a.cardId)?.name ?? 'Cartão');
      // Primeira conta como sugestão, para lançar com poucos toques
      if (_means == null && lk.activeAccounts.isNotEmpty) _means = Means(accountId: lk.activeAccounts.first.id, name: lk.activeAccounts.first.name);
    });
  }

  Future<void> _save(Lookups lk) async {
    if (!_form.currentState!.validate()) return;
    if (_categoryId == null) {
      showSnack(context, 'Escolha uma categoria. Ela é obrigatória em todo lançamento.', error: true);
      return;
    }
    if (_means == null) {
      showSnack(context, 'Escolha a conta ou o cartão.', error: true);
      return;
    }
    final fam = ref.read(currentFamilyProvider)!;
    final repo = ref.read(transactionsRepositoryProvider);
    final amount = Money.parseInput(_amount.text)!;
    setState(() => _saving = true);
    String message;
    try {
      if (_isEdit && _editing != null) {
        final t = _editing!;
        var scope = 'this';
        final changedMeta = _description.text.trim() != t.description || _categoryId != t.categoryId;
        if (t.installmentPlanId != null && changedMeta && t.syncError == null && !t.pending) {
          scope = await _askScope() ?? 'cancel';
          if (scope == 'cancel') return;
        }
        await repo.update(
          fam.id,
          t,
          amount: amount != t.amount && scope == 'this' ? amount : null,
          description: _description.text.trim() != t.description ? _description.text.trim() : null,
          categoryId: _categoryId != t.categoryId ? _categoryId : null,
          occurredOn: _date != t.occurredOn && scope == 'this' ? _date : null,
          scope: scope,
        );
        message = 'Alteração salva';
      } else {
        final draft = TxnDraft(
          type: _type, amount: amount, description: _description.text.trim(), categoryId: _categoryId!, occurredOn: _date,
          accountId: _means!.accountId, cardId: _means!.cardId, memberId: _memberId, notes: _notes.text.trim(), source: widget.args.source,
        );
        if (_installments) {
          await repo.createInstallments(fam.id, draft, _count);
          message = 'Compra em ${_count}x lançada';
        } else if (_repeat) {
          await repo.createRecurrence(fam.id, draft, frequency: _frequency, endDate: _endDate);
          message = 'Recorrência combinada. Os lançamentos aparecem após sincronizar.';
        } else {
          final t = await repo.create(fam.id, draft);
          if (widget.args.receiptImagePath != null && _attachPhoto) await repo.queueAttachment(fam.id, t.id, widget.args.receiptImagePath!);
          message = 'Lançamento salvo';
        }
      }
      ref.read(syncProvider.notifier).syncSoon();
      if (!mounted) return;
      showSnack(context, message);
      context.pop(true);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Future<String?> _askScope() => showDialog<String>(
        context: context,
        builder: (ctx) => SimpleDialog(
          title: const Text('Aplicar a alteração em quais parcelas?'),
          children: [
            SimpleDialogOption(onPressed: () => Navigator.pop(ctx, 'this'), child: const Text('Só nesta parcela')),
            SimpleDialogOption(onPressed: () => Navigator.pop(ctx, 'future'), child: const Text('Nesta e nas próximas')),
            SimpleDialogOption(onPressed: () => Navigator.pop(ctx, 'all'), child: const Text('Em todas as parcelas')),
          ],
        ),
      );

  Future<void> _pickDate({bool end = false}) async {
    final initial = Dates.parse(end ? (_endDate ?? _date) : _date);
    final d = await showDatePicker(context: context, initialDate: initial, firstDate: DateTime(2000), lastDate: DateTime(DateTime.now().year + 6));
    if (d == null) return;
    setState(() {
      if (end) {
        _endDate = Dates.iso(d);
      } else {
        _date = Dates.iso(d);
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final lk = ref.watch(lookupsProvider).valueOrNull;
    if (lk != null && !_loaded) {
      // Preenche depois do frame atual (setState não pode rodar durante o build)
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) _load(lk);
      });
    }
    final cat = lk?.category(_categoryId);
    final transferLocked = _editing?.isTransfer ?? false;

    return Scaffold(
      appBar: AppBar(title: Text(_isEdit ? 'Editar lançamento' : 'Novo lançamento'), backgroundColor: LacoColors.fundo),
      body: lk == null
          ? const Center(child: CircularProgressIndicator())
          : lk.isEmpty
              ? EmptyState(icon: Icons.cloud_download_outlined, title: 'Ainda carregando os dados da família', message: 'Conecte-se à internet uma vez para baixar categorias, contas e cartões.', action: 'Sincronizar', onAction: () => ref.read(syncProvider.notifier).syncNow())
              : Form(
                  key: _form,
                  child: ListView(
                    padding: const EdgeInsets.all(16),
                    children: [
                      if (!_isEdit)
                        SegmentedButton<String>(
                          segments: const [
                            ButtonSegment(value: 'EXPENSE', label: Text('Despesa'), icon: Icon(Icons.arrow_upward)),
                            ButtonSegment(value: 'INCOME', label: Text('Receita'), icon: Icon(Icons.arrow_downward)),
                          ],
                          selected: {_type},
                          onSelectionChanged: (s) => setState(() {
                            _type = s.first;
                            if (lk.category(_categoryId)?.kind != _type) _categoryId = null;
                            if (_type == 'INCOME') _installments = false;
                          }),
                        ),
                      const SizedBox(height: 16),
                      TextFormField(
                        controller: _amount,
                        enabled: !transferLocked,
                        keyboardType: const TextInputType.numberWithOptions(decimal: true),
                        style: TextStyle(fontSize: 28, fontWeight: FontWeight.w800, color: _type == 'INCOME' ? LacoColors.receita : LacoColors.despesa),
                        decoration: AppTheme.input(_installments ? 'Valor total da compra' : 'Valor', prefix: const Padding(padding: EdgeInsets.all(14), child: Text(r'R$', style: TextStyle(fontWeight: FontWeight.w700)))),
                        validator: (v) => Money.parseInput(v ?? '') == null ? 'Informe um valor maior que zero' : null,
                      ),
                      const SizedBox(height: 12),
                      TextFormField(
                        controller: _description,
                        textCapitalization: TextCapitalization.sentences,
                        maxLength: 200,
                        decoration: AppTheme.input('Descrição', hint: 'Ex.: Mercado da semana'),
                        validator: (v) => (v ?? '').trim().isEmpty ? 'Descreva o lançamento' : null,
                      ),
                      _FieldTile(
                        icon: Icons.sell_outlined,
                        label: 'Categoria (obrigatória)',
                        value: cat == null ? 'Escolher' : lk.categoryPath(cat.id),
                        color: cat == null ? null : hexColor(cat.color ?? lk.category(cat.parentId)?.color),
                        onTap: transferLocked
                            ? null
                            : () async {
                                final c = await pickCategory(context, lk, _type);
                                if (c != null) setState(() => _categoryId = c.id);
                              },
                      ),
                      _FieldTile(
                        icon: _means?.isCard == true ? Icons.credit_card : Icons.account_balance_outlined,
                        label: 'Conta ou cartão',
                        value: _means?.name ?? 'Escolher',
                        onTap: _isEdit
                            ? null
                            : () async {
                                final m = await pickMeans(context, lk);
                                if (m != null) setState(() => _means = m);
                              },
                      ),
                      _FieldTile(icon: Icons.event_outlined, label: _installments ? 'Data da compra' : 'Data', value: Dates.format(_date), onTap: transferLocked ? null : () => _pickDate()),
                      if (lk.activeMembers.length > 1)
                        _FieldTile(
                          icon: Icons.person_outline,
                          label: 'Quem',
                          value: lk.member(_memberId)?.name ?? 'Escolher',
                          onTap: _isEdit
                              ? null
                              : () async {
                                  final m = await pickMember(context, lk);
                                  if (m != null) setState(() => _memberId = m.userId);
                                },
                        ),
                      if (!_isEdit) ...[
                        const SizedBox(height: 8),
                        if (_type == 'EXPENSE')
                          SwitchListTile(
                            contentPadding: EdgeInsets.zero,
                            title: const Text('Parcelar'),
                            subtitle: Text(_installments ? '$_count parcelas de ${Money.formatCents((Money.toCents(Money.parseInput(_amount.text) ?? '0') / _count).floor())}' : 'Divide o valor em parcelas mensais'),
                            value: _installments,
                            onChanged: (v) => setState(() {
                              _installments = v;
                              if (v) _repeat = false;
                            }),
                          ),
                        if (_installments)
                          Row(children: [
                            const Text('Parcelas'),
                            const Spacer(),
                            IconButton(onPressed: _count > 2 ? () => setState(() => _count--) : null, icon: const Icon(Icons.remove_circle_outline)),
                            Text('$_count', style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
                            IconButton(onPressed: _count < 72 ? () => setState(() => _count++) : null, icon: const Icon(Icons.add_circle_outline)),
                          ]),
                        SwitchListTile(
                          contentPadding: EdgeInsets.zero,
                          title: const Text('Repetir'),
                          subtitle: const Text('Contas fixas, salário, assinaturas'),
                          value: _repeat,
                          onChanged: (v) => setState(() {
                            _repeat = v;
                            if (v) _installments = false;
                          }),
                        ),
                        if (_repeat) ...[
                          SegmentedButton<String>(
                            segments: const [ButtonSegment(value: 'WEEKLY', label: Text('Semanal')), ButtonSegment(value: 'MONTHLY', label: Text('Mensal')), ButtonSegment(value: 'YEARLY', label: Text('Anual'))],
                            selected: {_frequency},
                            onSelectionChanged: (s) => setState(() => _frequency = s.first),
                          ),
                          _FieldTile(icon: Icons.event_busy_outlined, label: 'Até (opcional)', value: _endDate == null ? 'Sem data para acabar' : Dates.format(_endDate), onTap: () => _pickDate(end: true)),
                        ],
                        const SizedBox(height: 8),
                        TextFormField(controller: _notes, maxLines: 2, maxLength: 2000, decoration: AppTheme.input('Observações (opcional)')),
                        if (widget.args.receiptImagePath != null)
                          CheckboxListTile(
                            contentPadding: EdgeInsets.zero,
                            value: _attachPhoto,
                            onChanged: (v) => setState(() => _attachPhoto = v ?? false),
                            title: const Text('Anexar a foto da nota'),
                            subtitle: const Text('Fica guardada com o lançamento, visível só para a família'),
                          ),
                      ],
                      if (transferLocked)
                        const Padding(padding: EdgeInsets.only(top: 12), child: Text('Em transferências e pagamentos de fatura dá para mudar só a descrição.', style: TextStyle(color: LacoColors.apoio))),
                      const SizedBox(height: 24),
                      FilledButton(onPressed: _saving ? null : () => _save(lk), child: Text(_saving ? 'Salvando...' : 'Salvar')),
                    ],
                  ),
                ),
    );
  }
}

class _FieldTile extends StatelessWidget {
  const _FieldTile({required this.icon, required this.label, required this.value, this.onTap, this.color});
  final IconData icon;
  final String label;
  final String value;
  final VoidCallback? onTap;
  final Color? color;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(top: 8),
        child: LacoCard(
          onTap: onTap,
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
          child: Row(children: [
            Icon(icon, color: color ?? LacoColors.verde),
            const SizedBox(width: 12),
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(label, style: const TextStyle(fontSize: 12, color: LacoColors.apoio)),
                Text(value, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15)),
              ]),
            ),
            if (onTap != null) const Icon(Icons.chevron_right, color: LacoColors.apoio),
          ]),
        ),
      );
}
