/// <reference lib="deno.ns" />
import { createClient } from 'npm:@supabase/supabase-js@2';
import { PDFDocument } from 'npm:pdf-lib@1.17.1';
import { normalizarItems, type NormalizedPrice } from '../_shared/utils.ts';
import {
  DEFAULT_GEMINI_MODELS,
  extractCandidateText,
  geminiErrorMessage,
  isRetryableStatus,
  parseRetryDelayMs,
  resolveModels,
} from '../_shared/gemini.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Presupuestos por debajo del límite de 150s de una Edge Function (plan free).
const TOTAL_GEMINI_BUDGET_MS = 95_000;
const PDF_CHUNK_PAGES = 10;
const MODEL_BUDGET_MS = 40_000;
const ATTEMPT_TIMEOUT_MS = 18_000;
const STALE_PROCESSING_MS = 10 * 60_000;
// gemini-3.8-flash piensa en "medium" por defecto; para extraer precios basta con "low".
const THINKING_LEVELS = ['MINIMAL', 'LOW', 'MEDIUM', 'HIGH', 'XHIGH'];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

function defaultKey(jsonValue: string | undefined, fallback: string | undefined): string | null {
  if (fallback) return fallback;
  if (!jsonValue) return null;
  try { return JSON.parse(jsonValue).default || null; } catch { return null; }
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length)));
  }
  return btoa(binary);
}

function extractJson(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  return JSON.parse(trimmed);
}

async function callerIsAdmin(request: Request, url: string, secretKey: string, publishableKey: string): Promise<boolean> {
  const authorization = request.headers.get('Authorization') || '';
  const token = authorization.replace(/^Bearer\s+/i, '');
  if (!token) return false;
  if (token === secretKey) return true;

  const sessionClient = createClient(url, publishableKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: authorization } },
  });
  const { data: { user }, error } = await sessionClient.auth.getUser(token);
  if (error || !user) return false;
  const { data: profile } = await sessionClient.from('perfiles').select('rol,activo').eq('id', user.id).maybeSingle();
  return profile?.rol === 'admin' && profile.activo === true;
}

const FORMATO_JSON = `Devuelve SOLO JSON válido con esta estructura: {"items":[{"categoria":"Cámaras de seguridad | Aires acondicionados | Accesorios e instalación | Otros","marca":string|null,"modelo":string|null,"nombre":string,"descripcion":string|null,"especificaciones":object,"tipo":"lista"|"promocion","precio":number,"moneda":"GTQ"|"USD","incluye_iva":boolean|null,"vigente_desde":"YYYY-MM-DD"|null,"vigente_hasta":"YYYY-MM-DD"|null,"condiciones":string|null,"confianza":number}]}.
REGLAS ESTRICTAS: "moneda" debe ser exactamente "GTQ" o "USD" (en Guatemala escribe "GTQ", nunca "Q"); "tipo" debe ser exactamente "lista" o "promocion" (para combos, kits o paquetes usa "promocion"); "categoria" debe ser una de las cuatro opciones indicadas; "especificaciones" debe ser un objeto JSON, nunca texto; "confianza" debe ser un número entre 0 y 1; en los combos deja "modelo" en null y escribe la cantidad de cámaras en "nombre" y en "especificaciones". Usa precios numéricos sin símbolos. Si el documento no contiene precios de productos, responde {"items":[]}.`;

function promptForExtraction(): string {
  return `Analiza este documento de cotización comercial y extrae únicamente productos y precios que aparezcan de forma explícita. Los importes son costos de compra antes de aplicar cualquier margen. No inventes datos: usa null cuando un campo no aparezca.
REGLA CRITICA PARA TABLAS, LISTAS Y COMBOS: devuelve un objeto por cada renglon o paquete que tenga su propio precio. Asocia cada precio solo con el texto y las caracteristicas del mismo renglon; no combines el nombre del primer renglon con el precio del ultimo ni reutilices un encabezado como nombre de todos. Si los renglones son paquetes con cantidades distintas (por ejemplo, 2, 4, 6, 8, 10 y 16 camaras), cada cantidad es un producto distinto: incluyela en nombre y especificaciones junto con los canales DVR y almacenamiento que correspondan a ese renglon. Lee todos los renglones de arriba abajo. Si no puedes asociar con seguridad un precio a un paquete, omite ese paquete en vez de adivinar.
${FORMATO_JSON}`;
}

function hasCameraCountConflict(items: NormalizedPrice[]): boolean {
  return items.some((item) => {
    const namedCount = item.nombre.match(/\b(\d+)\s*c[aá]maras?\b/i);
    const specifiedCount = Number(item.especificaciones.camaras);
    return Boolean(namedCount && Number.isFinite(specifiedCount) && Number(namedCount[1]) !== specifiedCount);
  });
}

/**
 * Prueba los modelos configurados en orden. Reintenta 429/5xx con espera
 * exponencial (y Retry-After/retryDelay cuando Gemini lo envía) y pasa al
 * siguiente modelo si la saturación persiste.
 */
async function requestGemini(apiKey: string, models: string[], mime: string, bytes: Uint8Array, message: string | null, thinkingLevel: string, budgetMs = TOTAL_GEMINI_BUDGET_MS): Promise<{ data: unknown; model: string }> {
  const contents = [promptForExtraction(), message ? `Texto adicional del remitente: ${message}` : null].filter(Boolean).join('\n\n');
  const generationConfig: Record<string, unknown> = { responseMimeType: 'application/json' };
  if (THINKING_LEVELS.includes(thinkingLevel)) generationConfig.thinkingConfig = { thinkingLevel };
  const payload = JSON.stringify({
    contents: [{ parts: [{ text: contents }, { inline_data: { mime_type: mime, data: toBase64(bytes) } }] }],
    generationConfig,
  });
  const deadline = Date.now() + budgetMs;
  const failures: string[] = [];

  for (const model of models) {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    const modelDeadline = Math.min(deadline, Date.now() + Math.min(MODEL_BUDGET_MS, budgetMs));
    let attempt = 0;

    while (modelDeadline - Date.now() > 1_000) {
      const remainingMs = Math.min(modelDeadline, deadline) - Date.now();
      if (remainingMs <= 1_000) break;

      let response: Response;
      try {
        response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
          signal: AbortSignal.timeout(Math.min(ATTEMPT_TIMEOUT_MS, remainingMs)),
          body: payload,
        });
      } catch (cause) {
        const isTimeout = cause instanceof DOMException && cause.name === 'TimeoutError';
        const isNetworkError = cause instanceof TypeError;
        if (!isTimeout && !isNetworkError) throw cause;
        console.warn('Gemini no respondió; se probará otra opción.', { model, attempt: attempt + 1, isTimeout });
        failures.push(`${model}: sin respuesta`);
        break;
      }

      if (response.ok) {
        const result = await response.json();
        const responseText = extractCandidateText(result);
        if (!responseText) throw new Error('Gemini no devolvió contenido JSON.');
        try {
          return { data: extractJson(responseText), model };
        } catch {
          throw new Error('Gemini devolvió una respuesta JSON inválida.');
        }
      }

      const rawError = await response.text();
      const detail = geminiErrorMessage(rawError, apiKey);
      const label = `HTTP ${response.status}${detail ? `: ${detail}` : ''}`;
      failures.push(`${model}: ${label}`);

      if (response.status === 404) {
        console.warn('GEMINI_MODEL no disponible; se probará el siguiente.', { model });
        break;
      }
      if (!isRetryableStatus(response.status)) throw new Error(`Gemini ${label}`);

      const waitMs = parseRetryDelayMs(rawError, response.headers.get('Retry-After'), attempt);
      if (Date.now() + waitMs + 1_000 >= modelDeadline || Date.now() + waitMs >= deadline) break;
      console.warn('Gemini está saturado; se reintentará.', { model, attempt: attempt + 1, status: response.status, waitMs });
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      attempt++;
    }
  }

  const tried = [...new Set(failures.map((failure) => failure.split(':')[0]))].join(', ') || 'ninguno';
  const detail = failures[failures.length - 1] || 'sin detalles';
  throw new Error(`Gemini no pudo procesar el documento por alta demanda o falta de capacidad. Modelos probados: ${tried}. Último error: ${detail}. Revisa la cuota de tu clave de Google AI Studio o cambia GEMINI_MODEL / GEMINI_FALLBACK_MODELS.`);
}

async function savePrices(admin: any, document: { id: number; proveedor_id: number | null }, items: NormalizedPrice[]) {
  let saved = 0;
  for (const item of items) {
    const { data: productId, error: productError } = await admin.rpc('upsert_producto', {
      p_categoria: item.categoria,
      p_marca: item.marca,
      p_modelo: item.modelo,
      p_nombre: item.nombre,
      p_descripcion: item.descripcion,
      p_especificaciones: item.especificaciones,
    });
    if (productError || !productId) throw new Error('No se pudo guardar un producto extraído.');

    let pendingQuery = admin.from('precios')
      .select('id,estado')
      .eq('producto_id', productId)
      .eq('moneda', item.moneda)
      .eq('tipo', item.tipo)
      .eq('estado', 'por_revisar');
    pendingQuery = document.proveedor_id === null
      ? pendingQuery.is('proveedor_id', null)
      : pendingQuery.eq('proveedor_id', document.proveedor_id);
    const { data: existing, error: lookupError } = await pendingQuery
      .order('creado_en', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (lookupError) throw new Error('No se pudo comprobar si el precio ya estaba registrado.');
    if (existing?.estado === 'aprobado' || existing?.estado === 'descartado') continue;

    const priceData = {
      producto_id: productId,
      proveedor_id: document.proveedor_id,
      documento_id: document.id,
      tipo: item.tipo,
      precio: item.precio,
      moneda: item.moneda,
      incluye_iva: item.incluye_iva,
      ...(item.vigente_desde ? { vigente_desde: item.vigente_desde } : {}),
      vigente_hasta: item.vigente_hasta,
      condiciones: item.condiciones,
      confianza: item.confianza,
      estado: 'por_revisar',
    };
    const result = existing
      ? await admin.from('precios').update(priceData).eq('id', existing.id)
      : await admin.from('precios').insert(priceData);
    if (result.error) throw new Error('No se pudo guardar un precio extraído.');
    saved++;
  }
  return saved;
}

/** Recupera documentos cuyo worker murió antes de actualizar el estado. */
async function releaseStaleDocuments(admin: any) {
  const cutoff = new Date(Date.now() - STALE_PROCESSING_MS).toISOString();
  const { error: timestampError } = await admin.from('documentos')
    .update({ estado: 'pendiente', error: 'El procesamiento anterior se interrumpió; se reanudará automáticamente.' })
    .eq('estado', 'procesando')
    .lt('procesando_desde', cutoff);
  const { error: legacyError } = await admin.from('documentos')
    .update({ estado: 'pendiente', error: 'El procesamiento anterior se interrumpió; se reanudará automáticamente.' })
    .eq('estado', 'procesando')
    .is('procesando_desde', null)
    .lt('recibido_en', cutoff);
  if (timestampError || legacyError) console.warn('No se pudieron liberar documentos interrumpidos.', timestampError?.message || legacyError?.message);
}

async function processDocument(admin: any, document: any, apiKey: string, models: string[], thinkingLevel: string): Promise<void> {
  try {
    if (!['application/pdf', 'image/jpeg', 'image/png', 'image/webp'].includes(document.mime)) throw new Error('El tipo de archivo del documento no está permitido.');
    const { data: file, error: downloadError } = await admin.storage.from('documentos-precios').download(document.storage_path);
    if (downloadError || !file) throw new Error('No se pudo descargar el archivo desde Storage.');

    const geminiStartedAt = Date.now();
    console.info('Iniciando extracción Gemini.', { documentoId: document.id, mime: document.mime, modelos: models });
    const fileBytes = new Uint8Array(await file.arrayBuffer());
    let extracted: unknown;
    let model = '';
    if (document.mime === 'application/pdf') {
      const sourcePdf = await PDFDocument.load(fileBytes);
      const pageCount = sourcePdf.getPageCount();
      const chunkCount = Math.ceil(pageCount / PDF_CHUNK_PAGES);
      const chunkBudgetMs = Math.floor(TOTAL_GEMINI_BUDGET_MS / chunkCount);
      const allItems: unknown[] = [];
      for (let start = 0; start < pageCount; start += PDF_CHUNK_PAGES) {
        const chunkPdf = await PDFDocument.create();
        const pageIndices = Array.from({ length: Math.min(PDF_CHUNK_PAGES, pageCount - start) }, (_, offset) => start + offset);
        const pages = await chunkPdf.copyPages(sourcePdf, pageIndices);
        for (const page of pages) chunkPdf.addPage(page);
        const chunkBytes = new Uint8Array(await chunkPdf.save());
        const chunkNumber = Math.floor(start / PDF_CHUNK_PAGES) + 1;
        console.info('Procesando bloque PDF.', { documentoId: document.id, bloque: chunkNumber, bloques: chunkCount, paginas: pageIndices.length });
        const result = await requestGemini(apiKey, models, document.mime, chunkBytes, document.mensaje, thinkingLevel, chunkBudgetMs);
        const chunkItems = normalizarItems(result.data);
        allItems.push(...chunkItems);
        model = result.model;
      }
      extracted = { items: allItems };
    } else {
      const result = await requestGemini(apiKey, models, document.mime, fileBytes, document.mensaje, thinkingLevel);
      extracted = result.data;
      model = result.model;
    }
    console.info('Extracción Gemini completada.', { documentoId: document.id, durationMs: Date.now() - geminiStartedAt, model });

    let items = normalizarItems(extracted);
    if (hasCameraCountConflict(items)) {
      console.warn('La lectura devolvio cantidades de camaras contradictorias; se repetira la lectura completa.', { documentoId: document.id });
      const verificationPrompt = `${document.mensaje ? `${document.mensaje}\n\n` : ''}VERIFICACION OBLIGATORIA: la lectura preliminar mezclo cantidades de camaras. Vuelve a leer la imagen completa, cuenta cada recuadro de precio y crea un item por cada combo. Empareja nombre, cantidad de camaras, canales DVR, disco y precio dentro del mismo recuadro. No uses el encabezado ni los datos de otro combo. Si hay varios precios visibles, devuelve todos; no devuelvas un unico resumen.\n${FORMATO_JSON}`;
      const verified = await requestGemini(apiKey, models, document.mime, fileBytes, verificationPrompt, thinkingLevel);
      const verifiedItems = normalizarItems(verified.data);
      if (verifiedItems.length < 2 || hasCameraCountConflict(verifiedItems)) {
        throw new Error('La lectura produjo combos incompletos o contradictorios. No se guardaron precios; requiere revision manual.');
      }
      extracted = verified.data;
      model = verified.model;
      items = verifiedItems;
    }
    if (!items.length) throw new Error('No se encontraron precios válidos en el documento.');
    const saved = await savePrices(admin, document, items);
    const { error: finishError } = await admin.from('documentos')
      .update({ estado: 'procesado', error: null, procesado_en: new Date().toISOString(), procesando_desde: null, modelo_ia: model })
      .eq('id', document.id);
    if (finishError) throw new Error('Los precios se guardaron, pero no se pudo actualizar el estado del documento.');
  } catch (cause) {
    const message = cause instanceof DOMException && cause.name === 'TimeoutError'
      ? 'Gemini tardó demasiado. Reintenta el documento.'
      : cause instanceof Error ? cause.message : 'Error al procesar el documento.';
    console.error('Falló el procesamiento del documento.', { documentoId: document.id, message });
    await admin.from('documentos').update({ estado: 'error', error: message.slice(0, 1000), procesando_desde: null }).eq('id', document.id);
  }
}

function runInBackground(task: Promise<void>) {
  const runtime = (globalThis as unknown as { EdgeRuntime?: { waitUntil(promise: Promise<unknown>): void } }).EdgeRuntime;
  if (runtime?.waitUntil) {
    runtime.waitUntil(task);
  } else {
    // Fuera de Supabase la promesa sigue viva mientras el proceso siga corriendo.
    task.catch((error) => console.error('Procesamiento en segundo plano fallido.', error));
  }
}

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'Método no permitido.' }, 405);

  const url = Deno.env.get('SUPABASE_URL');
  const secretKey = defaultKey(Deno.env.get('SUPABASE_SECRET_KEYS'), Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SECRET_KEY') || undefined);
  const publishableKey = defaultKey(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS'), Deno.env.get('SUPABASE_ANON_KEY') || Deno.env.get('SUPABASE_PUBLISHABLE_KEY') || undefined);
  const apiKey = Deno.env.get('GEMINI_API_KEY');
  const model = Deno.env.get('GEMINI_MODEL');
  const fallbackValue = Deno.env.get('GEMINI_FALLBACK_MODELS');
  const models = resolveModels(model, fallbackValue, DEFAULT_GEMINI_MODELS);
  const thinkingLevel = (Deno.env.get('GEMINI_THINKING_LEVEL') || 'LOW').trim().toUpperCase();
  if (!url || !secretKey || !publishableKey) return json({ error: 'Falta la configuración segura de Supabase en Edge Functions.' }, 503);
  if (!apiKey || !models.length) return json({ error: 'Configura GEMINI_API_KEY y GEMINI_MODEL para procesar documentos.' }, 503);
  if (!(await callerIsAdmin(request, url, secretKey, publishableKey))) return json({ error: 'Solo administración puede iniciar el procesamiento.' }, 403);

  const body = await request.json().catch(() => null);
  const documentId = Number(body?.documento_id);
  if (!Number.isSafeInteger(documentId) || documentId <= 0) return json({ error: 'Indica un documento válido.' }, 400);

  const admin = createClient(url, secretKey, { auth: { autoRefreshToken: false, persistSession: false } });
  await releaseStaleDocuments(admin);
  const { data: document, error: documentError } = await admin.from('documentos')
    .select('id,storage_path,nombre_archivo,mime,mensaje,proveedor_id,estado,intentos,recibido_en')
    .eq('id', documentId)
    .maybeSingle();
  if (documentError || !document) return json({ error: 'No se encontró el documento.' }, 404);
  if (document.estado === 'procesado') return json({ status: 'procesado', omitido: true });
  if (document.estado === 'procesando') return json({ status: 'procesando', omitido: true }, 202);

  const { data: claimed, error: startError } = await admin.from('documentos')
    .update({ estado: 'procesando', error: null, procesando_desde: new Date().toISOString(), intentos: Number(document.intentos || 0) + 1 })
    .eq('id', documentId)
    .in('estado', ['pendiente', 'error'])
    .select('id')
    .maybeSingle();
  if (startError) return json({ error: 'No se pudo iniciar el procesamiento.' }, 500);
  if (!claimed) return json({ status: 'procesando', omitido: true }, 202);

  // La respuesta vuelve de inmediato: la bandeja consulta el estado hasta que termine.
  runInBackground(processDocument(admin, document, apiKey, models, thinkingLevel));
  return json({ status: 'procesando', documento_id: documentId }, 202);
});
