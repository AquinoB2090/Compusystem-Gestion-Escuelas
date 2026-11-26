-- Corrección aditiva de permisos para el módulo de precios.
-- Ejecutar primero en una copia local restaurada; no altera datos de negocio.
begin;

do $$
begin
  if to_regprocedure('public.upsert_producto(text,text,text,text,text,jsonb)') is null then
    raise exception 'No existe public.upsert_producto con la firma esperada';
  end if;
  if to_regclass('public.documentos') is null or to_regclass('public.precios') is null then
    raise exception 'Faltan las tablas public.documentos o public.precios';
  end if;
  if to_regclass('storage.objects') is null then
    raise exception 'No existe storage.objects';
  end if;
end $$;

-- Esta función usa SECURITY DEFINER para la automatización del servidor.
-- No debe estar disponible a través de la API con las claves anon/authenticated.
revoke all on function public.upsert_producto(text, text, text, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.upsert_producto(text, text, text, text, text, jsonb)
  to service_role;

-- Ventas solo puede ver documentos vinculados a un precio aprobado.
-- admin_select continúa permitiendo a administración revisar todos los documentos.
drop policy if exists staff_select on public.documentos;
create policy staff_select on public.documentos
  for select to authenticated
  using (
    public.mp_es_staff()
    and exists (
      select 1
      from public.precios p
      where p.documento_id = documentos.id
        and p.estado = 'aprobado'
    )
  );

-- Storage aplica el mismo filtro al descargar documentos originales.
-- Administración conserva acceso a todos los archivos para revisión.
drop policy if exists "staff lee documentos de precios" on storage.objects;
drop policy if exists "admin lee todos los documentos de precios" on storage.objects;
drop policy if exists "staff lee documentos aprobados" on storage.objects;
drop policy if exists "admin sube documentos de precios" on storage.objects;
create policy "admin lee todos los documentos de precios" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'documentos-precios'
    and public.mp_es_admin()
  );
create policy "admin sube documentos de precios" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'documentos-precios'
    and public.mp_es_admin()
  );
create policy "staff lee documentos aprobados" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'documentos-precios'
    and public.mp_es_staff()
    and exists (
      select 1
      from public.documentos d
      join public.precios p on p.documento_id = d.id
      where d.storage_path = objects.name
        and p.estado = 'aprobado'
    )
  );

commit;
