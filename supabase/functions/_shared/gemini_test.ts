/// <reference lib="deno.ns" />
import { configuredModels, DEFAULT_GEMINI_MODELS, extractCandidateText, geminiErrorMessage, isRetryableStatus, normalizeModelName, parseRetryDelayMs, resolveModels, withFallbackModels } from './gemini.ts';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test('configuredModels limpia comillas, prefijos y duplicados', () => {
  assert(normalizeModelName(`  "models/gemini-ejemplo" `) === 'gemini-ejemplo', 'No se normalizó el modelo');
  const models = configuredModels(" 'gemini-uno', models/gemini-dos ,gemini-uno\n gemini-tres ");
  assert(models.length === 3, 'No se conservaron tres modelos únicos');
  assert(models[0] === 'gemini-uno' && models[1] === 'gemini-dos' && models[2] === 'gemini-tres', 'El orden de prioridad cambió');
  assert(configuredModels('').length === 0, 'Se aceptó una lista vacía');
});

Deno.test('withFallbackModels agrega respaldos sin duplicar el modelo principal', () => {
  const models = withFallbackModels(['gemini-3.8-flash'], ['gemini-4-hydrogen', 'gemini-3.8-flash', 'gemini-3.5-flash-lite']);
  assert(models.join(',') === 'gemini-3.8-flash,gemini-4-hydrogen,gemini-3.5-flash-lite', 'Los respaldos no se agregaron en orden');
  assert(withFallbackModels(['gemini-3.8-flash'], []).length === 1, 'Se perdió el modelo principal');
});

Deno.test('resolveModels agrega los respaldos por defecto si el secreto no existe o está vacío', () => {
  for (const value of [undefined, null, '', '   ']) {
    const models = resolveModels('gemini-3.8-flash', value, DEFAULT_GEMINI_MODELS);
    assert(models.join(',') === ['gemini-3.8-flash', ...DEFAULT_GEMINI_MODELS].join(','), 'No se agregaron los modelos por defecto');
  }
  assert(resolveModels('gemini-3.8-flash', 'gemini-3.7-flash', DEFAULT_GEMINI_MODELS).join(',') === 'gemini-3.8-flash,gemini-3.7-flash', 'No se respetó la lista configurada');
});

Deno.test('isRetryableStatus distingue errores transitorios de errores de configuración', () => {
  for (const status of [408, 429, 500, 503, 504]) assert(isRetryableStatus(status), `${status} debería ser reintentable`);
  for (const status of [400, 401, 403, 404]) assert(!isRetryableStatus(status), `${status} no debería ser reintentable`);
});

Deno.test('parseRetryDelayMs aplica backoff, Retry-After y retryDelay de Gemini', () => {
  assert(parseRetryDelayMs('', null, 0, () => 0) === 1_000, 'El primer backoff debe ser 1s');
  assert(parseRetryDelayMs('', null, 1, () => 0) === 2_000, 'El segundo backoff debe ser 2s');

  const withHeader = parseRetryDelayMs('', '7', 0, () => 0);
  assert(withHeader === 7_000, 'No se respetó Retry-After');

  const body = JSON.stringify({ error: { details: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '12s' }] } });
  assert(parseRetryDelayMs(body, null, 0, () => 0) === 12_000, 'No se respetó retryDelay de Gemini');
  const milliseconds = JSON.stringify({ error: { details: [{ retryDelay: '1500ms' }] } });
  assert(parseRetryDelayMs(milliseconds, '2', 1, () => 0) === 2_000, 'No se compararon las esperas indicadas');

  const capped = parseRetryDelayMs(JSON.stringify({ error: { details: [{ retryDelay: '600s' }] } }), null, 0, () => 0);
  assert(capped === 15_000, 'La espera no quedó limitada');
});

Deno.test('geminiErrorMessage oculta la clave y extrae el mensaje', () => {
  const body = JSON.stringify({ error: { message: 'Clave AIza123 inválida' } });
  const message = geminiErrorMessage(body, 'AIza123');
  assert(message === 'Clave [clave oculta] inválida', 'No se ocultó la clave');
  assert(geminiErrorMessage('HTTP 503', 'otra') === 'HTTP 503', 'Se perdió el texto plano');
});

Deno.test('extractCandidateText lee la primera respuesta y tolera formatos inesperados', () => {
  const result = { candidates: [{ content: { parts: [{ text: '{"items":' }, { thought: true, text: 'pienso...' }, { text: '[]}' }] } }] };
  assert(extractCandidateText(result) === '{"items":[]}', 'No se unieron las partes o se incluyó el pensamiento');
  assert(extractCandidateText({}) === '', 'Se aceptó un resultado vacío');
  assert(extractCandidateText(null) === '', 'Se aceptó null');
});
