import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  const session = await createClient();
  const { data: { user } } = await session.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Inicia sesión para continuar.' }, { status: 401 });
  const { data: profile } = await session.from('perfiles').select('rol').eq('id', user.id).single();
  if (profile?.rol !== 'admin') return NextResponse.json({ error: 'Solo administración puede anular movimientos.' }, { status: 403 });

  const body = await request.json().catch(() => null);
  const tipo = body?.tipo;
  const id = Number(body?.id);
  if (!['consumo', 'asignacion'].includes(tipo) || !Number.isInteger(id) || id < 1) {
    return NextResponse.json({ error: 'Movimiento inválido.' }, { status: 400 });
  }

  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ error: 'Falta configurar la clave secreta de Supabase en el servidor.' }, { status: 503 });
  const admin = createSupabaseClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
  const table = tipo === 'consumo' ? 'consumos' : 'asignaciones';
  const flag = tipo === 'consumo' ? 'anulado' : 'anulada';
  const { data: movement, error: readError } = await admin.from(table).select('maestro_id').eq('id', id).single();
  if (readError || !movement) return NextResponse.json({ error: readError?.message || 'No se encontró el movimiento.' }, { status: 404 });
  const { error } = await admin.from(table).update({ [flag]: true }).eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  const { data: balance } = await admin.from('saldo_maestro').select('saldo').eq('maestro_id', movement.maestro_id).maybeSingle();
  return NextResponse.json({ ok: true, saldo: balance?.saldo ?? null });
}
