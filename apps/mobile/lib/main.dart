import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:intl/intl.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'app.dart';
import 'core/db/local_db.dart';
import 'core/notifications/background.dart';
import 'core/notifications/notification_service.dart';
import 'core/providers.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await initializeDateFormatting('pt_BR');
  Intl.defaultLocale = 'pt_BR';

  final prefs = await SharedPreferences.getInstance();
  final db = await LocalDb.open();
  await NotificationService.init();
  try {
    await BackgroundAlerts.init();
  } catch (e) {
    debugPrint('WorkManager indisponível: $e');
  }

  runApp(ProviderScope(
    overrides: [prefsProvider.overrideWithValue(prefs), localDbProvider.overrideWithValue(db)],
    child: const LacoApp(),
  ));
}
