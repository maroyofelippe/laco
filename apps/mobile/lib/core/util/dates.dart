import 'package:intl/intl.dart';

/// Datas de negócio são 'YYYY-MM-DD', sem fuso.
abstract final class Dates {
  static final _day = DateFormat('dd/MM/yyyy', 'pt_BR');
  static final _dayShort = DateFormat("d 'de' MMM", 'pt_BR');
  static final _weekday = DateFormat("EEEE, d 'de' MMMM", 'pt_BR');
  static final _month = DateFormat('MMMM yyyy', 'pt_BR');
  static final _monthShort = DateFormat('MMM/yy', 'pt_BR');
  static final _dateTime = DateFormat("dd/MM/yyyy 'às' HH:mm", 'pt_BR');

  static String iso(DateTime d) => '${d.year.toString().padLeft(4, '0')}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';
  static DateTime parse(String iso) {
    final p = iso.substring(0, 10).split('-').map(int.parse).toList();
    return DateTime(p[0], p[1], p[2]);
  }

  static String today() => iso(DateTime.now());
  static String format(String? iso) => iso == null || iso.length < 10 ? '—' : _day.format(parse(iso));
  static String short(String iso) => _dayShort.format(parse(iso));
  static String weekday(String iso) => _capitalize(_weekday.format(parse(iso)));
  static String month(DateTime d) => _capitalize(_month.format(d));
  static String monthShort(String ym) => _monthShort.format(DateTime(int.parse(ym.substring(0, 4)), int.parse(ym.substring(5, 7))));
  static String dateTime(String? isoUtc) => isoUtc == null ? '—' : _dateTime.format(DateTime.parse(isoUtc).toLocal());

  static DateTime monthStart(DateTime d) => DateTime(d.year, d.month);
  static DateTime monthEnd(DateTime d) => DateTime(d.year, d.month + 1, 0);
  static DateTime addMonths(DateTime d, int n) => DateTime(d.year, d.month + n);

  static String _capitalize(String s) => s.isEmpty ? s : s[0].toUpperCase() + s.substring(1);
}
