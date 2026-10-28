import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

export async function PATCH(request: Request) {
  const session = await createClient();
  const { data: { user } } = await session.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Inicia sesión para continuar.' }, { status: 401 });
  const { data: profile } = await session.from('perfiles').select('rol').eq('id', user.id).single();
  if (profile?.rol !== 'admin') return NextResponse.json({ error: 'Solo administración puede editar movimientos.' }, { status: 403 });

  const body = await request.json().catch(() => null);
  const tipo = body?.tipo;
  const id = Number(body?.id);
  const cantidad = Number(body?.cantidad ?? body?.copias);
  const unidad = body?.unidad === 'quetzales' ? 'quetzales' : 'fotocopias';
  const validAmount = Number.isFinite(cantidad) && cantidad > 0 && (unidad === 'quetzales' || Number.isInteger(cantidad));
  if (!['consumo', 'asignacion'].includes(tipo) || !Number.isInteger(id) || id < 1 || !validAmount) {
    return NextResponse.json({ error: 'Revisa el movimiento y la cantidad ingresada.' }, { status: 400 });
  }

  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ error: 'Falta configurar la clave secreta de Supabase en el servidor.' }, { status: 503 });
  const admin = createSupabaseClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
  const table = tipo === 'consumo' ? 'consumos' : 'asignaciones';
  const values: Record<string, string | number> = tipo === 'consumo'
    ? { fecha: String(body?.fecha || ''), periodo: `${String(body?.fecha || '').slice(0,7)}-01`, catedratico: String(body?.descripcion || body?.catedratico || '').trim(), descripcion: String(cantidad), monto: unidad === 'fotocopias' ? cantidad / 4 : cantidad, unidad }
    : { monto: cantidad / 4, unidad_ingresada: 'fotocopias' };
  if (tipo === 'consumo' && (!String(values.fecha || '') || !String(values.catedratico || '') || !/^\d{4}-\d{2}-\d{2}$/.test(String(values.fecha || '')))) {
    return NextResponse.json({ error: 'Completa una fecha válida y una descripción.' }, { status: 400 });
  }
  const { error } = await admin.from(table).update(values).eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
