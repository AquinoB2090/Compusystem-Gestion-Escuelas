export function normalizeUsername(value: string) {
  return String(value || 'usuario').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/\s+/g, '').replace(/[^a-z0-9._-]/g, '').slice(0, 32) || 'usuario';
}
