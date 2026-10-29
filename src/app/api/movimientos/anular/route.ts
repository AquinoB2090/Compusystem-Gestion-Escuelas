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
  // La base exige un motivo cuando el movimiento queda anulado.
  const motivo = typeof body?.motivo === 'string' && body.motivo.trim()
    ? body.motivo.trim().slice(0, 500)
    : 'Anulación manual desde Movimientos';

  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ error: 'Falta configurar la clave secreta de Supabase en el servidor.' }, { status: 503 });
  const admin = createSupabaseClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
  const table = tipo === 'consumo' ? 'consumos' : 'asignaciones';
  const flag = tipo === 'consumo' ? 'anulado' : 'anulada';
  // `consumos` no guarda `escuela_id`; se obtiene desde el maestro.
  const columns = tipo === 'consumo' ? `maestro_id,monto,${flag}` : `maestro_id,escuela_id,monto,${flag}`;
  const { data: movementData, error: readError } = await admin.from(table).select(columns).eq('id', id).single();
  if (readError || !movementData) return NextResponse.json({ error: readError?.message || 'No se encontró el movimiento.' }, { status: 404 });
  const movement = movementData as unknown as { maestro_id: number; escuela_id?: number; monto: number } & Record<string, unknown>;
  if (movement[flag]) return NextResponse.json({ error: 'Este movimiento ya fue anulado.' }, { status: 409 });

  const { data: teacher } = await admin.from('maestros').select('escuela_id').eq('id', movement.maestro_id).single();
  const escuelaId = (movement as any).escuela_id ?? teacher?.escuela_id;

  // El saldo puede no estar disponible (por ejemplo, maestro inactivo). La
  // anulación debe completarse de todos modos; la vista ya descuenta los
  // movimientos anulados, así que solo se compensa si detectamos un desfase.
  const { data: before } = await admin.from('saldo_maestro').select('saldo').eq('maestro_id', movement.maestro_id).maybeSingle();

  const { data: annulled, error } = await admin.from(table).update({ [flag]: true, motivo_anulacion: motivo }).eq('id', id).eq(flag, false).select('id');
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  if (!annulled?.length) return NextResponse.json({ error: 'Este movimiento ya fue anulado.' }, { status: 409 });

  const { data: after } = await admin.from('saldo_maestro').select('saldo').eq('maestro_id', movement.maestro_id).maybeSingle();

  // Verifica el cambio esperado y compénsalo si la vista remota aún no resta
  // movimientos anulados. Esto evita dejar consumos cobrados tras anularlos.
  const expectedDelta = (tipo === 'consumo' ? 1 : -1) * Number(movement.monto || 0);
  if (before && after) {
    const actualDelta = Number(after.saldo) - Number(before.saldo);
    const correction = Number((expectedDelta - actualDelta).toFixed(2));
    if (Math.abs(correction) >= 0.01 && escuelaId) {
      const { error: correctionError } = await admin.from('ajustes_saldo').insert({
        maestro_id: movement.maestro_id,
        escuela_id: escuelaId,
        saldo_delta: correction,
        motivo: tipo === 'consumo' ? 'Devolución de saldo al anular consumo' : 'Ajuste al anular asignación',
        creado_por: user.id,
      });
      if (correctionError) return NextResponse.json({ error: `Se anuló el movimiento, pero no se pudo devolver el saldo: ${correctionError.message}` }, { status: 500 });
    }
  }

  const { data: balance } = await admin.from('saldo_maestro').select('saldo').eq('maestro_id', movement.maestro_id).maybeSingle();
  return NextResponse.json({ ok: true, saldo: balance?.saldo ?? null, cambio: expectedDelta });
}
