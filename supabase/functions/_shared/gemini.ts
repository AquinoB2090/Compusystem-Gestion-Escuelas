/// <reference lib="deno.ns" />

/**
 * Modelos estables y disponibles en la API de Gemini. El orden es la prioridad:
 * los dos primeros respondieron de forma continua; gemini-3.6-flash queda como
 * último recurso porque presenta picos de demanda frecuentes.
 */
export const DEFAULT_GEMINI_MODELS = [
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite',
  'gemini-3.5-flash',
  'gemini-3.6-flash',
];

/** Normaliza un nombre de modelo escrito en GEMINI_MODEL. */
export function normalizeModelName(value: string | null | undefined): string {
  return (value || '')
    .trim()
    .replace(/^['"]|['"]$/g, '')
    .trim()
    .replace(/^models\//i, '');
}

/**
 * GEMINI_MODEL admite uno o varios modelos separados por coma o salto de línea.
 * El orden define la prioridad: si el primero está saturado se prueba el siguiente.
 */
export function configuredModels(value: string | null | undefined): string[] {
  if (!value) return [];
  const models: string[] = [];
  const seen = new Set<string>();
  for (const piece of value.split(/[,\n]/)) {
    const name = normalizeModelName(piece);
    if (name && !seen.has(name)) {
      seen.add(name);
      models.push(name);
    }
  }
  return models;
}

/** Agrega modelos de respaldo sin repetir los ya configurados. */
export function withFallbackModels(models: string[], fallbacks: string[]): string[] {
  const seen = new Set(models);
  return [...models, ...fallbacks.filter((model) => {
    if (seen.has(model)) return false;
    seen.add(model);
    return true;
  })];
}

/** Usa respaldos oficiales cuando el secreto es omitido, vacío o solo espacios. */
export function resolveModels(primaryValue: string | null | undefined, fallbackValue: string | null | undefined, defaults: string[]): string[] {
  const primary = configuredModels(primaryValue);
  const fallbackSource = fallbackValue?.trim() ? fallbackValue : defaults.join(',');
  return withFallbackModels(primary, configuredModels(fallbackSource));
}

/** 429 y 5xx son transitorios; 400/401/403 son errores de configuración o solicitud. */
export function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function secondsToMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  const seconds = Number(trimmed);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(trimmed);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null;
}

/**
 * Espera exponencial con jitter. Respeta Retry-After y el campo retryDelay de
 * Gemini (por ejemplo "12s" o "1500ms") cuando el servicio lo indica.
 */
export function parseRetryDelayMs(
  bodyText: string,
  retryAfter: string | null | undefined,
  attempt: number,
  random: () => number = Math.random,
): number {
  const backoffs = [1_000, 2_000, 4_000, 8_000, 12_000];
  const base = backoffs[Math.min(Math.max(attempt, 0), backoffs.length - 1)];
  const jitter = Math.floor(random() * base * 0.25);
  let delay = base + jitter;

  const headerDelay = secondsToMs(retryAfter);
  if (headerDelay !== null) delay = Math.max(delay, headerDelay);

  try {
    const parsed = JSON.parse(bodyText);
    const details = Array.isArray(parsed?.error?.details) ? parsed.error.details : [];
    for (const detail of details) {
      if (typeof detail?.retryDelay !== 'string') continue;
      const match = /^(\d+(?:\.\d+)?)\s*(ms|s)?$/i.exec(detail.retryDelay.trim());
      if (!match) continue;
      const amount = Number(match[1]);
      const unit = (match[2] || 's').toLowerCase();
      const value = unit === 'ms' ? amount : amount * 1000;
      if (Number.isFinite(value)) delay = Math.max(delay, value);
    }
  } catch { /* el cuerpo no es JSON; se conserva la espera calculada */ }

  return Math.min(Math.round(delay), 15_000);
}

/** Extrae el mensaje de error de Gemini sin filtrar la clave de API en logs. */
export function geminiErrorMessage(bodyText: string, apiKey: string): string {
  let message = bodyText;
  try {
    const parsed = JSON.parse(bodyText);
    if (typeof parsed?.error?.message === 'string') message = parsed.error.message;
  } catch { /* se conserva el texto HTTP tal cual */ }
  return message.replaceAll(apiKey, '[clave oculta]').replace(/\s+/g, ' ').trim().slice(0, 500);
}

/** Junta las partes de texto de la primera respuesta de generateContent. */
export function extractCandidateText(result: unknown): string {
  if (!result || typeof result !== 'object') return '';
  const candidates = (result as { candidates?: unknown }).candidates;
  if (!Array.isArray(candidates) || !candidates.length) return '';
  const parts = (candidates[0] as { content?: { parts?: unknown } } | null)?.content?.parts;
  if (!Array.isArray(parts)) return '';
  return parts
    // Las partes de pensamiento no son la respuesta JSON, aunque traigan texto.
    .filter((part: { thought?: boolean; text?: unknown }) => part?.thought !== true)
    .map((part: { text?: unknown }) => typeof part?.text === 'string' ? part.text : '')
    .join('')
    .trim();
}
