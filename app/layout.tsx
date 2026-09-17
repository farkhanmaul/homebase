import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Nongkrong Kantor',
  description: 'Ruang virtual kecil untuk geng kantor.',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="id"><body>{children}</body></html>;
}
