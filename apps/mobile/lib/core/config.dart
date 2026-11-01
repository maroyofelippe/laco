/// Configuração de ambiente, passada na compilação com --dart-define.
///
///   flutter run --dart-define=API_URL=http://10.0.2.2:3001/api/v1
///
/// 10.0.2.2 é o "localhost" do computador visto de dentro do emulador Android.
/// Em aparelho físico, use o IP do computador na rede local (ex.: http://192.168.0.10:3001/api/v1).
abstract final class AppConfig {
  static const apiUrl = String.fromEnvironment('API_URL', defaultValue: 'http://10.0.2.2:3001/api/v1');

  /// Push via Firebase é opcional. Sem estas chaves o app funciona e verifica alertas
  /// periodicamente (WorkManager) e sempre que é aberto.
  static const firebaseApiKey = String.fromEnvironment('FIREBASE_API_KEY');
  static const firebaseAppId = String.fromEnvironment('FIREBASE_APP_ID');
  static const firebaseSenderId = String.fromEnvironment('FIREBASE_SENDER_ID');
  static const firebaseProjectId = String.fromEnvironment('FIREBASE_PROJECT_ID');

  static bool get pushConfigured =>
      firebaseApiKey.isNotEmpty && firebaseAppId.isNotEmpty && firebaseSenderId.isNotEmpty && firebaseProjectId.isNotEmpty;
}
