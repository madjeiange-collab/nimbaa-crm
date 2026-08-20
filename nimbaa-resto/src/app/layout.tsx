import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Nimbaa Resto',
  description: 'Prise de commande, cuisine et encaissement.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
