import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="py-24 text-center">
      <h1 className="text-lg font-semibold">Página não encontrada</h1>
      <p className="mt-1 text-sm text-apoio">A família não existe ou você não tem acesso a esta área.</p>
      <Link href="/familias" className="btn mt-6">Voltar</Link>
    </div>
  );
}
