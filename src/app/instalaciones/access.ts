import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

export type InstallationRole = 'admin' | 'ventas';

export async function requireInstallationRole(allowed: InstallationRole[] = ['admin', 'ventas']) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('perfiles')
    .select('nombre,rol')
    .eq('id', user.id)
    .eq('activo', true)
    .maybeSingle();

  if (!profile || !allowed.includes(profile.rol as InstallationRole)) redirect('/');
  return { supabase, user, profile: { nombre: profile.nombre, rol: profile.rol as InstallationRole } };
}
