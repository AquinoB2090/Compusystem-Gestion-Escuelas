import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

const transitions: Record<string, string[]> = {
  recibido: ['diagnostico', 'cancelado', 'entregado'],
  diagnostico: ['esperando_autorizacion', 'no_reparable', 'cancelado', 'entregado'],
  esperando_autorizacion: ['autorizado', 'no_reparable', 'cancelado', 'entregado'],
  autorizado: ['reparacion', 'cancelado', 'entregado'],
  reparacion: ['listo', 'no_reparable', 'cancelado', 'entregado'],
  listo: ['reparacion', 'entregado'],
  no_reparable: ['entregado', 'cancelado'],
  entregado: [],
  cancelado: ['recibido', 'entregado'],
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
  const url = new URL(request.url), estado = url.searchParams.get('estado'), q = url.searchParams.get('q')?.trim();
  let query = auth.supabase.from('taller_ordenes').select('*').order('creado_en', { ascending: false }).limit(200);
  if (estado === 'activas') query = query.not('estado', 'in', '(entregado,cancelado,no_reparable)');
  else if (estado && estado !== 'todas' && Object.hasOwn(transitions, estado)) query = query.eq('estado', estado);
  if (q) {
    const safe = q.replace(/[^\p{L}\p{N}\s@._-]/gu, ' ').trim();
    if (safe) query = query.or(`cliente_nombre.ilike.%${safe}%,cliente_telefono.ilike.%${safe}%,equipo.ilike.%${safe}%,modelo.ilike.%${safe}%,serie.ilike.%${safe}%,problema_reportado.ilike.%${safe}%,numero.eq.${Number(safe) || -1}`);
  }
  const [ordersResult, deliveredCount, pendingCount] = await Promise.all([
    query,
    auth.supabase.from('taller_ordenes').select('id', { count: 'exact', head: true }).eq('estado', 'entregado'),
    auth.supabase.from('taller_ordenes').select('id', { count: 'exact', head: true }).not('estado', 'in', '(entregado,cancelado,no_reparable)'),
  ]);
  const { data, error } = ordersResult;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (deliveredCount.error || pendingCount.error) return NextResponse.json({ error: deliveredCount.error?.message || pendingCount.error?.message }, { status: 500 });
  let totalCobrado = 0;
  for (let offset=0; ; offset+=1000) {
    const { data: amounts, error: amountError } = await auth.supabase.from('taller_ordenes').select('monto_cobrado').range(offset,offset+999);
    if (amountError) return NextResponse.json({error:amountError.message},{status:500});
    totalCobrado += (amounts||[]).reduce((sum,row)=>sum+Number(row.monto_cobrado||0),0);
    if (!amounts || amounts.length < 1000) break;
  }
  return NextResponse.json({ ordenes: data ?? [], resumen: { trabajados: deliveredCount.count ?? 0, pendientes: pendingCount.count ?? 0, totalCobrado } });
}

export async function POST(request: Request) {
  const auth = await authorized(); if ('error' in auth) return auth.error;
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'La solicitud no contiene datos válidos.' }, { status: 400 }); }
  const required = ['cliente_nombre', 'cliente_telefono', 'equipo', 'problema_reportado'];
  if (required.some((key) => typeof body[key] !== 'string' || !(body[key] as string).trim())) {
    return NextResponse.json({ error: 'Completa cliente, teléfono, equipo y problema reportado.' }, { status: 400 });
  }
  const { data, error } = await auth.supabase.from('taller_ordenes').insert({
    cliente_nombre: (body.cliente_nombre as string).trim(),
    cliente_telefono: (body.cliente_telefono as string).trim(),
    equipo: (body.equipo as string).trim(),
    marca: typeof body.marca === 'string' ? body.marca.trim() || null : null,
    modelo: typeof body.modelo === 'string' ? body.modelo.trim() || null : null,
    serie: typeof body.serie === 'string' ? body.serie.trim() || null : null,
    accesorios: typeof body.accesorios === 'string' ? body.accesorios.trim() || null : null,
    condicion_recepcion: typeof body.condicion_recepcion === 'string' ? body.condicion_recepcion.trim() || null : null,
    problema_reportado: (body.problema_reportado as string).trim(),
    creado_por: auth.user.id,
    tecnico: typeof body.tecnico === 'string' ? body.tecnico.trim() || null : null,
    garantia_dias: Number.isSafeInteger(Number(body.garantia_dias)) && Number(body.garantia_dias) >= 0 ? Number(body.garantia_dias) : 30,
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
  const { data: prev, error: readError } = await auth.supabase.from('taller_ordenes').select('estado,garantia_dias').eq('id', id).single();
  if (readError || !prev) return NextResponse.json({ error: 'No se encontró la orden.' }, { status: 404 });
  const patch: Record<string, unknown> = { actualizado_en: new Date().toISOString() };

  if (body.estado != null && body.estado !== prev.estado) {
    if (typeof body.estado !== 'string' || !transitions[prev.estado]?.includes(body.estado)) {
      return NextResponse.json({ error: 'Ese cambio no sigue el flujo de servicio.' }, { status: 400 });
    }
    patch.estado = body.estado;
  }
  if (typeof body.diagnostico === 'string') patch.diagnostico = body.diagnostico.trim();
  if (typeof body.trabajo_realizado === 'string') patch.trabajo_realizado = body.trabajo_realizado.trim();
  if (body.monto_cobrado !== undefined) {
    const monto = body.monto_cobrado === '' || body.monto_cobrado === null ? 0 : Number(body.monto_cobrado);
    if (!Number.isFinite(monto) || monto < 0) return NextResponse.json({ error: 'El monto cobrado no es válido.' }, { status: 400 });
    patch.monto_cobrado = monto;
  }
  if (patch.estado === 'entregado') {
    patch.entregado_en = new Date().toISOString();
    patch.garantia_hasta = new Date(Date.now() + Number(prev.garantia_dias ?? 30) * 86400000).toISOString().slice(0, 10);
  }

  const { data, error } = await auth.supabase.from('taller_ordenes').update(patch).eq('id', id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ orden: data });
}
