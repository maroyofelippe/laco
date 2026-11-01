'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const ITEMS = [
  { href: 'dashboard', label: 'Visão geral' },
  { href: 'lancamentos', label: 'Lançamentos' },
  { href: 'contas', label: 'Contas e cartões' },
  { href: 'orcamentos', label: 'Orçamento' },
  { href: 'limites', label: 'Limites combinados' },
  { href: 'alertas', label: 'Alertas' },
  { href: 'categorias', label: 'Categorias' },
  { href: 'membros', label: 'Pessoas', admin: true },
  { href: 'auditoria', label: 'Histórico de ações', admin: true },
];

export function Nav({ familyId, isAdmin, unread }: { familyId: string; isAdmin: boolean; unread: number }) {
  const path = usePathname();
  return (
    <nav className="flex flex-col gap-0.5" aria-label="Seções">
      {ITEMS.filter((i) => !i.admin || isAdmin).map((i) => {
        const href = `/f/${familyId}/${i.href}`;
        const active = path.startsWith(href);
        return (
          <Link
            key={i.href}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={`flex items-center justify-between rounded-md px-3 py-2 text-sm font-semibold transition ${active ? 'bg-verde-claro text-verde' : 'text-apoio hover:bg-areia hover:text-tinta'}`}
          >
            {i.label}
            {i.href === 'alertas' && unread > 0 && (
              <span className="rounded-full bg-dourado px-1.5 py-0.5 text-[11px] font-bold leading-none text-verde" aria-label={`${unread} não lidos`}>{unread}</span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
