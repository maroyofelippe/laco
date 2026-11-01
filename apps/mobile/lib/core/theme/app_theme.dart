import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

import 'laco_tokens.dart';

/// Tema do app a partir dos tokens da marca (packages/brand/tokens.json).
/// Dourado só aparece em preenchimentos e detalhes: nunca como cor de texto sobre fundo claro.
abstract final class AppTheme {
  static ThemeData light() {
    const scheme = ColorScheme(
      brightness: Brightness.light,
      primary: LacoColors.verde,
      onPrimary: LacoColors.fundo,
      primaryContainer: LacoColors.verdeClaro,
      onPrimaryContainer: LacoColors.verde,
      secondary: LacoColors.dourado,
      onSecondary: LacoColors.verde,
      secondaryContainer: LacoColors.douradoClaro,
      onSecondaryContainer: LacoColors.douradoTexto,
      tertiary: LacoColors.receita,
      onTertiary: LacoColors.superficie,
      error: LacoColors.despesa,
      onError: LacoColors.superficie,
      errorContainer: LacoColors.despesaClaro,
      onErrorContainer: LacoColors.despesa,
      surface: LacoColors.superficie,
      onSurface: LacoColors.tinta,
      onSurfaceVariant: LacoColors.apoio,
      surfaceContainerHighest: LacoColors.areia,
      outline: LacoColors.borda,
      outlineVariant: LacoColors.areia,
    );

    final base = ThemeData(useMaterial3: true, colorScheme: scheme, scaffoldBackgroundColor: LacoColors.fundo);
    final text = GoogleFonts.nunitoSansTextTheme(base.textTheme).apply(bodyColor: LacoColors.tinta, displayColor: LacoColors.verde);

    return base.copyWith(
      textTheme: text.copyWith(
        headlineSmall: text.headlineSmall?.copyWith(fontWeight: FontWeight.w700, color: LacoColors.verde),
        titleLarge: text.titleLarge?.copyWith(fontWeight: FontWeight.w700, color: LacoColors.verde),
        titleMedium: text.titleMedium?.copyWith(fontWeight: FontWeight.w700),
        labelLarge: text.labelLarge?.copyWith(fontWeight: FontWeight.w700),
      ),
      dividerColor: LacoColors.borda,
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          backgroundColor: LacoColors.verde,
          foregroundColor: LacoColors.fundo,
          minimumSize: const Size(64, 48),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
          textStyle: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          foregroundColor: LacoColors.verde,
          minimumSize: const Size(64, 48),
          side: const BorderSide(color: LacoColors.borda),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
          textStyle: const TextStyle(fontWeight: FontWeight.w700),
        ),
      ),
      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(foregroundColor: LacoColors.verde, textStyle: const TextStyle(fontWeight: FontWeight.w700)),
      ),
      navigationBarTheme: const NavigationBarThemeData(
        backgroundColor: LacoColors.superficie,
        indicatorColor: LacoColors.verdeClaro,
        surfaceTintColor: Colors.transparent,
        height: 68,
      ),
      floatingActionButtonTheme: const FloatingActionButtonThemeData(
        backgroundColor: LacoColors.verde,
        foregroundColor: LacoColors.fundo,
      ),
      snackBarTheme: const SnackBarThemeData(behavior: SnackBarBehavior.floating, backgroundColor: LacoColors.tinta),
    );
  }

  /// Campos de formulário no padrão da marca (evita depender de classes de tema que mudam entre versões do Flutter).
  static InputDecoration input(String label, {String? hint, Widget? prefix, Widget? suffix, String? helper}) {
    OutlineInputBorder border(Color c, [double w = 1]) =>
        OutlineInputBorder(borderRadius: BorderRadius.circular(10), borderSide: BorderSide(color: c, width: w));
    return InputDecoration(
      labelText: label,
      hintText: hint,
      helperText: helper,
      prefixIcon: prefix,
      suffixIcon: suffix,
      filled: true,
      fillColor: LacoColors.superficie,
      labelStyle: const TextStyle(color: LacoColors.apoio),
      border: border(LacoColors.borda),
      enabledBorder: border(LacoColors.borda),
      focusedBorder: border(LacoColors.verde, 2),
      errorBorder: border(LacoColors.despesa),
      focusedErrorBorder: border(LacoColors.despesa, 2),
      contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
    );
  }
}
