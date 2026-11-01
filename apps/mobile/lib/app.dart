import 'dart:async';

import 'package:app_links/app_links.dart';
import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'core/auth/session.dart';
import 'core/notifications/alerts_poller.dart';
import 'core/notifications/background.dart';
import 'core/notifications/notification_service.dart';
import 'core/notifications/push_service.dart';
import 'core/providers.dart';
import 'core/theme/app_theme.dart';
import 'features/alerts/alerts_providers.dart';
import 'router.dart';

class LacoApp extends ConsumerStatefulWidget {
  const LacoApp({super.key});

  @override
  ConsumerState<LacoApp> createState() => _LacoAppState();
}

class _LacoAppState extends ConsumerState<LacoApp> {
  late final AppLifecycleListener _lifecycle;
  StreamSubscription<Uri>? _links;

  @override
  void initState() {
    super.initState();
    _lifecycle = AppLifecycleListener(onResume: _onResume);
    NotificationService.onTap = (_) => ref.read(routerProvider).push('/alertas');
    // Convites: laco://convite/<token>
    _links = AppLinks().uriLinkStream.listen((uri) {
      if (uri.scheme == 'laco' && uri.host == 'convite' && uri.pathSegments.isNotEmpty) {
        ref.read(routerProvider).go('/convite/${uri.pathSegments.first}');
      }
    });
  }

  @override
  void dispose() {
    _lifecycle.dispose();
    _links?.cancel();
    super.dispose();
  }

  Future<void> _onResume() async {
    final fam = ref.read(currentFamilyProvider);
    if (fam == null) return;
    unawaited(ref.read(syncProvider.notifier).syncNow());
    await AlertsPoller.run();
    ref.invalidate(alertsProvider);
  }

  /// Família escolhida (login, troca ou abertura do app): sincroniza e liga os avisos.
  Future<void> _onFamilyReady(SessionState s) async {
    await ref.read(syncProvider.notifier).syncNow();
    await AlertsPoller.run(notify: false);
    try {
      await BackgroundAlerts.schedule();
    } catch (_) {}
    await PushService.start(ref.read(apiClientProvider), onAlert: () => ref.invalidate(alertsProvider));
  }

  @override
  Widget build(BuildContext context) {
    ref.listen(sessionProvider, (prev, next) {
      final before = prev?.valueOrNull?.familyId;
      final now = next.valueOrNull;
      if (now?.familyId != null && now!.familyId != before) unawaited(_onFamilyReady(now));
      if (now != null && !now.loggedIn && prev?.valueOrNull?.loggedIn == true) {
        unawaited(BackgroundAlerts.cancel().catchError((_) {}));
      }
    });

    return MaterialApp.router(
      title: 'Laço',
      debugShowCheckedModeBanner: false,
      theme: AppTheme.light(),
      routerConfig: ref.watch(routerProvider),
      locale: const Locale('pt', 'BR'),
      supportedLocales: const [Locale('pt', 'BR')],
      localizationsDelegates: const [GlobalMaterialLocalizations.delegate, GlobalWidgetsLocalizations.delegate, GlobalCupertinoLocalizations.delegate],
    );
  }
}
