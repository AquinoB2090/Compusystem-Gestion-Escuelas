export type NormalizedPrice = {
  categoria: string;
  marca: string | null;
  modelo: string | null;
  nombre: string;
  descripcion: string | null;
  especificaciones: Record<string, unknown>;
  tipo: 'lista' | 'promocion';
  precio: number;
  moneda: 'GTQ' | 'USD';
  incluye_iva: boolean | null;
  vigente_desde: string | null;
  vigente_hasta: string | null;
  condiciones: string | null;
  confianza: number | null;
};

const CATEGORIES = ['Cámaras de seguridad', 'Aires acondicionados', 'Accesorios e instalación', 'Otros'];
const MAX_PRICE = 10_000_000;

export async function firmaValida(secret: string, body: Uint8Array | string, header: string | null | undefined): Promise<boolean> {
  if (!secret || !header || !header.startsWith('sha256=')) return false;
  const expectedHex = header.slice('sha256='.length);
  if (!/^[a-f\d]{64}$/i.test(expectedHex)) return false;

  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const bytes = typeof body === 'string' ? new TextEncoder().encode(body) : Uint8Array.from(body);
  const digest = new Uint8Array(await crypto.subtle.sign('HMAC', key, bytes));
  const expected = Uint8Array.from(expectedHex.match(/.{2}/g)!, (byte) => Number.parseInt(byte, 16));
  if (digest.length !== expected.length) return false;

  let difference = 0;
  for (let i = 0; i < digest.length; i++) difference |= digest[i] ^ expected[i];
  return difference === 0;
}

function text(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return normalized ? normalized.slice(0, maxLength) : null;
}

function validDate(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : null;
}

function category(value: unknown): string {
  const raw = text(value, 80);
  return CATEGORIES.find((item) => item.toLocaleLowerCase('es-GT') === raw?.toLocaleLowerCase('es-GT')) || 'Otros';
}

function cleanSpecifications(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).slice(0, 40));
}

export function normalizarItems(input: unknown): NormalizedPrice[] {
  if (!input || typeof input !== 'object' || Array.isArray(input) || !Array.isArray((input as { items?: unknown }).items)) return [];

  const normalized: NormalizedPrice[] = [];
  for (const raw of (input as { items: unknown[] }).items) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const item = raw as Record<string, unknown>;
    if (typeof item.precio !== 'number' || !Number.isFinite(item.precio) || item.precio < 0 || item.precio > MAX_PRICE) continue;

    const currency = typeof item.moneda === 'string' ? item.moneda.toUpperCase() : '';
    if (currency !== 'GTQ' && currency !== 'USD') continue;
    const type = typeof item.tipo === 'string' ? item.tipo.toLowerCase() : '';
    if (type !== 'lista' && type !== 'promocion') continue;

    const marca = text(item.marca, 100);
    const modelo = text(item.modelo, 150);
    const nombre = text(item.nombre, 180) || [marca, modelo].filter(Boolean).join(' ');
    if (!nombre) continue;

    const vigenteDesde = validDate(item.vigente_desde);
    let vigenteHasta = validDate(item.vigente_hasta);
    if (vigenteDesde && vigenteHasta && vigenteHasta < vigenteDesde) vigenteHasta = null;
    const confidence = typeof item.confianza === 'number' && Number.isFinite(item.confianza)
      ? Math.min(1, Math.max(0, item.confianza))
      : null;

    normalized.push({
      categoria: category(item.categoria), marca, modelo, nombre,
      descripcion: text(item.descripcion, 2000), especificaciones: cleanSpecifications(item.especificaciones),
      tipo: type, precio: item.precio, moneda: currency, incluye_iva: typeof item.incluye_iva === 'boolean' ? item.incluye_iva : null,
      vigente_desde: vigenteDesde, vigente_hasta: vigenteHasta, condiciones: text(item.condiciones, 2000), confianza: confidence,
    });
  }
  return normalized;
}
