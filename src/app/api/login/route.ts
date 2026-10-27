import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextRequest, NextResponse } from 'next/server';

function serviceClient() {
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return null;
  return createSupabaseClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

export async function GET() {
  const admin = serviceClient();
  if (!admin) return NextResponse.json({ error: 'Falta configurar SUPABASE_SERVICE_ROLE_KEY en el servidor.' }, { status: 503 });
  const { data, error } = await admin.from('escuelas').select('id,nombre').eq('activa', true).order('nombre');
  if (error) return NextResponse.json({ error: 'No se pudieron cargar las escuelas.' }, { status: 500 });
  return NextResponse.json({ schools: data || [] });
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const role = body?.role;
  const password = body?.password;
  const schoolId = Number(body?.school_id);
  if (!['admin', 'director'].includes(role) || typeof password !== 'string' || !password || (role === 'director' && !schoolId)) {
    return NextResponse.json({ error: 'Selecciona una opción y escribe la contraseña.' }, { status: 400 });
  }
  const admin = serviceClient();
  if (!admin) return NextResponse.json({ error: 'El acceso requiere configurar SUPABASE_SERVICE_ROLE_KEY en el servidor.' }, { status: 503 });

  let profiles = admin.from('perfiles').select('id').eq('rol', role).eq('activo', true);
  if (role === 'director') profiles = profiles.eq('escuela_id', schoolId) as typeof profiles;
  const { data: matches, error: profileError } = await profiles.limit(2);
  if (profileError) return NextResponse.json({ error: 'No se pudo identificar la cuenta. Verifica el esquema de perfiles.' }, { status: 500 });
  if (!matches?.length) return NextResponse.json({ error: 'No hay una cuenta configurada para esa opción.' }, { status: 401 });
  if (matches.length > 1) return NextResponse.json({ error: role === 'admin' ? 'Configura una sola cuenta Compusystem para el acceso con contraseña.' : 'Hay más de un director configurado para esta escuela; solicita que administración revise los perfiles.' }, { status: 409 });

  const { data: { user }, error: userError } = await admin.auth.admin.getUserById(matches[0].id);
  if (userError || !user?.email) return NextResponse.json({ error: 'La cuenta no tiene un correo de acceso válido.' }, { status: 500 });

  const response = NextResponse.json({ ok: true });
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const auth = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookies: { name: string; value: string; options: CookieOptions }[]) {
        cookies.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });
  const { error: signInError } = await auth.auth.signInWithPassword({ email: user.email, password });
  if (signInError) return NextResponse.json({ error: 'Contraseña incorrecta.' }, { status: 401 });
  return response;
}
