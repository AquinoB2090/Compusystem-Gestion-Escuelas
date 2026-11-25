-- =====================================================================
-- DESHACER el módulo de precios (modulo_precios_produccion.sql)
--
-- Borra SOLO lo que creó el módulo. No toca ninguna tabla anterior
-- (escuelas, maestros, cheques, asignaciones, consumos, clientes, etc.)
-- ni ninguna fila de perfiles.
--
-- ⚠️ BORRA los precios, productos, proveedores, remitentes y documentos que se hayan
--    cargado en el módulo. Si ya tiene datos que quieras conservar, haz respaldo antes.
--
-- Antes de ejecutar: vacía el bucket 'documentos-precios' desde el panel de Supabase
-- (Storage). Los archivos no se borran por SQL; si quedan, el bucket se queda y no estorba.
--
-- El CHECK de perfiles.rol se deja como está (con 'ventas' permitido): es inofensivo,
-- y quitarlo fallaría si ya existe algún perfil con rol 'ventas'.
-- =====================================================================
begin;

drop policy if exists "staff lee documentos de precios"  on storage.objects;
drop policy if exists "admin sube documentos de precios" on storage.objects;

drop view if exists public.cola_revision;
drop view if exists public.panel_precios;
drop view if exists public.precios_vigentes;

drop table if exists public.precios      cascade;
drop table if exists public.productos    cascade;
drop table if exists public.documentos   cascade;
drop table if exists public.remitentes   cascade;
drop table if exists public.proveedores  cascade;
drop table if exists public.categorias   cascade;

drop function if exists public.marcar_aprobacion();
drop function if exists public.upsert_producto(text, text, text, text, text, jsonb);
drop function if exists public.mp_es_staff();
drop function if exists public.mp_es_admin();
drop function if exists public.mp_hoy();

-- El bucket se borra solo si está vacío (si tiene archivos, este comando no lo borra)
delete from storage.buckets b
where b.id = 'documentos-precios'
  and not exists (select 1 from storage.objects o where o.bucket_id = b.id);

commit;
