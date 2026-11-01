import '@fontsource-variable/nunito-sans';
import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'Laço', template: '%s · Laço' },
  description: 'Finanças da família, em harmonia. Organizar juntos. Planejar com clareza. Viver melhor.',
  applicationName: 'Laço',
};

export const viewport: Viewport = { themeColor: '#174B43' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
