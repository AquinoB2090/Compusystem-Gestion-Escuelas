import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/supabase/admin';
import {
  isReportType,
  listReportFiles,
  parseReportFilename,
  putReportFile,
} from '@/lib/reportesStorage';

const MAX_REPORT_BYTES = 12 * 1024 * 1024;

const parseClientId = (value: string | null) => {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
};

export async function GET(request: Request) {
  const auth = await requireAdmin();
  if ('error' in auth) return auth.error;

  const clienteId = parseClientId(new URL(request.url).searchParams.get('cliente_id'));
  if (!clienteId) return NextResponse.json({ error: 'Cliente inválido.' }, { status: 400 });

  try {
    const reports = await listReportFiles(auth.db, clienteId);
    return NextResponse.json({ reports });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'No se pudo leer el historial de reportes.' },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  const auth = await requireAdmin();
  if ('error' in auth) return auth.error;

  const params = new URL(request.url).searchParams;
  const clienteId = parseClientId(params.get('cliente_id'));
  const tipo = params.get('tipo') || '';
  const archivo = params.get('archivo') || '';

  if (!clienteId) return NextResponse.json({ error: 'Cliente inválido.' }, { status: 400 });
  if (!isReportType(tipo)) return NextResponse.json({ error: 'Tipo de reporte inválido.' }, { status: 400 });

  const parsed = parseReportFilename(archivo);
  if (!parsed || parsed.tipo !== tipo) {
    return NextResponse.json({ error: 'El nombre del reporte no es válido.' }, { status: 400 });
  }

  const { data: client, error: clientError } = await auth.db
    .from('clientes_individuales')
    .select('id')
    .eq('id', clienteId)
    .maybeSingle();
  if (clientError) return NextResponse.json({ error: clientError.message }, { status: 500 });
  if (!client) return NextResponse.json({ error: 'El cliente no existe.' }, { status: 404 });

  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > MAX_REPORT_BYTES) {
    return NextResponse.json({ error: 'El reporte es demasiado grande.' }, { status: 413 });
  }
  if (!(request.headers.get('content-type') || '').includes('application/pdf')) {
    return NextResponse.json({ error: 'El archivo debe ser un PDF.' }, { status: 415 });
  }

  const bytes = Buffer.from(await request.arrayBuffer());
  if (bytes.length < 5 || bytes.subarray(0, 5).toString('ascii') !== '%PDF-') {
    return NextResponse.json({ error: 'El archivo no es un PDF válido.' }, { status: 400 });
  }
  if (bytes.length > MAX_REPORT_BYTES) {
    return NextResponse.json({ error: 'El reporte es demasiado grande.' }, { status: 413 });
  }

  try {
    const savedAs = await putReportFile(auth.db, clienteId, archivo, bytes);
    return NextResponse.json({ ok: true, archivo: savedAs });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'No se pudo guardar el reporte.' },
      { status: 500 },
    );
  }
}
