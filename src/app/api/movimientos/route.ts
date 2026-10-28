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
  const copias = Number(body?.copias);
  if (!['consumo', 'asignacion'].includes(tipo) || !Number.isInteger(id) || id < 1 || !Number.isInteger(copias) || copias < 1) {
    return NextResponse.json({ error: 'Revisa el movimiento y escribe una cantidad entera de fotocopias.' }, { status: 400 });
  }

  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ error: 'Falta configurar la clave secreta de Supabase en el servidor.' }, { status: 503 });
  const admin = createSupabaseClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
  const table = tipo === 'consumo' ? 'consumos' : 'asignaciones';
  const values = tipo === 'consumo'
    ? { fecha: String(body?.fecha || ''), catedratico: String(body?.catedratico || '').trim(), descripcion: String(copias), monto: copias / 4 }
    : { monto: copias / 4, unidad_ingresada: 'fotocopias' };
  if (tipo === 'consumo' && (!values.fecha || !values.catedratico || !/^\d{4}-\d{2}-\d{2}$/.test(values.fecha))) {
    return NextResponse.json({ error: 'Completa una fecha válida y el nombre del catedrático.' }, { status: 400 });
  }
  const { error } = await admin.from(table).update(values).eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
