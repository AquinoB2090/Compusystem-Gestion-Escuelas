import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

function serviceClient() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? createSupabaseClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } }) : null;
}

async function authorizedAdmin() {
  const session = await createClient();
  const { data: { user } } = await session.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: 'Inicia sesión para continuar.' }, { status: 401 }) };
  const { data: profile } = await session.from('perfiles').select('rol').eq('id', user.id).single();
  if (profile?.rol !== 'admin') return { error: NextResponse.json({ error: 'Solo administración puede gestionar usuarios.' }, { status: 403 }) };
  const admin = serviceClient();
  if (!admin) return { error: NextResponse.json({ error: 'Falta configurar la clave secreta de Supabase en el servidor.' }, { status: 503 }) };
  return { admin };
}

export async function GET() {
  const access = await authorizedAdmin();
  if ('error' in access) return access.error;
  const { data, error } = await access.admin.from('perfiles')
    .select('id,nombre,usuario,rol,escuela_id,cliente_id,escuelas(nombre),clientes_individuales(nombre)')
    .order('rol').order('nombre');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ users: data || [] });
}

export async function POST(request: Request) {
  const access = await authorizedAdmin();
  if ('error' in access) return access.error;
  const body = await request.json().catch(() => null);
  const nombre = String(body?.nombre || '').trim();
  const username = String(body?.usuario || '').trim().toLowerCase();
  const password = typeof body?.password === 'string' ? body.password : '';
  const role = body?.rol;
  const schoolId = Number(body?.escuela_id) || null;
  let clientId = Number(body?.cliente_id) || null;
  const createClient = body?.crear_cliente === true || body?.crear_cliente === 'true';
  if (!nombre || !/^[a-z0-9._-]{3,32}$/.test(username) || password.length < 8 || !['admin', 'director', 'cliente'].includes(role)) {
    return NextResponse.json({ error: 'Completa nombre, usuario válido, contraseña de 8 caracteres y tipo de cuenta.' }, { status: 400 });
  }
  if (role === 'director' && !schoolId) return NextResponse.json({ error: 'Selecciona la escuela del director.' }, { status: 400 });
  if (role === 'cliente' && !clientId && !createClient) return NextResponse.json({ error: 'Selecciona o crea un cliente para vincular la cuenta.' }, { status: 400 });

  const { data: duplicate } = await access.admin.from('perfiles').select('id').ilike('usuario', username).limit(1).maybeSingle();
  if (duplicate) return NextResponse.json({ error: 'Ese usuario ya existe.' }, { status: 409 });

  let createdClientId: number | null = null;
  if (role === 'cliente' && createClient) {
    const clientName = String(body?.cliente_nombre || nombre).trim();
    const { data: client, error } = await access.admin.from('clientes_individuales').insert({ nombre: clientName, telefono: String(body?.telefono || '').trim() || null }).select('id').single();
    if (error || !client) return NextResponse.json({ error: error?.message || 'No se pudo crear el cliente.' }, { status: 400 });
    clientId = Number(client.id);
    createdClientId = clientId;
  }

  const email = `${username}@example.com`;
  const { data: authData, error: authError } = await access.admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (authError || !authData.user) {
    if (createdClientId) await access.admin.from('clientes_individuales').delete().eq('id', createdClientId);
    return NextResponse.json({ error: authError?.message || 'No se pudo crear la cuenta.' }, { status: 400 });
  }

  const { error: profileError } = await access.admin.from('perfiles').insert({
    id: authData.user.id,
    nombre,
    usuario: username,
    rol: role,
    escuela_id: role === 'director' ? schoolId : null,
    cliente_id: role === 'cliente' ? clientId : null,
  });
  if (profileError) {
    await access.admin.auth.admin.deleteUser(authData.user.id);
    if (createdClientId) await access.admin.from('clientes_individuales').delete().eq('id', createdClientId);
    return NextResponse.json({ error: profileError.message }, { status: 400 });
  }
  return NextResponse.json({ id: authData.user.id, nombre, usuario: username, rol: role, cliente_id: clientId }, { status: 201 });
}

export async function PATCH(request: Request) {
  const access = await authorizedAdmin();
  if ('error' in access) return access.error;
  const body = await request.json().catch(() => null);
  const id = String(body?.id || '');
  const username = body?.usuario === undefined ? '' : String(body.usuario).trim().toLowerCase();
  const password = typeof body?.password === 'string' ? body.password : '';
  if (!id || (!username && !password) || (username && !/^[a-z0-9._-]{3,32}$/.test(username)) || (password && password.length < 8)) {
    return NextResponse.json({ error: 'Escribe un usuario válido o una contraseña de al menos 8 caracteres.' }, { status: 400 });
  }
  if (username) {
    const { data: duplicate } = await access.admin.from('perfiles').select('id').ilike('usuario', username).neq('id', id).limit(1).maybeSingle();
    if (duplicate) return NextResponse.json({ error: 'Ese usuario ya está en uso.' }, { status: 409 });
  }
  if (password) {
    const { error } = await access.admin.auth.admin.updateUserById(id, { password });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  }
  if (username) {
    const { error } = await access.admin.from('perfiles').update({ usuario: username }).eq('id', id);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}

