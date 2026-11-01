import type { Metadata } from 'next';
import { LacoSymbol } from '@/components/Logo';
import { SubmitButton } from '@/components/SubmitButton';
import { loginAction } from './actions';

export const metadata: Metadata = { title: 'Entrar' };

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  return (
    <main className="grid min-h-screen lg:grid-cols-2">
      <section className="hidden flex-col justify-between bg-verde p-12 text-fundo lg:flex">
        <div className="flex items-center gap-3">
          <LacoSymbol size={40} inverse />
          <span className="text-2xl font-bold tracking-tight">Laço</span>
        </div>
        <div className="max-w-md">
          <h2 className="text-4xl font-bold leading-tight">Finanças da família, em harmonia.</h2>
          <p className="mt-4 text-lg text-verde-borda">Enxergue o todo, combinem prioridades e cuidem do dinheiro com mais clareza.</p>
          <ul className="mt-10 space-y-3 text-sm">
            {['Organizar juntos', 'Planejar com clareza', 'Viver melhor'].map((t) => (
              <li key={t} className="flex items-center gap-3">
                <span className="h-2 w-2 rounded-full bg-dourado" aria-hidden="true" />
                {t}
              </li>
            ))}
          </ul>
        </div>
        <p className="text-xs text-verde-borda">Painel da família</p>
      </section>

      <section className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex flex-col items-center text-center lg:items-start lg:text-left">
            <LacoSymbol size={48} className="lg:hidden" />
            <h1 className="mt-3 text-2xl font-bold text-verde lg:mt-0">Que bom ter você aqui</h1>
            <p className="mt-1 text-sm text-apoio">Entre para acompanhar o mês da família.</p>
          </div>
          <form action={loginAction} className="space-y-4 rounded-lg border border-borda bg-superficie p-6">
            {sp.expired && <p className="rounded-md bg-dourado-claro px-3 py-2 text-sm text-dourado-texto">Sua sessão terminou por inatividade. É só entrar de novo.</p>}
            {sp.err && <p className="rounded-md bg-despesa-claro px-3 py-2 text-sm text-despesa">{sp.err}</p>}
            <input type="hidden" name="next" value={sp.next ?? ''} />
            <div>
              <label className="label" htmlFor="email">E-mail</label>
              <input className="input" id="email" name="email" type="email" required autoComplete="username" defaultValue={sp.email ?? ''} />
            </div>
            <div>
              <label className="label" htmlFor="password">Senha</label>
              <input className="input" id="password" name="password" type="password" required autoComplete="current-password" />
            </div>
            <SubmitButton className="btn w-full" pendingText="Entrando...">Entrar</SubmitButton>
          </form>
          <p className="mt-4 text-center text-xs text-apoio">Ambiente local: marco@laco.example · Demo@1234</p>
        </div>
      </section>
    </main>
  );
}
