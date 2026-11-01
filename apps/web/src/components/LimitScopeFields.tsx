'use client';
import { useState } from 'react';

type Opt = { id: string; name: string };

/** Mostra só o alvo e os períodos válidos para o escopo escolhido. */
export function LimitScopeFields({ categories, accounts, cards, members }: { categories: (Opt & { child?: boolean })[]; accounts: Opt[]; cards: Opt[]; members: Opt[] }) {
  const [scope, setScope] = useState('CATEGORY');
  const [period, setPeriod] = useState('MONTHLY');
  const targets: Record<string, Opt[]> = { CATEGORY: categories, ACCOUNT: accounts, CARD: cards, MEMBER: members };
  const periods = [['MONTHLY', 'Mensal'], ['WEEKLY', 'Semanal'], ['CUSTOM', 'Personalizado'], ...(scope === 'CARD' ? [['CARD_CYCLE', 'Ciclo da fatura']] : [])];

  return (
    <>
      <div>
        <label className="label" htmlFor="scopeType">Escopo</label>
        <select className="input" id="scopeType" name="scopeType" value={scope} onChange={(e) => { setScope(e.target.value); if (period === 'CARD_CYCLE') setPeriod('MONTHLY'); }}>
          <option value="CATEGORY">Categoria</option>
          <option value="FAMILY">Toda a família</option>
          <option value="ACCOUNT">Conta</option>
          <option value="CARD">Cartão</option>
          <option value="MEMBER">Membro</option>
        </select>
      </div>
      {scope !== 'FAMILY' && (
        <div>
          <label className="label" htmlFor="scopeId">Alvo</label>
          <select className="input" id="scopeId" name="scopeId" key={scope} required>
            {(targets[scope] ?? []).map((o) => <option key={o.id} value={o.id}>{'child' in o && o.child ? `   › ${o.name}` : o.name}</option>)}
          </select>
        </div>
      )}
      <div>
        <label className="label" htmlFor="period">Período</label>
        <select className="input" id="period" name="period" value={period} onChange={(e) => setPeriod(e.target.value)}>
          {periods.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>
      {period === 'CUSTOM' && (
        <div className="grid grid-cols-2 gap-2">
          <div><label className="label" htmlFor="customStart">Início</label><input className="input" type="date" id="customStart" name="customStart" required /></div>
          <div><label className="label" htmlFor="customEnd">Fim</label><input className="input" type="date" id="customEnd" name="customEnd" required /></div>
        </div>
      )}
    </>
  );
}
