// Borrador de cotización compartido entre el catálogo de precios y el asistente.
// Se guarda en localStorage para que se pueda armar una cotización sin usar el bot.

export type QuoteItem = {
  precio_id: number;
  producto_id: number;
  categoria: string;
  descripcion: string;
  proveedor: string | null;
  quantity: number;
  unit_price: number;
  moneda: 'GTQ' | 'USD';
  line_total: number;
  condiciones: string | null;
  option_group: string | null;
  addedManually?: boolean;
};

const STORAGE_KEY = 'compusystem.quote-draft.v1';
const MAX_ITEMS = 200;

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function isQuoteItem(value: unknown): value is QuoteItem {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return finiteNumber(item.precio_id) !== null
    && finiteNumber(item.producto_id) !== null
    && finiteNumber(item.unit_price) !== null
    && typeof item.descripcion === 'string'
    && typeof item.categoria === 'string'
    && (item.proveedor === null || typeof item.proveedor === 'string')
    && (item.moneda === 'GTQ' || item.moneda === 'USD')
    && (item.condiciones === null || typeof item.condiciones === 'string')
    && (item.option_group === null || typeof item.option_group === 'string');
}

function normalizeItem(item: QuoteItem): QuoteItem {
  const quantity = Math.max(1, Math.min(10000, Math.floor(finiteNumber(item.quantity) ?? 1)));
  return {
    ...item,
    quantity,
    line_total: quantity * item.unit_price,
    addedManually: Boolean(item.addedManually),
  };
}

export function readQuoteDraft(): QuoteItem[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isQuoteItem).map(normalizeItem).slice(0, MAX_ITEMS);
  } catch {
    return [];
  }
}

export function saveQuoteDraft(items: QuoteItem[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items.slice(0, MAX_ITEMS).map(normalizeItem)));
  } catch {
    // Almacenamiento no disponible (modo privado, cuota llena, etc.).
  }
}

export function clearQuoteDraft(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Almacenamiento no disponible.
  }
}

/** Sincroniza otras pestañas; el evento `storage` no se dispara en la que escribe. */
export function subscribeQuoteDraft(listener: (items: QuoteItem[]) => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const handle = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY) return;
    listener(readQuoteDraft());
  };
  window.addEventListener('storage', handle);
  return () => window.removeEventListener('storage', handle);
}

export type QuoteDraftInput = Omit<QuoteItem, 'quantity' | 'line_total'> & { quantity?: number };

/** Agrega (o suma cantidad a) un producto respetando la moneda de la cotización. */
export function mergeQuoteItem(current: QuoteItem[], input: QuoteDraftInput): { items: QuoteItem[]; error: string } {
  const unitPrice = finiteNumber(input.unit_price);
  if (unitPrice === null || unitPrice < 0) {
    return { items: current, error: 'Este producto no tiene precio de venta disponible.' };
  }
  const quantity = Math.max(1, Math.min(10000, Math.floor(finiteNumber(input.quantity) ?? 1)));
  if (current.some((item) => item.moneda !== input.moneda)) {
    return { items: current, error: 'Una misma cotización no puede mezclar GTQ y USD.' };
  }

  const key = (item: { precio_id: number; option_group: string | null }) => `${item.precio_id}|${item.option_group ?? ''}`;
  const incoming: QuoteItem = {
    ...input,
    unit_price: unitPrice,
    quantity,
    line_total: quantity * unitPrice,
    addedManually: true,
  };
  const index = current.findIndex((item) => key(item) === key(incoming));
  const items = index >= 0
    ? current.map((item, position) => position === index
      ? normalizeItem({ ...item, quantity: item.quantity + quantity, unit_price: unitPrice, addedManually: true })
      : item)
    : [...current, normalizeItem(incoming)];

  return { items, error: '' };
}
