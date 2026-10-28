import { randomInt } from 'node:crypto';
import { appendFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const apply = process.argv.includes('--apply');
const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error('Configura SUPABASE_URL y SUPABASE_SECRET_KEY en .env.local.');
const supabase = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

function slug(value) {
  return String(value || 'usuario').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/\s+/g, '').replace(/[^a-z0-9._-]/g, '').slice(0, 32) || 'usuario';
}
function uniqueUsername(value, used) {
  const base = slug(value);
  let candidate = base;
  let suffix = 2;
  while (used.has(candidate)) {
    const ending = String(suffix++);
    candidate = `${base.slice(0, 32 - ending.length)}${ending}`;
  }
  used.add(candidate);
  return candidate;
}
function shortPassword() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  let part = '';
  for (let i = 0; i < 4; i++) part += alphabet[randomInt(alphabet.length)];
  return `Aula-${part}`;
}

const { data: profiles, error } = await supabase.from('perfiles').select('id,nombre,usuario,rol').order('rol').order('nombre');
if (error) throw new Error(`No se pudieron leer los perfiles: ${error.message}`);
if (!profiles?.length) throw new Error('No hay usuarios para procesar.');
const used = new Set();
const changes = profiles.map(profile => ({ profile, username: uniqueUsername(profile.usuario || profile.nombre, used), password: shortPassword() }));

if (!apply) {
  console.log(`Vista previa: ${changes.length} cuentas. No se cambió ninguna contraseña ni usuario.`);
  console.log('Algunos nombres de usuario resultantes:');
  for (const { profile, username } of changes) console.log(`- ${profile.usuario} → ${username} (${profile.rol})`);
  console.log('Cuando estés listo ejecuta: npm run usuarios:normalizar -- --apply');
  process.exit(0);
}

const completed = [];
const failures = [];
for (const change of changes) {
  const { profile, username, password } = change;
  const profileUpdate = await supabase.from('perfiles').update({ usuario: username }).eq('id', profile.id);
  if (profileUpdate.error) { failures.push(`${profile.usuario}: usuario — ${profileUpdate.error.message}`); continue; }
  const authUpdate = await supabase.auth.admin.updateUserById(profile.id, { password });
  if (authUpdate.error) {
    const rollback = await supabase.from('perfiles').update({ usuario: profile.usuario }).eq('id', profile.id);
    failures.push(`${profile.usuario}: contraseña — ${authUpdate.error.message}${rollback.error ? `; además falló la reversión del usuario (${rollback.error.message})` : ''}`);
    continue;
  }
  completed.push({ nombre: profile.nombre, rol: profile.rol, usuario: username, password });
}

if (completed.length) {
  const target = resolve('.credenciales-acceso.local.md');
  await mkdir(resolve('.'), { recursive: true });
  const section = [
    '',
    `## Accesos generados ${new Date().toISOString().slice(0, 10)}`,
    '',
    '> Contraseñas únicas de 9 caracteres. Guarda este archivo de forma privada; nunca lo subas al repositorio.',
    '',
    '| Nombre | Rol | Usuario | Contraseña |',
    '|---|---|---|---|',
    ...completed.map(user => `| ${user.nombre.replaceAll('|', '\\|')} | ${user.rol} | ${user.usuario} | ${user.password} |`),
    '',
  ].join('\n');
  await appendFile(target, section, 'utf8');
  console.log(`Actualizadas ${completed.length} cuentas. Credenciales guardadas en ${target}`);
}
if (failures.length) {
  console.error(`Fallaron ${failures.length} cuentas:`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
}
