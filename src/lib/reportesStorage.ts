import type { SupabaseClient } from '@supabase/supabase-js';
import type { ReportType } from './clientStatement';

export const REPORT_BUCKET = 'reportes';

const REPORT_FILE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})_(\d{2})(\d{2})(?:-\d+)?_(desde_ultimo_abono|completo|rango)\.pdf$/;

export type ParsedReportFile = {
  archivo: string;
  tipo: ReportType;
  fecha: string;
  hora: string;
  sortKey: string;
  stamp: string;
};

export function isReportType(value: unknown): value is ReportType {
  return value === 'desde_ultimo_abono' || value === 'completo' || value === 'rango';
}

export function parseReportFilename(name: string): ParsedReportFile | null {
  const match = REPORT_FILE_PATTERN.exec(name);
  if (!match) return null;

  const [, year, month, day, hour, minute, tipo] = match;
  const monthNumber = Number(month);
  const dayNumber = Number(day);
  const hourNumber = Number(hour);
  const minuteNumber = Number(minute);
  if (
    monthNumber < 1 || monthNumber > 12
    || dayNumber < 1 || dayNumber > 31
    || hourNumber < 0 || hourNumber > 23
    || minuteNumber < 0 || minuteNumber > 59
  ) return null;

  return {
    archivo: name,
    tipo: tipo as ReportType,
    fecha: `${day}/${month}/${year}`,
    hora: `${hour}:${minute}`,
    sortKey: `${year}${month}${day}${hour}${minute}`,
    stamp: `${year}-${month}-${day}_${hour}${minute}`,
  };
}

let bucketPromise: Promise<void> | null = null;

// El bucket se crea la primera vez que se usa. Es almacenamiento de archivos,
// no una tabla: el historial se deriva únicamente de los nombres de los PDF.
export async function ensureReportBucket(db: SupabaseClient) {
  if (!bucketPromise) {
    bucketPromise = (async () => {
      const existing = await db.storage.getBucket(REPORT_BUCKET);
      if (existing.data) return;
      if (existing.error && !/not found|does not exist/i.test(existing.error.message)) {
        throw new Error(existing.error.message);
      }
      const created = await db.storage.createBucket(REPORT_BUCKET, { public: false });
      if (created.error && !/already exists/i.test(created.error.message)) {
        throw new Error(created.error.message);
      }
    })().catch((error) => {
      bucketPromise = null;
      throw error;
    });
  }
  return bucketPromise;
}

export async function listReportFiles(db: SupabaseClient, clienteId: number) {
  await ensureReportBucket(db);
  const { data, error } = await db.storage
    .from(REPORT_BUCKET)
    .list(String(clienteId), { limit: 200, sortBy: { column: 'name', order: 'desc' } });
  if (error) throw new Error(error.message);

  return (data || [])
    .map((file) => parseReportFilename(file.name))
    .filter((file): file is ParsedReportFile => Boolean(file))
    .sort((a, b) => b.sortKey.localeCompare(a.sortKey) || b.archivo.localeCompare(a.archivo));
}

export async function putReportFile(
  db: SupabaseClient,
  clienteId: number,
  archivo: string,
  bytes: Buffer,
) {
  const parsed = parseReportFilename(archivo);
  if (!parsed) throw new Error('El nombre del reporte no es válido.');

  await ensureReportBucket(db);
  const bucket = db.storage.from(REPORT_BUCKET);

  for (let attempt = 0; attempt < 50; attempt += 1) {
    const candidate = attempt === 0
      ? archivo
      : `${parsed.stamp}-${attempt + 1}_${parsed.tipo}.pdf`;
    const { error } = await bucket.upload(`${clienteId}/${candidate}`, bytes, {
      contentType: 'application/pdf',
      upsert: false,
    });
    if (!error) return candidate;
    if (!/already exists|duplicate/i.test(error.message)) throw new Error(error.message);
  }

  throw new Error('No se pudo guardar el reporte: demasiados archivos con el mismo nombre.');
}

export async function downloadReportFile(db: SupabaseClient, clienteId: number, archivo: string) {
  await ensureReportBucket(db);
  const { data, error } = await db.storage
    .from(REPORT_BUCKET)
    .download(`${clienteId}/${archivo}`);
  if (error || !data) throw new Error(error?.message || 'El reporte ya no existe.');
  return data;
}

export async function removeReportFile(db: SupabaseClient, clienteId: number, archivo: string) {
  await ensureReportBucket(db);
  const { error } = await db.storage
    .from(REPORT_BUCKET)
    .remove([`${clienteId}/${archivo}`]);
  if (error) throw new Error(error.message);
}
