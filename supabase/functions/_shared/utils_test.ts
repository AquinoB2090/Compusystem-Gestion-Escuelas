/// <reference lib="deno.ns" />
import { firmaValida, normalizarItems } from './utils.ts';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function signature(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const digest = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body)));
  return `sha256=${Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

Deno.test('firmaValida acepta firma válida y rechaza cuerpo alterado o secreto distinto', async () => {
  const body = '{"entry":[]}';
  const valid = await signature('secret-a', body);
  assert(await firmaValida('secret-a', body, valid), 'La firma válida fue rechazada');
  assert(!(await firmaValida('secret-a', `${body} `, valid)), 'Se aceptó un cuerpo alterado');
  assert(!(await firmaValida('secret-b', body, valid)), 'Se aceptó otro secreto');
});

Deno.test('firmaValida rechaza secreto vacío, encabezado ausente o mal formado', async () => {
  const body = 'payload';
  const valid = await signature('secret', body);
  assert(!(await firmaValida('', body, valid)), 'Se aceptó secreto vacío');
  assert(!(await firmaValida('secret', body, null)), 'Se aceptó encabezado ausente');
  assert(!(await firmaValida('secret', body, 'sha1=1234')), 'Se aceptó prefijo incorrecto');
  assert(!(await firmaValida('secret', body, 'sha256=xyz')), 'Se aceptó digest mal formado');
});

Deno.test('normalizarItems descarta precios fuera de rango, no numéricos, moneda y tipo inválidos', () => {
  const candidates = [-1, Number.NaN, '12.50', 10_000_001].map((precio) => ({ nombre: 'Producto', precio, moneda: 'GTQ', tipo: 'lista' }));
  candidates.push({ nombre: 'Producto', precio: 100, moneda: 'EUR', tipo: 'lista' } as never);
  candidates.push({ nombre: 'Producto', precio: 100, moneda: 'GTQ', tipo: 'venta' } as never);
  assert(normalizarItems({ items: candidates }).length === 0, 'Se aceptó un elemento inválido');
});

Deno.test('normalizarItems limpia fechas, categorías y confianza', () => {
  const [item] = normalizarItems({ items: [{
    categoria: 'Categoría inventada', nombre: 'Equipo', precio: 2500, moneda: 'GTQ', tipo: 'promocion',
    vigente_desde: '2026-05-10', vigente_hasta: '2026-05-01', confianza: 2,
  }] });
  assert(item?.categoria === 'Otros', 'La categoría desconocida no pasó a Otros');
  assert(item?.vigente_hasta === null, 'No se anuló la fecha final anterior al inicio');
  assert(item?.confianza === 1, 'La confianza no quedó limitada a 1');
  const [low] = normalizarItems({ items: [{ nombre: 'Otro', precio: 1, moneda: 'USD', tipo: 'lista', confianza: -2 }] });
  assert(low?.confianza === 0, 'La confianza no quedó limitada a 0');
});

Deno.test('normalizarItems devuelve lista vacía si la entrada no contiene items', () => {
  assert(normalizarItems(null).length === 0, 'Se aceptó null');
  assert(normalizarItems({}).length === 0, 'Se aceptó un objeto sin items');
  assert(normalizarItems({ items: 'no es una lista' }).length === 0, 'Se aceptó items no-array');
});

Deno.test('normalizarItems admite Q, Kit y especificaciones en texto sin perder el combo', () => {
  const [item] = normalizarItems({ items: [{
    categoria: 'Sistemas de Seguridad', marca: 'Dahua', modelo: 'DH-HAC-HFW1500RLN-IL-T',
    nombre: 'Combo 2 Cámaras', especificaciones: '2 cámaras, DVR 4 canales, disco duro 500GB',
    tipo: 'Kit de videovigilancia', precio: 1150, moneda: 'Q', confianza: 'Alta',
  }] });
  assert(Boolean(item), 'Se descartó el combo por el formato de la IA');
  assert(item?.moneda === 'GTQ', 'La moneda Q no pasó a GTQ');
  assert(item?.tipo === 'promocion', 'El tipo Kit no pasó a promocion');
  assert(item?.categoria === 'Cámaras de seguridad', 'La categoría no se normalizó');
  assert(item?.modelo === null, 'El combo conservó el modelo de la cámara');
  assert(item?.especificaciones.camaras === 2, 'No se extrajo la cantidad de cámaras del texto');
  assert(item?.especificaciones.dvr_canales === 4, 'No se extrajeron los canales del DVR');
  assert(item?.especificaciones.almacenamiento === '500GB', 'No se extrajo el disco');
  assert(item?.confianza === 0.9, 'No se normalizó la confianza textual');
});

Deno.test('normalizarItems mantiene el modelo en productos que no son combos', () => {
  const [item] = normalizarItems({ items: [{
    nombre: 'Cámara Dahua 5MP', modelo: 'DH-HAC-HFW1500RLN-IL-T', precio: 350,
    moneda: 'GTQ', tipo: 'lista', especificaciones: {},
  }] });
  assert(item?.modelo === 'DH-HAC-HFW1500RLN-IL-T', 'Se borró el modelo de un producto individual');
});
