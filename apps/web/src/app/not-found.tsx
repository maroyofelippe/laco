import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-6 text-center">
      <h1 className="text-lg font-semibold">Página não encontrada</h1>
      <p className="mt-1 text-sm text-apoio">A família não existe ou você não tem acesso a ela.</p>
      <Link href="/familias" className="btn mt-6">Voltar às minhas famílias</Link>
    </main>
  );
}
