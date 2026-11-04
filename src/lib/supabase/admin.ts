import { createClient as createSupabaseClient, type SupabaseClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { createClient } from './server';

type AdminResult = { db: SupabaseClient } | { error: NextResponse };

// Valida que la petición venga de una sesión con rol admin y devuelve un
// cliente con la clave secreta para operar sobre Storage.
export async function requireAdmin(): Promise<AdminResult> {
  const session = await createClient();
  const { data: { user } } = await session.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: 'Inicia sesión para continuar.' }, { status: 401 }) };

  const { data: profile } = await session.from('perfiles').select('rol').eq('id', user.id).single();
  if (profile?.rol !== 'admin') {
    return { error: NextResponse.json({ error: 'Solo administración puede gestionar los reportes.' }, { status: 403 }) };
  }

  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return { error: NextResponse.json({ error: 'Falta configurar la clave secreta de Supabase en el servidor.' }, { status: 503 }) };
  }

  return {
    db: createSupabaseClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } }),
  };
}
