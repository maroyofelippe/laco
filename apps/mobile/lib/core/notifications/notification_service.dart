import 'package:flutter/material.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:permission_handler/permission_handler.dart';

import '../theme/laco_tokens.dart';

/// Notificações locais do Laço (canal "Limites combinados").
abstract final class NotificationService {
  static final _plugin = FlutterLocalNotificationsPlugin();
  static bool _ready = false;
  static void Function(String? payload)? onTap;

  static const _channelId = 'limites';
  static const _channelName = 'Limites combinados';
  static const _channelDesc = 'Avisos quando um limite da família chega perto do combinado ou passa dele.';

  static Future<void> init() async {
    if (_ready) return;
    await _plugin.initialize(
      const InitializationSettings(android: AndroidInitializationSettings('ic_notification')),
      onDidReceiveNotificationResponse: (r) => onTap?.call(r.payload),
    );
    await _plugin
        .resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>()
        ?.createNotificationChannel(const AndroidNotificationChannel(_channelId, _channelName, description: _channelDesc, importance: Importance.defaultImportance));
    _ready = true;
  }

  static Future<void> show(int id, String title, String body, {String payload = 'alertas'}) async {
    await init();
    await _plugin.show(
      id,
      title,
      body,
      const NotificationDetails(
        android: AndroidNotificationDetails(
          _channelId,
          _channelName,
          channelDescription: _channelDesc,
          importance: Importance.defaultImportance,
          priority: Priority.defaultPriority,
          icon: 'ic_notification',
          color: LacoColors.verde,
        ),
      ),
      payload: payload,
    );
  }

  // ----------------------------------------------------------- permissão (Android 13+)
  static Future<bool> isGranted() async => (await Permission.notification.status).isGranted;

  static Future<bool> isPermanentlyDenied() async => (await Permission.notification.status).isPermanentlyDenied;

  /// Explica o motivo ANTES do pedido do sistema, como prevê a política de permissões.
  static Future<bool> requestWithRationale(BuildContext context) async {
    if (await isGranted()) return true;
    if (!context.mounted) return false;
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        icon: const Icon(Icons.notifications_active_outlined, color: LacoColors.verde),
        title: const Text('Receber avisos de limites?'),
        content: const Text(
          'Avisamos quando um limite combinado pela família estiver chegando perto ou passar do valor. '
          'Não enviamos propaganda e você pode desligar quando quiser.',
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Agora não')),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Ativar avisos')),
        ],
      ),
    );
    if (ok != true) return false;
    if (await isPermanentlyDenied()) {
      await openAppSettings();
      return false;
    }
    return (await Permission.notification.request()).isGranted;
  }
}
