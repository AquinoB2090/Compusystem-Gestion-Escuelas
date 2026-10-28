import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

function serviceClient() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createSupabaseClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

export async function POST(request: Request) {
  const session = await createClient();
  const { data: { user } } = await session.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Inicia sesión para continuar.' }, { status: 401 });

  const { data: profile } = await session.from('perfiles').select('rol').eq('id', user.id).single();
  if (profile?.rol !== 'admin') return NextResponse.json({ error: 'Solo administración puede agregar escuelas.' }, { status: 403 });

  const body = await request.json().catch(() => null);
  const nombre = String(body?.nombre || '').trim();
  const directorNombre = String(body?.director_nombre || '').trim();
  const password = typeof body?.password === 'string' ? body.password : '';
  const codigo = String(body?.codigo || '').trim();
  if (!nombre || !directorNombre || password.length < 8) {
    return NextResponse.json({ error: 'Completa el nombre de la escuela, el nombre del director y una contraseña de al menos 8 caracteres.' }, { status: 400 });
  }

  const admin = serviceClient();
  if (!admin) return NextResponse.json({ error: 'Falta configurar SUPABASE_SECRET_KEY en el servidor.' }, { status: 503 });

  const schoolValues: { nombre: string; activa: boolean; codigo?: string } = { nombre, activa: true };
  if (codigo) schoolValues.codigo = codigo;
  const { data: school, error: schoolError } = await admin.from('escuelas').insert(schoolValues).select('id,nombre').single();
  if (schoolError || !school) return NextResponse.json({ error: schoolError?.message || 'No se pudo crear la escuela.' }, { status: 400 });

  const username = `director${school.id}`;
  const email = `${username}@example.com`;
  const { data: authData, error: authError } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (authError || !authData.user) {
    await admin.from('escuelas').delete().eq('id', school.id);
    return NextResponse.json({ error: authError?.message || 'No se pudo crear el usuario del director.' }, { status: 400 });
  }

  const { error: profileError } = await admin.from('perfiles').insert({
    id: authData.user.id,
    nombre: directorNombre,
    usuario: username,
    rol: 'director',
    escuela_id: school.id,
  });
  if (profileError) {
    await admin.auth.admin.deleteUser(authData.user.id);
    await admin.from('escuelas').delete().eq('id', school.id);
    return NextResponse.json({ error: profileError.message }, { status: 400 });
  }

  return NextResponse.json({ school, username }, { status: 201 });
}
