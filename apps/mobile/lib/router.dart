import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import 'core/auth/session.dart';
import 'core/providers.dart';
import 'features/accounts/accounts_screen.dart';
import 'features/accounts/statements_screen.dart';
import 'features/alerts/alerts_screen.dart';
import 'features/auth/login_screen.dart';
import 'features/auth/register_screen.dart';
import 'features/auth/splash_screen.dart';
import 'features/budget/budget_screen.dart';
import 'features/family/accept_invite_screen.dart';
import 'features/family/family_select_screen.dart';
import 'features/home/home_screen.dart';
import 'features/imports/import_review_screen.dart';
import 'features/imports/import_start_screen.dart';
import 'features/limits/limits_screen.dart';
import 'features/receipt/receipt_capture_screen.dart';
import 'features/reports/reports_screen.dart';
import 'features/settings/more_screen.dart';
import 'features/settings/sync_screen.dart';
import 'features/shell/home_shell.dart';
import 'features/transactions/transaction_detail_screen.dart';
import 'features/transactions/transaction_form_screen.dart';
import 'features/transactions/transactions_screen.dart';

final _rootKey = GlobalKey<NavigatorState>(debugLabel: 'root');

final routerProvider = Provider<GoRouter>((ref) {
  final refresh = ValueNotifier<int>(0);
  ref.listen(sessionProvider, (_, __) => refresh.value++);
  ref.onDispose(refresh.dispose);

  GoRoute full(String path, Widget Function(GoRouterState s) build) =>
      GoRoute(path: path, parentNavigatorKey: _rootKey, builder: (context, state) => build(state));

  return GoRouter(
    navigatorKey: _rootKey,
    initialLocation: '/inicio',
    refreshListenable: refresh,
    redirect: (context, state) {
      final s = ref.read(sessionProvider);
      final loc = state.matchedLocation;
      if (!s.hasValue) return loc == '/abertura' ? null : '/abertura';
      final session = s.valueOrNull ?? const SessionState();
      final public = loc == '/entrar' || loc == '/cadastro';
      if (!session.loggedIn) {
        if (loc.startsWith('/convite/')) {
          // Guarda o convite e volta para ele depois do login
          ref.read(prefsProvider).setString('pendingInvite', loc.substring('/convite/'.length));
        }
        return public ? null : '/entrar';
      }
      final pending = ref.read(prefsProvider).getString('pendingInvite');
      if (pending != null && !loc.startsWith('/convite/')) {
        ref.read(prefsProvider).remove('pendingInvite');
        return '/convite/$pending';
      }
      if (public || loc == '/abertura') return session.family == null ? '/familias' : '/inicio';
      if (session.family == null && loc != '/familias' && !loc.startsWith('/convite/')) return '/familias';
      return null;
    },
    routes: [
      GoRoute(path: '/abertura', builder: (_, __) => const SplashScreen()),
      GoRoute(path: '/entrar', builder: (_, __) => const LoginScreen()),
      GoRoute(path: '/cadastro', builder: (_, __) => const RegisterScreen()),
      GoRoute(path: '/familias', builder: (_, __) => const FamilySelectScreen()),
      GoRoute(path: '/convite/:token', builder: (_, s) => AcceptInviteScreen(token: s.pathParameters['token']!)),
      StatefulShellRoute.indexedStack(
        builder: (context, state, shell) => HomeShell(shell: shell),
        branches: [
          StatefulShellBranch(routes: [GoRoute(path: '/inicio', builder: (_, __) => const HomeScreen())]),
          StatefulShellBranch(routes: [GoRoute(path: '/lancamentos', builder: (_, __) => const TransactionsScreen())]),
          StatefulShellBranch(routes: [GoRoute(path: '/relatorios', builder: (_, __) => const ReportsScreen())]),
          StatefulShellBranch(routes: [GoRoute(path: '/mais', builder: (_, __) => const MoreScreen())]),
        ],
      ),
      full('/lancamento/novo', (s) => TransactionFormScreen(args: s.extra is TxnFormArgs ? s.extra as TxnFormArgs : const TxnFormArgs())),
      full('/lancamento/:id', (s) => TransactionDetailScreen(id: s.pathParameters['id']!)),
      full('/lancamento/:id/editar', (s) => TransactionFormScreen(args: TxnFormArgs(editId: s.pathParameters['id']))),
      full('/contas', (_) => const AccountsScreen()),
      full('/cartao/:id', (s) => StatementsScreen(cardId: s.pathParameters['id']!)),
      full('/cartao/:id/fatura/:sid', (s) => StatementDetailScreen(cardId: s.pathParameters['id']!, statementId: s.pathParameters['sid']!)),
      full('/orcamento', (_) => const BudgetScreen()),
      full('/limites', (_) => const LimitsScreen()),
      full('/alertas', (_) => const AlertsScreen()),
      full('/importar', (_) => const ImportStartScreen()),
      full('/importar/:id', (s) => ImportReviewScreen(batchId: s.pathParameters['id']!)),
      full('/nota-fiscal', (_) => const ReceiptCaptureScreen()),
      full('/sincronizacao', (_) => const SyncScreen()),
    ],
  );
});
