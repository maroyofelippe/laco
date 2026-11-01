import type { ReactNode } from 'react';

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-verde">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-apoio">{subtitle}</p>}
      </div>
      {actions}
    </div>
  );
}

export function Card({ title, children, className = '', actions }: { title?: string; children: ReactNode; className?: string; actions?: ReactNode }) {
  return (
    <section className={`rounded-lg border border-borda bg-superficie p-5 ${className}`}>
      {(title || actions) && (
        <div className="mb-4 flex items-center justify-between gap-2">
          {title && <h2 className="text-sm font-bold text-tinta">{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function Stat({ label, value, tone = 'default', hint, highlight = false }: { label: string; value: string; tone?: 'default' | 'income' | 'expense'; hint?: string; highlight?: boolean }) {
  const color = tone === 'income' ? 'text-receita' : tone === 'expense' ? 'text-despesa' : 'text-tinta';
  return (
    <div className={`rounded-lg border p-4 ${highlight ? 'border-verde bg-verde text-fundo' : 'border-borda bg-superficie'}`}>
      <div className={`text-xs font-semibold ${highlight ? 'text-dourado' : 'text-apoio'}`}>{label}</div>
      <div className={`tabular mt-1 text-2xl font-bold ${highlight ? 'text-fundo' : color}`}>{value}</div>
      {hint && <div className={`mt-0.5 text-xs ${highlight ? 'text-verde-borda' : 'text-apoio'}`}>{hint}</div>}
    </div>
  );
}

const BADGE: Record<string, string> = {
  green: 'bg-verde-claro text-receita ring-receita/20',
  amber: 'bg-dourado-claro text-dourado-texto ring-dourado/40',
  red: 'bg-despesa-claro text-despesa ring-despesa/25',
  blue: 'bg-verde-claro text-verde ring-verde/20',
  gray: 'bg-areia text-apoio ring-apoio/20',
};
export function Badge({ children, color = 'gray' }: { children: ReactNode; color?: keyof typeof BADGE }) {
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${BADGE[color]}`}>{children}</span>;
}

export function Banner({ ok, err }: { ok?: string; err?: string }) {
  if (!ok && !err) return null;
  return (
    <div role="status" className={`mb-5 rounded-md border px-4 py-3 text-sm ${err ? 'border-despesa/30 bg-despesa-claro text-despesa' : 'border-verde-borda bg-verde-claro text-verde'}`}>
      {err ?? ok}
    </div>
  );
}

/** Verde (tranquilo) → dourado (perto do combinado) → terracota (acima do combinado). */
export function Progress({ pct, thresholds = [80, 100] }: { pct: number; thresholds?: number[] }) {
  const warn = Math.min(...thresholds);
  const color = pct >= 100 ? 'bg-despesa' : pct >= warn ? 'bg-dourado' : 'bg-receita';
  return (
    <div className="relative h-2 w-full overflow-hidden rounded-full bg-areia" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label={`${pct}% do combinado`}>
      <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.min(pct, 100)}%` }} />
    </div>
  );
}

export function limitColor(status: string): keyof typeof BADGE {
  return status === 'EXCEEDED' ? 'red' : status === 'WARNING' ? 'amber' : status === 'OK' ? 'green' : 'gray';
}

/** Rótulos no tom da marca: tranquilos, sem alarmismo. */
export const LIMIT_STATUS: Record<string, string> = { OK: 'Tranquilo', WARNING: 'Perto do combinado', EXCEEDED: 'Acima do combinado', INACTIVE: 'Pausado', INACTIVE_PERIOD: 'Fora do período' };

export function Empty({ children }: { children: ReactNode }) {
  return <p className="py-8 text-center text-sm text-apoio">{children}</p>;
}
