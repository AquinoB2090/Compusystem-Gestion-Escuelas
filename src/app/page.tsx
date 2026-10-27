import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import Dashboard from './ui/Dashboard';
export default async function Home() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  const { data: profile } = await supabase.from('perfiles').select('nombre,rol,escuela_id,escuelas(nombre)').eq('id', user.id).eq('activo', true).single();
  if (!profile) return <main className="center"><section className="card"><h1>Cuenta pendiente de configurar</h1><p>Tu usuario todavía no tiene perfil. Pide al administrador que te asigne un rol y una escuela.</p><form action="/auth/signout" method="post"><button className="button secondary">Cerrar sesión</button></form></section></main>;
  return <Dashboard profile={profile as any} email={user.email ?? ''} />;
}
