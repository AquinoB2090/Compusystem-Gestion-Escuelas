begin;

create or replace function public.mp_eliminar_documento(p_documento_id bigint)
returns table (storage_path text, precios_eliminados bigint)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_storage_path text;
  v_estado text;
  v_precios_eliminados bigint;
begin
  if not coalesce(public.mp_es_admin(), false) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select d.storage_path, d.estado
    into v_storage_path, v_estado
    from public.documentos d
   where d.id = p_documento_id
   for update;

  if not found then
    raise exception 'documento_no_encontrado' using errcode = 'P0002';
  end if;

  if v_estado = 'procesando' then
    raise exception 'documento_en_proceso' using errcode = '55000';
  end if;

  delete from public.precios p where p.documento_id = p_documento_id;
  get diagnostics v_precios_eliminados = row_count;

  delete from public.documentos d where d.id = p_documento_id;

  return query select v_storage_path, v_precios_eliminados;
end;
$$;

revoke all on function public.mp_eliminar_documento(bigint) from public, anon;
grant execute on function public.mp_eliminar_documento(bigint) to authenticated;

drop policy if exists "admin elimina documentos de precios" on storage.objects;
create policy "admin elimina documentos de precios" on storage.objects
  for delete using (bucket_id = 'documentos-precios' and public.mp_es_admin());

commit;
