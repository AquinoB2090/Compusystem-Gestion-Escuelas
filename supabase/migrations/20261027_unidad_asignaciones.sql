-- Marca la unidad de entrada y normaliza todos los montos almacenados a quetzales.
alter table public.asignaciones
  add column if not exists unidad_ingresada text not null default 'quetzales';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'asignaciones_unidad_ingresada_check'
      and conrelid = 'public.asignaciones'::regclass
  ) then
    alter table public.asignaciones
      add constraint asignaciones_unidad_ingresada_check
      check (unidad_ingresada in ('quetzales', 'fotocopias'));
  end if;
end;
$$;

-- Las asignaciones anteriores se ingresaban en quetzales. Para maestros cuyo
-- formato ya está en fotocopias, conserva esa cantidad como copias y pasa a Q.
-- unidad_ingresada evita volver a convertirlas si se ejecuta otra vez.
update public.asignaciones a
set monto = a.monto / 4,
    unidad_ingresada = 'fotocopias'
from public.maestros m
where m.id = a.maestro_id
  and m.tipo_formato = 'fotocopias'
  and a.unidad_ingresada = 'quetzales';

notify pgrst, 'reload schema';
