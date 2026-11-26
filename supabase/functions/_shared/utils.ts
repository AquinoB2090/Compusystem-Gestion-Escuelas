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

/** Acepta tanto el nombre exacto de la categoría como sinónimos que devuelve la IA. */
function normalizarCategoria(value: unknown): string {
  const raw = text(value, 80)?.toLocaleLowerCase('es-GT') || '';
  const exact = CATEGORIES.find((item) => item.toLocaleLowerCase('es-GT') === raw);
  if (exact) return exact;
  if (/c[aá]mara|seguridad|vigilancia|dvr|cCTV/i.test(raw)) return 'Cámaras de seguridad';
  if (/aire|acondicionad|minisplit|split/i.test(raw)) return 'Aires acondicionados';
  if (/accesorio|instalaci[oó]n|cable|balun|conector/i.test(raw)) return 'Accesorios e instalación';
  return 'Otros';
}

/** Gemini suele devolver "Q" en vez de "GTQ" o "Kit de videovigilancia" en vez de "promocion". */
function normalizarMoneda(value: unknown): 'GTQ' | 'USD' | null {
  const raw = text(value, 20)?.toUpperCase().replace(/\./g, '') || '';
  if (raw === 'GTQ' || raw === 'Q' || raw === 'QUETZAL') return 'GTQ';
  if (raw === 'USD' || raw === 'US' || raw === 'DOLAR' || raw === 'DÓLAR' || raw === '$') return 'USD';
  return null;
}

function normalizarTipo(value: unknown): 'lista' | 'promocion' | null {
  const raw = text(value, 60)?.toLocaleLowerCase('es-GT') || '';
  if (raw === 'lista' || raw === 'list') return 'lista';
  if (/promoci[oó]n|promo|combo|paquete|kit/.test(raw)) return 'promocion';
  return null;
}

function normalizarConfianza(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.min(1, Math.max(0, value));
  const raw = text(value, 20)?.toLocaleLowerCase('es-GT');
  if (raw === 'alta' || raw === 'high') return 0.9;
  if (raw === 'media' || raw === 'medium') return 0.7;
  if (raw === 'baja' || raw === 'low') return 0.5;
  return null;
}

function cleanSpecifications(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).slice(0, 40));
}

/** Si la IA devuelve las especificaciones como texto, extrae los datos clave. */
function normalizarEspecificaciones(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return cleanSpecifications(value);
  if (typeof value !== 'string') return {};

  const raw = value.slice(0, 2000);
  const lower = raw.toLocaleLowerCase('es-GT');
  const specs: Record<string, unknown> = { texto: raw };

  const camaras = lower.match(/\b(\d+)\s*c[aá]maras?\b/);
  if (camaras) specs.camaras = Number(camaras[1]);

  const canales = lower.match(/dvr\s*(?:de\s*)?(\d+)\s*canales?\b/);
  if (canales) specs.dvr_canales = Number(canales[1]);

  const disco = lower.match(/\b(\d+(?:[.,]\d+)?)\s*(gb|tb)\b/i);
  if (disco) specs.almacenamiento = `${disco[1]}${disco[2].toUpperCase()}`;

  return specs;
}

export function normalizarItems(input: unknown): NormalizedPrice[] {
  if (!input || typeof input !== 'object' || Array.isArray(input) || !Array.isArray((input as { items?: unknown }).items)) return [];

  const normalized: NormalizedPrice[] = [];
  for (const raw of (input as { items: unknown[] }).items) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const item = raw as Record<string, unknown>;
    if (typeof item.precio !== 'number' || !Number.isFinite(item.precio) || item.precio < 0 || item.precio > MAX_PRICE) continue;

    const moneda = normalizarMoneda(item.moneda);
    if (!moneda) continue;
    const tipo = normalizarTipo(item.tipo);
    if (!tipo) continue;

    const marca = text(item.marca, 100);
    const modelo = text(item.modelo, 150);
    const nombre = text(item.nombre, 180) || [marca, modelo].filter(Boolean).join(' ');
    if (!nombre) continue;

    const especificaciones = normalizarEspecificaciones(item.especificaciones);
    // En un combo, el modelo de la cámara no identifica al paquete: todos los
    // combos compartirían la misma clave. La identidad debe usar el nombre.
    const esCombo = /\b(combo|paquete|kit)\b/i.test(nombre)
      || Object.prototype.hasOwnProperty.call(especificaciones, 'camaras')
      || Object.prototype.hasOwnProperty.call(especificaciones, 'dvr_canales');
    const modeloFinal = esCombo ? null : modelo;

    const vigenteDesde = validDate(item.vigente_desde);
    let vigenteHasta = validDate(item.vigente_hasta);
    if (vigenteDesde && vigenteHasta && vigenteHasta < vigenteDesde) vigenteHasta = null;

    normalized.push({
      categoria: normalizarCategoria(item.categoria), marca, modelo: modeloFinal, nombre,
      descripcion: text(item.descripcion, 2000), especificaciones,
      tipo, precio: item.precio, moneda,
      incluye_iva: typeof item.incluye_iva === 'boolean' ? item.incluye_iva : null,
      vigente_desde: vigenteDesde, vigente_hasta: vigenteHasta,
      condiciones: text(item.condiciones, 2000), confianza: normalizarConfianza(item.confianza),
    });
  }
  return normalized;
}
