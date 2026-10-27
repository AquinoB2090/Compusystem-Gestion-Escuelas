import { randomBytes } from 'node:crypto';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  const session = await createClient();
  const { data: { user } } = await session.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Inicia sesión para continuar.' }, { status: 401 });
  const { data: profile } = await session.from('perfiles').select('rol').eq('id', user.id).single();
  if (profile?.rol !== 'admin') return NextResponse.json({ error: 'Solo administración puede crear directores.' }, { status: 403 });

  const { nombre, email, escuela_id } = await request.json();
  if (!String(nombre || '').trim() || !String(email || '').trim() || !Number(escuela_id)) {
    return NextResponse.json({ error: 'Completa el nombre, correo y escuela.' }, { status: 400 });
  }
  const secret = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) return NextResponse.json({ error: 'Falta configurar SUPABASE_SERVICE_ROLE_KEY en el servidor.' }, { status: 503 });
  const admin = createSupabaseClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, secret, { auth: { autoRefreshToken: false, persistSession: false } });
  const password = `${randomBytes(15).toString('base64url')}aA1!`;
  const { data, error } = await admin.auth.admin.createUser({ email: String(email).trim(), password, email_confirm: true });
  if (error || !data.user) return NextResponse.json({ error: error?.message || 'No se pudo crear el usuario.' }, { status: 400 });
  const { error: profileError } = await admin.from('perfiles').insert({ id: data.user.id, nombre: String(nombre).trim(), rol: 'director', escuela_id: Number(escuela_id) });
  if (profileError) {
    await admin.auth.admin.deleteUser(data.user.id);
    return NextResponse.json({ error: profileError.message }, { status: 400 });
  }
  return NextResponse.json({ email: String(email).trim(), password }, { status: 201 });
}
