/// <reference lib="deno.ns" />
import { createClient } from 'npm:@supabase/supabase-js@2';
import { firmaValida } from '../_shared/utils.ts';

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void };

const acceptedMimes = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);
const maxFileBytes = 15 * 1024 * 1024;

function defaultSecret(jsonValue: string | undefined, fallback: string | undefined): string | null {
  if (fallback) return fallback;
  if (!jsonValue) return null;
  try { return JSON.parse(jsonValue).default || null; } catch { return null; }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function pathParts() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Guatemala', year: 'numeric', month: '2-digit' }).formatToParts(new Date());
  return { year: parts.find((part) => part.type === 'year')?.value || '0000', month: parts.find((part) => part.type === 'month')?.value || '00' };
}

function safeFilename(value: string | undefined, fallback: string) {
  const cleaned = (value || fallback).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(-100);
  return cleaned || fallback;
}

function messageFile(message: any): { mediaId: string; mime: string; filename: string; caption: string | null } | null {
  if (message?.type === 'document' && message.document?.id) {
    return { mediaId: message.document.id, mime: message.document.mime_type || '', filename: message.document.filename || 'cotizacion.pdf', caption: typeof message.document.caption === 'string' ? message.document.caption : null };
  }
  if (message?.type === 'image' && message.image?.id) {
    const mime = message.image.mime_type || 'image/jpeg';
    const extension = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg';
    return { mediaId: message.image.id, mime, filename: `imagen.${extension}`, caption: typeof message.image.caption === 'string' ? message.image.caption : null };
  }
  return null;
}

async function invokeProcessor(url: string, secretKey: string, documentId: number, admin: any) {
  try {
    const response = await fetch(`${url}/functions/v1/procesar-documento`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${secretKey}`, apikey: secretKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ documento_id: documentId }),
    });
    if (response.ok) return;
    await admin.from('documentos').update({ estado: 'error', error: `No se pudo iniciar el procesamiento (HTTP ${response.status}).` }).eq('id', documentId);
  } catch {
    await admin.from('documentos').update({ estado: 'error', error: 'No se pudo conectar con la función de procesamiento.' }).eq('id', documentId);
  }
}

async function receiveMessage(message: any, admin: any, accessToken: string, graphVersion: string) {
  const senderPhone = typeof message?.from === 'string' ? message.from : '';
  const media = messageFile(message);
  if (!message?.id || !senderPhone || !media || !acceptedMimes.has(media.mime)) return;

  const { data: existing } = await admin.from('documentos').select('id').eq('wa_message_id', message.id).maybeSingle();
  if (existing) return;
  const { data: sender } = await admin.from('remitentes').select('telefono,proveedor_id').eq('telefono', senderPhone).eq('activo', true).maybeSingle();
  if (!sender) return;

  const version = graphVersion.replace(/^v/i, '');
  const metadataResponse = await fetch(`https://graph.facebook.com/v${version}/${encodeURIComponent(media.mediaId)}`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!metadataResponse.ok) throw new Error('Meta no permitió obtener el archivo multimedia.');
  const metadata = await metadataResponse.json();
  const mime = typeof metadata.mime_type === 'string' ? metadata.mime_type : media.mime;
  const size = Number(metadata.file_size || 0);
  if (!acceptedMimes.has(mime) || (size > 0 && size > maxFileBytes) || typeof metadata.url !== 'string') throw new Error('El archivo recibido no cumple el formato o tamaño permitido.');

  const fileResponse = await fetch(metadata.url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!fileResponse.ok) throw new Error('No se pudo descargar el archivo desde Meta.');
  const file = new Uint8Array(await fileResponse.arrayBuffer());
  if (!file.byteLength || file.byteLength > maxFileBytes) throw new Error('El archivo recibido excede 15 MB o está vacío.');

  const { year, month } = pathParts();
  const path = `whatsapp/${year}/${month}/${crypto.randomUUID()}-${safeFilename(media.filename, `cotizacion-${message.id}.pdf`)}`;
  const { error: uploadError } = await admin.storage.from('documentos-precios').upload(path, new Blob([file], { type: mime }), { contentType: mime, upsert: false });
  if (uploadError) throw new Error('No se pudo guardar el archivo recibido en Storage.');

  const { data: document, error: insertError } = await admin.from('documentos').insert({
    origen: 'whatsapp', wa_message_id: message.id, remitente_tel: senderPhone,
    proveedor_id: sender.proveedor_id, storage_path: path, nombre_archivo: media.filename,
    mime, mensaje: media.caption, estado: 'pendiente',
  }).select('id').single();
  if (insertError || !document) {
    const { error: cleanupError } = await admin.storage.from('documentos-precios').remove([path]);
    if (cleanupError) console.error('WhatsApp orphan file cleanup failed.');
    // Meta may deliver the same webhook concurrently. The unique message ID
    // makes the second insert a safe duplicate after its uploaded object is removed.
    if (insertError?.code === '23505') return;
    throw new Error('No se pudo registrar el mensaje recibido.');
  }
  return Number(document.id);
}

Deno.serve(async (request: Request) => {
  const verifyToken = Deno.env.get('WHATSAPP_VERIFY_TOKEN');
  const appSecret = Deno.env.get('META_APP_SECRET');
  const accessToken = Deno.env.get('META_ACCESS_TOKEN');
  const graphVersion = Deno.env.get('META_GRAPH_API_VERSION');
  const url = Deno.env.get('SUPABASE_URL');
  const secretKey = defaultSecret(Deno.env.get('SUPABASE_SECRET_KEYS'), Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SECRET_KEY') || undefined);

  if (request.method === 'GET') {
    const parameters = new URL(request.url).searchParams;
    if (!verifyToken || parameters.get('hub.mode') !== 'subscribe' || parameters.get('hub.verify_token') !== verifyToken) return new Response('Forbidden', { status: 403 });
    return new Response(parameters.get('hub.challenge') || '', { status: 200, headers: { 'Content-Type': 'text/plain' } });
  }
  if (request.method !== 'POST') return json({ error: 'Método no permitido.' }, 405);
  if (!appSecret || !url || !secretKey) return json({ error: 'Falta configurar el webhook de WhatsApp.' }, 503);

  const rawBody = new Uint8Array(await request.arrayBuffer());
  if (!(await firmaValida(appSecret, rawBody, request.headers.get('x-hub-signature-256')))) return json({ error: 'Firma de Meta inválida.' }, 401);
  if (!accessToken || !graphVersion) return json({ error: 'Falta configurar el acceso a WhatsApp Cloud API.' }, 503);

  let payload: any;
  try { payload = JSON.parse(new TextDecoder().decode(rawBody)); } catch { return json({ error: 'El cuerpo no contiene JSON válido.' }, 400); }
  if (payload?.object !== 'whatsapp_business_account') return json({ received: true, ignored: true });

  const admin = createClient(url, secretKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const messages = (payload.entry || []).flatMap((entry: any) => entry.changes || []).flatMap((change: any) => change.value?.messages || []);
  let intakeFailed = false;
  for (const message of messages) {
    try {
      const documentId = await receiveMessage(message, admin, accessToken, graphVersion);
      if (documentId) EdgeRuntime.waitUntil(invokeProcessor(url, secretKey, documentId, admin));
    } catch (cause) {
      // Non-2xx makes Meta retry delivery. Stored messages are deduplicated by wa_message_id.
      intakeFailed = true;
      const reason = cause instanceof Error ? cause.message : 'No se pudo recibir el archivo.';
      console.error(`WhatsApp media intake failed: ${reason}`);
    }
  }
  if (intakeFailed) return json({ error: 'No se pudieron recibir uno o más archivos.' }, 503);
  return json({ received: true });
});
