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
  if (profile?.rol !== 'admin') return NextResponse.json({ error: 'Solo administración puede editar saldos.' }, { status: 403 });

  const body = await request.json().catch(() => null);
  const maestroId = Number(body?.maestro_id);
  const copias = Number(body?.saldo_fotocopias);
  if (!Number.isInteger(maestroId) || maestroId < 1 || !Number.isInteger(copias) || copias < 0) {
    return NextResponse.json({ error: 'Indica un saldo entero de fotocopias.' }, { status: 400 });
  }

  const admin = serviceClient();
  if (!admin) return NextResponse.json({ error: 'Falta configurar la clave secreta de Supabase en el servidor.' }, { status: 503 });
  const [{ data: teacher, error: teacherError }, { data: balance, error: balanceError }] = await Promise.all([
    admin.from('maestros').select('id,escuela_id').eq('id', maestroId).single(),
    admin.from('saldo_maestro').select('saldo').eq('maestro_id', maestroId).single(),
  ]);
  if (teacherError || !teacher) return NextResponse.json({ error: 'No se encontró el maestro.' }, { status: 404 });
  if (balanceError || !balance) return NextResponse.json({ error: 'No se pudo leer el saldo actual.' }, { status: 500 });

  const delta = Number((copias / 4 - Number(balance.saldo)).toFixed(2));
  if (delta === 0) return NextResponse.json({ ok: true, unchanged: true });
  const { error } = await admin.from('ajustes_saldo').insert({
    maestro_id: maestroId,
    escuela_id: teacher.escuela_id,
    saldo_delta: delta,
    motivo: 'Edición administrativa de saldo',
    creado_por: user.id,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true, saldo_fotocopias: copias });
}
