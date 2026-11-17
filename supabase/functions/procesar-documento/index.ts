/// <reference lib="deno.ns" />
import { createClient } from 'npm:@supabase/supabase-js@2';
import { normalizarItems, type NormalizedPrice } from '../_shared/utils.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

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

function promptForExtraction(): string {
  return `Analiza este documento de cotización comercial y extrae únicamente productos y precios que aparezcan de forma explícita. Los importes son costos de compra antes de aplicar cualquier margen. No inventes datos: usa null cuando un campo no aparezca.
Devuelve SOLO JSON válido con esta estructura: {"items":[{"categoria":"Cámaras de seguridad | Aires acondicionados | Accesorios e instalación | Otros","marca":string|null,"modelo":string|null,"nombre":string,"descripcion":string|null,"especificaciones":object,"tipo":"lista"|"promocion","precio":number,"moneda":"GTQ"|"USD","incluye_iva":boolean|null,"vigente_desde":"YYYY-MM-DD"|null,"vigente_hasta":"YYYY-MM-DD"|null,"condiciones":string|null,"confianza":number}]}. Usa precios numéricos sin símbolos, y confianza entre 0 y 1. Si el documento no contiene precios de productos, responde {"items":[]}.`;
}

async function requestGemini(apiKey: string, model: string, mime: string, bytes: Uint8Array, message: string | null) {
  const modelName = model.startsWith('models/') ? model.slice('models/'.length) : model;
  const contents = [promptForExtraction(), message ? `Texto adicional del remitente: ${message}` : null].filter(Boolean).join('\n\n');
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelName)}:generateContent`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      contents: [{ parts: [{ text: contents }, { inline_data: { mime_type: mime, data: toBase64(bytes) } }] }],
      generationConfig: { responseMimeType: 'application/json' },
    }),
  });
  if (!response.ok) {
    const rawError = await response.text();
    let detail = rawError;
    try {
      const parsed = JSON.parse(rawError);
      detail = typeof parsed?.error?.message === 'string' ? parsed.error.message : rawError;
    } catch { /* conserva el texto HTTP si la respuesta no es JSON */ }
    detail = detail.replaceAll(apiKey, '[clave oculta]').replace(/\s+/g, ' ').trim().slice(0, 600);
    throw new Error(`Gemini HTTP ${response.status}${detail ? `: ${detail}` : ''}`);
  }
  const result = await response.json();
  const responseText = result?.candidates?.[0]?.content?.parts?.map((part: { text?: string }) => part.text || '').join('').trim();
  if (!responseText) throw new Error('Gemini no devolvió contenido JSON.');
  return extractJson(responseText);
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

    const { data: existing, error: lookupError } = await admin.from('precios')
      .select('id,estado')
      .eq('documento_id', document.id)
      .eq('producto_id', productId)
      .eq('moneda', item.moneda)
      .eq('tipo', item.tipo)
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

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'Método no permitido.' }, 405);

  const url = Deno.env.get('SUPABASE_URL');
  const secretKey = defaultKey(Deno.env.get('SUPABASE_SECRET_KEYS'), Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SECRET_KEY') || undefined);
  const publishableKey = defaultKey(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS'), Deno.env.get('SUPABASE_ANON_KEY') || Deno.env.get('SUPABASE_PUBLISHABLE_KEY') || undefined);
  const apiKey = Deno.env.get('GEMINI_API_KEY');
  const model = Deno.env.get('GEMINI_MODEL');
  if (!url || !secretKey || !publishableKey) return json({ error: 'Falta la configuración segura de Supabase en Edge Functions.' }, 503);
  if (!apiKey || !model) return json({ error: 'Configura GEMINI_API_KEY y GEMINI_MODEL para procesar documentos.' }, 503);
  if (!(await callerIsAdmin(request, url, secretKey, publishableKey))) return json({ error: 'Solo administración puede iniciar el procesamiento.' }, 403);

  const body = await request.json().catch(() => null);
  const documentId = Number(body?.documento_id);
  if (!Number.isSafeInteger(documentId) || documentId <= 0) return json({ error: 'Indica un documento válido.' }, 400);

  const admin = createClient(url, secretKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: document, error: documentError } = await admin.from('documentos')
    .select('id,storage_path,nombre_archivo,mime,mensaje,proveedor_id,estado,intentos')
    .eq('id', documentId)
    .maybeSingle();
  if (documentError || !document) return json({ error: 'No se encontró el documento.' }, 404);
  if (document.estado === 'procesado') return json({ status: 'procesado', omitido: true });
  if (document.estado === 'procesando') return json({ status: 'procesando', omitido: true }, 202);

  const { data: claimed, error: startError } = await admin.from('documentos')
    .update({ estado: 'procesando', error: null, intentos: Number(document.intentos || 0) + 1 })
    .eq('id', documentId)
    .in('estado', ['pendiente', 'error'])
    .select('id')
    .maybeSingle();
  if (startError) return json({ error: 'No se pudo iniciar el procesamiento.' }, 500);
  if (!claimed) return json({ status: 'procesando', omitido: true }, 202);

  try {
    if (!['application/pdf', 'image/jpeg', 'image/png', 'image/webp'].includes(document.mime)) throw new Error('El tipo de archivo del documento no está permitido.');
    const { data: file, error: downloadError } = await admin.storage.from('documentos-precios').download(document.storage_path);
    if (downloadError || !file) throw new Error('No se pudo descargar el archivo desde Storage.');
    const extracted = await requestGemini(apiKey, model, document.mime, new Uint8Array(await file.arrayBuffer()), document.mensaje);
    const items = normalizarItems(extracted);
    if (!items.length) throw new Error('No se encontraron precios válidos en el documento.');
    const saved = await savePrices(admin, document, items);
    const { error: finishError } = await admin.from('documentos').update({ estado: 'procesado', error: null, procesado_en: new Date().toISOString(), modelo_ia: model }).eq('id', documentId);
    if (finishError) throw new Error('Los precios se guardaron, pero no se pudo actualizar el estado del documento.');
    return json({ status: 'procesado', precios: saved });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : 'Error al procesar el documento.';
    await admin.from('documentos').update({ estado: 'error', error: message.slice(0, 1000) }).eq('id', documentId);
    return json({ error: message }, 422);
  }
});
