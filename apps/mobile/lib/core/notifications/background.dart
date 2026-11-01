import 'dart:ui';

import 'package:workmanager/workmanager.dart';

import 'alerts_poller.dart';

const _periodicTask = 'laco.alertas.verificar';

/// Ponto de entrada do WorkManager (isolate separado).
@pragma('vm:entry-point')
void callbackDispatcher() {
  Workmanager().executeTask((task, inputData) async {
    DartPluginRegistrant.ensureInitialized();
    await AlertsPoller.run();
    return true;
  });
}

/// Verificação periódica de alertas: a cada 15 min (mínimo do Android), só com internet.
abstract final class BackgroundAlerts {
  static Future<void> init() async {
    await Workmanager().initialize(callbackDispatcher);
  }

  static Future<void> schedule() async {
    await Workmanager().registerPeriodicTask(
      _periodicTask,
      _periodicTask,
      frequency: const Duration(minutes: 15),
      constraints: Constraints(networkType: NetworkType.connected),
    );
  }

  static Future<void> cancel() => Workmanager().cancelByUniqueName(_periodicTask);
}
