-- =====================================================================
-- MÓDULO DE PRECIOS Y PROMOCIONES  --  MIGRACIÓN PARA BASE CON DATOS DE PRODUCCIÓN
--
-- ES ADITIVA: solo CREA objetos nuevos. No borra, no modifica y no lee tus tablas
-- actuales (escuelas, maestros, cheques, asignaciones, consumos, clientes, etc.).
-- Lo único que toca de lo existente es el CHECK de perfiles.rol, para permitir 'ventas'
-- (conservando 'admin', 'director' y 'cliente').
--
-- Se ejecuta en UNA transacción: si algo falla, no queda nada a medias.
-- Si se ejecuta dos veces, la segunda FALLA a propósito (las tablas ya existen) y no cambia nada.
--
-- ANTES DE EJECUTAR EN PRODUCCIÓN: respaldo + prueba en una copia (ver la guía de Codex).
-- Para deshacer: modulo_precios_rollback.sql
-- =====================================================================
begin;

-- ---------------------------------------------------------------------
-- 0. PREPARACIÓN (no modifica ningún dato)
-- ---------------------------------------------------------------------

-- Rol nuevo 'ventas' (solo consulta de precios). Se CONSERVAN los roles que ya existen
-- ('admin', 'director', 'cliente'). Se busca el CHECK actual por su definición, no por
-- su nombre, por si en producción se llama distinto.
do $$
declare
  v_nombres text[];
begin
  -- el CHECK de roles es el que menciona la columna rol Y el valor 'admin'
  select array_agg(conname) into v_nombres
  from pg_constraint
  where conrelid = 'public.perfiles'::regclass and contype = 'c'
    and pg_get_constraintdef(oid) ilike '%rol%'
    and pg_get_constraintdef(oid) ilike '%''admin''%';

  if coalesce(array_length(v_nombres, 1), 0) > 1 then
    raise exception 'Hay varios CHECK de rol en perfiles (%). Revísalo a mano antes de migrar.', v_nombres;
  end if;
  if v_nombres is not null then
    execute format('alter table public.perfiles drop constraint %I', v_nombres[1]);
  end if;

  alter table public.perfiles add constraint perfiles_rol_check
    check (rol in ('admin', 'director', 'cliente', 'ventas'));
end $$;

-- Ayudantes propios del módulo (prefijo mp_). NO reemplazan es_admin() ni nada
-- que ya exista en tu base: solo los usan las políticas del módulo de precios.
create function public.mp_es_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from perfiles
                 where id = auth.uid() and rol = 'admin' and activo);
$$;

create function public.mp_es_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from perfiles
                 where id = auth.uid() and rol in ('admin', 'ventas') and activo);
$$;

-- "Hoy" en hora de Guatemala (el servidor trabaja en UTC; sin esto, una promo
-- que vence hoy desaparecería a las 6 pm)
create function public.mp_hoy() returns date
language sql stable as $$
  select (now() at time zone 'America/Guatemala')::date;
$$;

-- ---------------------------------------------------------------------
-- 1. TABLAS
-- ---------------------------------------------------------------------
create table public.categorias (
  id     bigint generated always as identity primary key,
  nombre text not null unique
);
insert into public.categorias (nombre) values
  ('Cámaras de seguridad'),
  ('Aires acondicionados'),
  ('Accesorios e instalación'),
  ('Otros');

create table public.proveedores (
  id        bigint generated always as identity primary key,
  nombre    text not null unique,
  contacto  text,
  activo    boolean not null default true,
  creado_en timestamptz not null default now()
);

-- Teléfonos autorizados a enviar documentos por WhatsApp.
-- Todo mensaje de un número que NO esté aquí se ignora (evita que un extraño meta precios).
-- Formato: solo dígitos con código de país, ej. 50255551234
create table public.remitentes (
  telefono     text primary key check (telefono ~ '^[0-9]{8,15}$'),
  nombre       text not null,
  proveedor_id bigint references public.proveedores(id),
  activo       boolean not null default true
);

-- Cada PDF o imagen recibido (de WhatsApp o subido a mano)
create table public.documentos (
  id             bigint generated always as identity primary key,
  origen         text not null check (origen in ('whatsapp', 'manual')),
  wa_message_id  text unique,                 -- evita procesar dos veces el mismo mensaje
  remitente_tel  text,
  proveedor_id   bigint references public.proveedores(id),
  storage_path   text not null,               -- ruta dentro del bucket 'documentos-precios'
  nombre_archivo text,
  mime           text not null,
  mensaje        text,                        -- texto/pie de foto que venía con el archivo
  estado         text not null default 'pendiente'
                 check (estado in ('pendiente', 'procesando', 'procesado', 'error')),
  error          text,
  modelo_ia      text,
  intentos       int  not null default 0,
  recibido_en    timestamptz not null default now(),
  procesado_en   timestamptz,
  creado_por     uuid default auth.uid() references public.perfiles(id)
);
create index on public.documentos (estado);

create table public.productos (
  id              bigint generated always as identity primary key,
  categoria_id    bigint not null references public.categorias(id),
  marca           text,
  modelo          text,
  nombre          text not null,
  descripcion     text,
  especificaciones jsonb not null default '{}',   -- ej. {"btu":12000,"inverter":true,"mp":4}
  activo          boolean not null default true,
  creado_en       timestamptz not null default now(),
  -- identifica "el mismo producto" aunque llegue en distintos documentos
  clave           text generated always as (
                    lower(regexp_replace(btrim(coalesce(marca, '')), '[[:space:]]+', '', 'g')) || '|' ||
                    lower(regexp_replace(btrim(coalesce(modelo, nombre)), '[[:space:]]+', '', 'g'))
                  ) stored,
  unique (clave)
);
create index on public.productos (categoria_id);

-- Cada precio detectado. Nunca se sobrescribe: queda el historial.
create table public.precios (
  id            bigint generated always as identity primary key,
  producto_id   bigint not null references public.productos(id),
  proveedor_id  bigint references public.proveedores(id),
  documento_id  bigint references public.documentos(id),
  tipo          text not null default 'lista' check (tipo in ('lista', 'promocion')),
  precio        numeric(12,2) not null check (precio >= 0),
  moneda        text not null default 'GTQ' check (moneda in ('GTQ', 'USD')),
  incluye_iva   boolean,                      -- null = el documento no lo dice
  vigente_desde date not null default public.mp_hoy(),
  vigente_hasta date,                         -- null = sin fecha de vencimiento
  condiciones   text,                         -- ej. "compra mínima 3 unidades"
  estado        text not null default 'por_revisar'
                check (estado in ('por_revisar', 'aprobado', 'descartado')),
  confianza     numeric(3,2) check (confianza between 0 and 1),
  creado_en     timestamptz not null default now(),
  aprobado_por  uuid references public.perfiles(id),
  aprobado_en   timestamptz,
  constraint vigencia_valida check (vigente_hasta is null or vigente_hasta >= vigente_desde)
);
create index on public.precios (producto_id, proveedor_id, tipo, vigente_desde desc);
create index on public.precios (estado);
create index on public.precios (documento_id);

-- Al aprobar, deja constancia de quién y cuándo
create function public.marcar_aprobacion() returns trigger
language plpgsql as $$
begin
  if new.estado = 'aprobado' and old.estado is distinct from 'aprobado' then
    new.aprobado_por := auth.uid();
    new.aprobado_en  := now();
  end if;
  return new;
end $$;

create trigger trg_marcar_aprobacion
  before update of estado on public.precios
  for each row execute function public.marcar_aprobacion();

-- ---------------------------------------------------------------------
-- 2. FUNCIÓN PARA LA AUTOMATIZACIÓN: crea el producto si no existe
--    (la usa la Edge Function con la clave service_role; nadie más puede llamarla)
-- ---------------------------------------------------------------------
create function public.upsert_producto(
  p_categoria text, p_marca text, p_modelo text, p_nombre text,
  p_descripcion text default null, p_especificaciones jsonb default '{}'
) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_cat bigint;
  v_id  bigint;
begin
  select id into v_cat from categorias where lower(nombre) = lower(p_categoria);
  if v_cat is null then
    select id into v_cat from categorias where nombre = 'Otros';
  end if;

  insert into productos (categoria_id, marca, modelo, nombre, descripcion, especificaciones)
  values (v_cat, nullif(btrim(p_marca), ''), nullif(btrim(p_modelo), ''), btrim(p_nombre),
          p_descripcion, coalesce(p_especificaciones, '{}'))
  on conflict (clave) do update
     set descripcion      = coalesce(productos.descripcion, excluded.descripcion),
         especificaciones = productos.especificaciones || excluded.especificaciones
  returning id into v_id;
  return v_id;
end $$;

revoke all on function public.upsert_producto(text, text, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.upsert_producto(text, text, text, text, text, jsonb) to service_role;

-- ---------------------------------------------------------------------
-- 3. VISTAS PARA EL PANEL
-- ---------------------------------------------------------------------

-- Precio vigente HOY: el más reciente aprobado por producto + proveedor + tipo
create view public.precios_vigentes with (security_invoker = true) as
select distinct on (p.producto_id, p.proveedor_id, p.tipo) p.*
from public.precios p
where p.estado = 'aprobado'
  and p.vigente_desde <= public.mp_hoy()
  and (p.vigente_hasta is null or p.vigente_hasta >= public.mp_hoy())
order by p.producto_id, p.proveedor_id, p.tipo, p.vigente_desde desc, p.id desc;

-- La pantalla principal: lo que se consulta sin andar buscando en WhatsApp
create view public.panel_precios with (security_invoker = true) as
select v.id as precio_id,
       c.nombre as categoria,
       p.id     as producto_id,
       p.marca, p.modelo, p.nombre, p.especificaciones,
       pv.nombre as proveedor,
       v.tipo, v.precio, v.moneda, v.incluye_iva,
       v.vigente_desde, v.vigente_hasta,
       (v.vigente_hasta - public.mp_hoy()) as dias_restantes,
       v.condiciones,
       v.documento_id,
       v.precio = min(v.precio) over (partition by v.producto_id, v.moneda) as es_mejor_precio
from public.precios_vigentes v
join public.productos   p  on p.id = v.producto_id
join public.categorias  c  on c.id = p.categoria_id
left join public.proveedores pv on pv.id = v.proveedor_id
where p.activo;

-- Lo que la IA extrajo y espera que alguien lo confirme
create view public.cola_revision with (security_invoker = true) as
select pr.id as precio_id, pr.documento_id, d.storage_path, d.nombre_archivo,
       c.nombre as categoria, p.marca, p.modelo, p.nombre,
       pv.nombre as proveedor, pr.tipo, pr.precio, pr.moneda, pr.incluye_iva,
       pr.vigente_desde, pr.vigente_hasta, pr.condiciones, pr.confianza, pr.creado_en
from public.precios pr
join public.productos   p on p.id = pr.producto_id
join public.categorias  c on c.id = p.categoria_id
left join public.proveedores pv on pv.id = pr.proveedor_id
left join public.documentos  d  on d.id = pr.documento_id
where pr.estado = 'por_revisar';

-- ---------------------------------------------------------------------
-- 4. SEGURIDAD (RLS)
--    La Edge Function usa service_role (salta RLS), por eso no necesita políticas.
--    Sin política de DELETE: nada se borra; se descarta o se desactiva.
-- ---------------------------------------------------------------------
alter table public.categorias   enable row level security;
alter table public.proveedores  enable row level security;
alter table public.remitentes   enable row level security;
alter table public.documentos   enable row level security;
alter table public.productos    enable row level security;
alter table public.precios      enable row level security;

-- Admin: ver, crear y editar todo
create policy admin_select on public.categorias  for select using (public.mp_es_admin());
create policy admin_insert on public.categorias  for insert with check (public.mp_es_admin());
create policy admin_update on public.categorias  for update using (public.mp_es_admin()) with check (public.mp_es_admin());

create policy admin_select on public.proveedores for select using (public.mp_es_admin());
create policy admin_insert on public.proveedores for insert with check (public.mp_es_admin());
create policy admin_update on public.proveedores for update using (public.mp_es_admin()) with check (public.mp_es_admin());

create policy admin_select on public.remitentes  for select using (public.mp_es_admin());
create policy admin_insert on public.remitentes  for insert with check (public.mp_es_admin());
create policy admin_update on public.remitentes  for update using (public.mp_es_admin()) with check (public.mp_es_admin());

create policy admin_select on public.documentos  for select using (public.mp_es_admin());
create policy admin_insert on public.documentos  for insert with check (public.mp_es_admin());
create policy admin_update on public.documentos  for update using (public.mp_es_admin()) with check (public.mp_es_admin());

create policy admin_select on public.productos   for select using (public.mp_es_admin());
create policy admin_insert on public.productos   for insert with check (public.mp_es_admin());
create policy admin_update on public.productos   for update using (public.mp_es_admin()) with check (public.mp_es_admin());

create policy admin_select on public.precios     for select using (public.mp_es_admin());
create policy admin_insert on public.precios     for insert with check (public.mp_es_admin());
create policy admin_update on public.precios     for update using (public.mp_es_admin()) with check (public.mp_es_admin());

-- Ventas: solo lectura de lo ya aprobado (+ catálogos y el documento original)
create policy staff_select on public.categorias  for select using (public.mp_es_staff());
create policy staff_select on public.proveedores for select using (public.mp_es_staff());
create policy staff_select on public.productos   for select using (public.mp_es_staff());
create policy staff_select on public.documentos  for select using (public.mp_es_staff());
create policy staff_select on public.precios     for select
  using (public.mp_es_staff() and estado = 'aprobado');

-- ---------------------------------------------------------------------
-- 5. ARCHIVOS (Supabase Storage): bucket privado para los PDF e imágenes
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('documentos-precios', 'documentos-precios', false, 157286400,
        array['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy "staff lee documentos de precios" on storage.objects for select
  using (bucket_id = 'documentos-precios' and public.mp_es_staff());
create policy "admin sube documentos de precios" on storage.objects for insert
  with check (bucket_id = 'documentos-precios' and public.mp_es_admin());

commit;

-- ---------------------------------------------------------------------
-- 6. DATOS INICIALES (cambia los valores)
-- ---------------------------------------------------------------------
-- insert into public.proveedores (nombre, contacto) values ('Nombre del proveedor', 'Persona de contacto');
-- insert into public.remitentes (telefono, nombre, proveedor_id)
-- values ('50255551234', 'Vendedor de Proveedor X', 1);
--
-- Para dar acceso de consulta a un vendedor: créalo en Authentication > Users y luego
-- insert into public.perfiles (id, nombre, rol, usuario) values ('UUID-DEL-USUARIO', 'Nombre', 'ventas', 'nombre.usuario');
