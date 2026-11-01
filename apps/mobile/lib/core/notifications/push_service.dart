import 'dart:async';

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';

import '../api/api_client.dart';
import '../config.dart';
import 'alerts_poller.dart';

FirebaseOptions get _options => const FirebaseOptions(
      apiKey: AppConfig.firebaseApiKey,
      appId: AppConfig.firebaseAppId,
      messagingSenderId: AppConfig.firebaseSenderId,
      projectId: AppConfig.firebaseProjectId,
    );

/// Push recebido com o app fechado. A mensagem traz só {type, familyId, alertId, seq}:
/// o texto é montado depois de buscar o alerta na API (nada de valores no payload).
@pragma('vm:entry-point')
Future<void> firebaseBackgroundHandler(RemoteMessage message) async {
  if (!AppConfig.pushConfigured) return;
  await Firebase.initializeApp(options: _options);
  if (message.data['type'] == 'ALERT') await AlertsPoller.run();
}

/// Push via Firebase Cloud Messaging — opcional. Sem as chaves (--dart-define), o app usa
/// a verificação periódica do WorkManager e a consulta ao abrir.
abstract final class PushService {
  static bool _started = false;

  static Future<void> start(ApiClient api, {void Function()? onAlert}) async {
    if (_started || !AppConfig.pushConfigured) return;
    try {
      await Firebase.initializeApp(options: _options);
      FirebaseMessaging.onBackgroundMessage(firebaseBackgroundHandler);
      final messaging = FirebaseMessaging.instance;
      Future<void> register(String? token) async {
        if (token == null) return;
        await api.post<dynamic>('/me/devices', body: {'fcmToken': token, 'platform': 'ANDROID', 'appVersion': '0.1.0'});
      }

      await register(await messaging.getToken());
      messaging.onTokenRefresh.listen((t) => unawaited(register(t)));
      FirebaseMessaging.onMessage.listen((m) async {
        if (m.data['type'] == 'ALERT') {
          await AlertsPoller.run();
          onAlert?.call();
        }
      });
      _started = true;
    } catch (e) {
      debugPrint('Push desativado: $e');
    }
  }
}
