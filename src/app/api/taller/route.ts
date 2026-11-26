import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

const transitions: Record<string, string[]> = {
  recibido: ['diagnostico', 'cancelado'],
  diagnostico: ['esperando_autorizacion', 'no_reparable', 'cancelado'],
  esperando_autorizacion: ['autorizado', 'no_reparable', 'cancelado'],
  autorizado: ['reparacion', 'cancelado'],
  reparacion: ['listo', 'no_reparable', 'cancelado'],
  listo: ['reparacion', 'entregado'],
  no_reparable: ['entregado', 'cancelado'],
  entregado: [],
  cancelado: [],
};

async function authorized() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: 'Inicia sesión.' }, { status: 401 }) };
  const { data: profile } = await supabase.from('perfiles').select('rol').eq('id', user.id).eq('activo', true).maybeSingle();
  if (!profile || !['admin', 'ventas'].includes(profile.rol)) return { error: NextResponse.json({ error: 'No tienes acceso al taller.' }, { status: 403 }) };
  return { supabase, user };
}

export async function GET(request: Request) {
  const auth = await authorized(); if ('error' in auth) return auth.error;
  const url = new URL(request.url); const estado = url.searchParams.get('estado'); const q = url.searchParams.get('q')?.trim();
  let query = auth.supabase.from('taller_ordenes').select('*').order('creado_en', { ascending: false }).limit(200);
  if (estado === 'activas') query = query.not('estado', 'in', '(entregado,cancelado,no_reparable)');
  else if (estado && estado !== 'todas' && Object.hasOwn(transitions, estado)) query = query.eq('estado', estado);
  if (q) {
    const safe = q.replace(/[^\p{L}\p{N}\s@._-]/gu, ' ').trim();
    if (safe) query = query.or(`cliente_nombre.ilike.%${safe}%,equipo.ilike.%${safe}%,problema_reportado.ilike.%${safe}%,numero.eq.${Number(safe) || -1}`);
  }
  const [ordersResult, activeResult, readyResult] = await Promise.all([
    query,
    auth.supabase.from('taller_ordenes').select('id', { count: 'exact', head: true }).not('estado', 'in', '(entregado,cancelado,no_reparable)'),
    auth.supabase.from('taller_ordenes').select('id', { count: 'exact', head: true }).eq('estado', 'listo'),
  ]);
  const { data, error } = ordersResult;
  if (error || activeResult.error || readyResult.error) return NextResponse.json({ error: error?.message || activeResult.error?.message || readyResult.error?.message }, { status: 500 });
  const ids = (data ?? []).map((order) => order.id);
  const { data: historial, error: historyError } = ids.length
    ? await auth.supabase.from('taller_historial').select('orden_id,estado_anterior,estado_nuevo,detalle,creado_en').in('orden_id', ids).order('creado_en', { ascending: false })
    : { data: [], error: null };
  if (historyError) return NextResponse.json({ error: historyError.message }, { status: 500 });
  return NextResponse.json({ ordenes: data ?? [], historial: historial ?? [], counts: { activas: activeResult.count ?? 0, listas: readyResult.count ?? 0 } });
}

export async function POST(request: Request) {
  const auth = await authorized(); if ('error' in auth) return auth.error;
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'La solicitud no contiene datos válidos.' }, { status: 400 }); }
  const required = ['cliente_nombre', 'cliente_telefono', 'equipo', 'problema_reportado'];
  if (required.some((key) => typeof body[key] !== 'string' || !(body[key] as string).trim())) return NextResponse.json({ error: 'Completa cliente, teléfono, equipo y problema reportado.' }, { status: 400 });
  const { data, error } = await auth.supabase.from('taller_ordenes').insert({
    cliente_nombre: (body.cliente_nombre as string).trim(), cliente_telefono: (body.cliente_telefono as string).trim(), cliente_correo: typeof body.cliente_correo === 'string' ? body.cliente_correo.trim() || null : null,
    equipo: (body.equipo as string).trim(), marca: body.marca || null, modelo: body.modelo || null, serie: body.serie || null,
    accesorios: body.accesorios || null, condicion_recepcion: body.condicion_recepcion || null, problema_reportado: (body.problema_reportado as string).trim(), creado_por: auth.user.id,
  }).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ orden: data }, { status: 201 });
}

export async function PATCH(request: Request) {
  const auth = await authorized(); if ('error' in auth) return auth.error;
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'La solicitud no contiene datos válidos.' }, { status: 400 }); }
  const id = Number(body.id);
  if (!Number.isSafeInteger(id) || id < 1) return NextResponse.json({ error: 'Orden inválida.' }, { status: 400 });
  const { data: prev, error: readError } = await auth.supabase.from('taller_ordenes').select('estado,diagnostico,presupuesto').eq('id', id).single();
  if (readError || !prev) return NextResponse.json({ error: 'No se encontró la orden.' }, { status: 404 });
  const patch: Record<string, unknown> = { actualizado_en: new Date().toISOString() };
  if (body.estado && body.estado !== prev.estado) {
    if (typeof body.estado !== 'string' || !transitions[prev.estado]?.includes(body.estado)) return NextResponse.json({ error: 'Ese cambio no sigue el flujo de servicio. Revisa el estado actual de la orden.' }, { status: 400 });
    patch.estado = body.estado;
  }
  if (typeof body.diagnostico === 'string') patch.diagnostico = body.diagnostico.trim();
  if (body.presupuesto === null || (typeof body.presupuesto === 'number' && Number.isFinite(body.presupuesto) && body.presupuesto >= 0)) patch.presupuesto = body.presupuesto;
  if (typeof body.notas === 'string') patch.notas = body.notas.trim();
  const diagnosis = typeof patch.diagnostico === 'string' ? patch.diagnostico : prev.diagnostico;
  const budget = typeof patch.presupuesto === 'number' ? patch.presupuesto : prev.presupuesto;
  if (patch.estado === 'esperando_autorizacion' && (!diagnosis?.trim() || budget == null)) return NextResponse.json({ error: 'Guarda el diagnóstico y el presupuesto antes de solicitar autorización.' }, { status: 400 });
  if (patch.estado === 'entregado') patch.entregado_en = new Date().toISOString();
  const { data, error } = await auth.supabase.from('taller_ordenes').update(patch).eq('id', id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ orden: data });
}
