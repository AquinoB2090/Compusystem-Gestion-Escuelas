import type { Metadata } from 'next';
import { requireInstallationRole } from './access';
import InstallationNavigation from './InstallationNavigation';
import ModuleNavbar from '../ui/ModuleNavbar';
import './instalaciones.css';

export const metadata: Metadata = { title: 'Instalaciones · Compusystem', description: 'Gestión de precios y cotizaciones de instalaciones.' };

export default async function InstalacionesLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const { profile } = await requireInstallationRole();
  return <div className="installation-app">
    <InstallationNavigation role={profile.rol} name={profile.nombre} />
    <main className="installation-main">
      <ModuleNavbar active="instalaciones" available={profile.rol === 'admin' ? ['escuela', 'instalaciones', 'taller', 'control'] : ['instalaciones', 'taller']} />
      <div className="installation-main-inner">{children}</div>
    </main>
  </div>;
}
