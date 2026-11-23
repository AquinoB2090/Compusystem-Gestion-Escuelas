import './globals.css';
import type { Metadata } from 'next';
import Toaster from './ui/Toaster';
export const metadata: Metadata = {
  title: 'Compusystem · Saldos de fotocopias',
  description: 'Control mensual de asignaciones y consumos por maestro.',
  other: {
    'facebook-domain-verification': 'ylse8zpmg6vi69v9hflp5mx9oxq61s',
  },
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="es"><body>{children}<Toaster /></body></html>; }
