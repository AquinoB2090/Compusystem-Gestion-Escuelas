import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/supabase/admin';
import {
  downloadReportFile,
  parseReportFilename,
  removeReportFile,
} from '@/lib/reportesStorage';

type RouteContext = { params: Promise<{ archivo: string }> };

const safeDecode = (value: string) => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

async function authorize(request: Request, context: RouteContext) {
  const auth = await requireAdmin();
  if ('error' in auth) return { error: auth.error };

  const clienteId = Number(new URL(request.url).searchParams.get('cliente_id'));
  if (!Number.isInteger(clienteId) || clienteId < 1) {
    return { error: NextResponse.json({ error: 'Cliente inválido.' }, { status: 400 }) };
  }

  const { archivo: rawArchivo } = await context.params;
  const archivo = safeDecode(rawArchivo);
  if (!parseReportFilename(archivo)) {
    return { error: NextResponse.json({ error: 'El nombre del reporte no es válido.' }, { status: 400 }) };
  }

  return { db: auth.db, clienteId, archivo };
}

export async function GET(request: Request, context: RouteContext) {
  const auth = await authorize(request, context);
  if ('error' in auth) return auth.error;

  try {
    const file = await downloadReportFile(auth.db, auth.clienteId, auth.archivo);
    const disposition = new URL(request.url).searchParams.get('descargar') === '1'
      ? 'attachment'
      : 'inline';
    return new Response(file, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `${disposition}; filename="${auth.archivo}"`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'El reporte ya no existe.' },
      { status: 404 },
    );
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  const auth = await authorize(request, context);
  if ('error' in auth) return auth.error;

  try {
    await removeReportFile(auth.db, auth.clienteId, auth.archivo);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'No se pudo eliminar el reporte.' },
      { status: 500 },
    );
  }
}
