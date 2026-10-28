import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextRequest, NextResponse } from 'next/server';

function serviceClient() {
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return null;
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) return null;
  return createSupabaseClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const username = typeof body?.username === 'string' ? body.username.trim().toLowerCase() : '';
  const password = body?.password;
  if (!username || typeof password !== 'string' || !password) {
    return NextResponse.json({ error: 'Escribe tu usuario y contraseña.' }, { status: 400 });
  }
  const admin = serviceClient();
  if (!admin) return NextResponse.json({ error: 'El acceso requiere configurar SUPABASE_SERVICE_ROLE_KEY en el servidor.' }, { status: 503 });

  const { data: matches, error: profileError } = await admin.from('perfiles').select('id').eq('usuario', username).eq('activo', true).limit(2);
  if (profileError) return NextResponse.json({ error: 'No se pudo identificar la cuenta. Verifica el esquema de perfiles.' }, { status: 500 });
  if (!matches?.length) return NextResponse.json({ error: 'Usuario o contraseña incorrectos.' }, { status: 401 });
  if (matches.length > 1) return NextResponse.json({ error: 'El usuario no es único. Solicita al administrador que revise los perfiles.' }, { status: 409 });

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
  if (signInError) return NextResponse.json({ error: 'Usuario o contraseña incorrectos.' }, { status: 401 });
  return response;
}
