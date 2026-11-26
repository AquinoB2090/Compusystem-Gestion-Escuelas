import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import ModuleNavbar from '../ui/ModuleNavbar';
import './taller.css';

export const metadata = { title: 'Taller · Compusystem', description: 'Órdenes de servicio y reparación de equipos.' };

export default async function TallerLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  const { data: profile } = await supabase.from('perfiles').select('nombre,rol').eq('id', user.id).eq('activo', true).maybeSingle();
  if (!profile || !['admin', 'ventas'].includes(profile.rol)) redirect('/');
  const roleName = profile.rol === 'admin' ? 'Administración' : 'Ventas';
  return <div className="workshop-app installation-app">
    <aside className="installation-sidebar">
      <a className="installation-brand-lockup" href="/taller"><span className="installation-logo">C</span><span><b>Compusystem</b><small>TALLER TÉCNICO</small></span></a>
      <div className="installation-nav-label">SERVICIO TÉCNICO</div>
      <nav className="installation-nav" aria-label="Navegación del taller"><a href="/taller" aria-current="page"><span>▣</span>Órdenes de servicio</a></nav>
      <div className="installation-sidebar-bottom"><div className="installation-user"><span>{profile.nombre.slice(0, 1).toUpperCase()}</span><div><b>{profile.nombre}</b><small>{roleName}</small></div></div><form action="/auth/signout" method="post"><button className="installation-logout">Cerrar sesión</button></form></div>
    </aside>
    <header className="installation-mobile-header"><a className="installation-brand-lockup" href="/taller"><span className="installation-logo">C</span><span><b>Compusystem</b><small>TALLER TÉCNICO</small></span></a><form action="/auth/signout" method="post"><button className="installation-logout">Salir</button></form></header>
    <main className="installation-main"><ModuleNavbar active="taller" available={profile.rol === 'admin' ? ['escuela', 'instalaciones', 'taller'] : ['instalaciones', 'taller']} /><div className="installation-main-inner">{children}</div></main>
  </div>;
}
