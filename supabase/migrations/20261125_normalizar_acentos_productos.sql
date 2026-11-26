begin;

-- Keep the newest copy of this repeated image pending; discard the older
-- duplicate review rows from document 8.
update public.precios
set estado = 'descartado'
where documento_id = 8 and id between 51 and 56 and estado = 'por_revisar';

-- Point document 9's six corrected prices at the original canonical products.
update public.precios
set producto_id = case id
  when 58 then 51
  when 59 then 57
  when 60 then 58
  when 61 then 59
  when 62 then 60
  when 63 then 61
end
where documento_id = 9 and id between 58 and 63;

do $$
begin
  if (select count(*) from public.precios where documento_id = 9 and id between 58 and 63) <> 6 then
    raise exception 'No se encontraron los seis precios corregidos del documento 9.';
  end if;
  if exists (select 1 from public.productos p where p.id between 68 and 73
             and exists (select 1 from public.precios pr where pr.producto_id = p.id)) then
    raise exception 'Todavia hay precios vinculados a los productos duplicados 68-73.';
  end if;
end $$;

delete from public.productos where id between 68 and 73;

alter table public.productos drop constraint if exists productos_clave_key;
alter table public.productos drop column clave;
alter table public.productos
  add column clave text generated always as (
    translate(lower(regexp_replace(btrim(coalesce(marca, '')), '[[:space:]]+', '', 'g')), 'áéíóúüñ', 'aeiouun') || '|' ||
    translate(lower(regexp_replace(btrim(coalesce(modelo, nombre)), '[[:space:]]+', '', 'g')), 'áéíóúüñ', 'aeiouun')
  ) stored;
alter table public.productos add constraint productos_clave_key unique (clave);

comment on column public.productos.clave is
  'Identidad normalizada por marca y modelo (o nombre), sin mayúsculas, espacios ni tildes.';

commit;
