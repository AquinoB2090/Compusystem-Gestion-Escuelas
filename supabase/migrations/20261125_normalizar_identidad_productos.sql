begin;

-- Reject unexpected collisions before changing the unique identity key.
do $$
begin
  if exists (
    select 1
    from public.productos
    group by
      lower(regexp_replace(btrim(coalesce(marca, '')), '[[:space:]]+', '', 'g')) || '|' ||
      lower(regexp_replace(btrim(coalesce(modelo, nombre)), '[[:space:]]+', '', 'g'))
    having count(*) > 1
  ) then
    raise exception 'Hay productos duplicados al normalizar espacios; consolidarlos antes de aplicar esta migración.';
  end if;
end $$;

alter table public.productos drop constraint if exists productos_clave_key;
alter table public.productos drop column clave;
alter table public.productos
  add column clave text generated always as (
    lower(regexp_replace(btrim(coalesce(marca, '')), '[[:space:]]+', '', 'g')) || '|' ||
    lower(regexp_replace(btrim(coalesce(modelo, nombre)), '[[:space:]]+', '', 'g'))
  ) stored;
alter table public.productos add constraint productos_clave_key unique (clave);

comment on column public.productos.clave is
  'Identidad normalizada por marca y modelo (o nombre), ignorando mayúsculas y espacios internos.';

commit;
