/** Símbolo do Laço (casa cuja base forma um laço). Fonte: packages/brand/logo/laco-simbolo.svg */
const HOUSE = 'M14 51V28L32 12L50 28V51';
const KNOT = 'M14 51C23 51 30.5 47 34 41C37.5 35 36.5 26.5 32 26.5C27.5 26.5 26.5 35 30 41C33.5 47 41 51 50 51';

export function LacoSymbol({ size = 32, inverse = false, className = '' }: { size?: number; inverse?: boolean; className?: string }) {
  const stroke = size < 24 ? 6.5 : 5;
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className={className} aria-hidden="true">
      <path d={HOUSE} fill="none" stroke={inverse ? 'var(--laco-fundo)' : 'var(--laco-verde)'} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" />
      <path d={KNOT} fill="none" stroke="var(--laco-dourado)" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function LacoLogo({ size = 32, inverse = false }: { size?: number; inverse?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2" aria-label="Laço">
      <LacoSymbol size={size} inverse={inverse} />
      <span className={`font-bold tracking-tight ${inverse ? 'text-fundo' : 'text-verde'}`} style={{ fontSize: size * 0.72 }}>
        Laço
      </span>
    </span>
  );
}
