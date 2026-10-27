-- Permite asignar fondos directamente a un maestro sin asociar un cheque o mes.
-- Ejecutar en Supabase SQL Editor antes de usar la nueva pantalla.
alter table public.asignaciones
  add column if not exists escuela_id bigint references public.escuelas(id);

update public.asignaciones a
set escuela_id = m.escuela_id
from public.maestros m
where a.maestro_id = m.id
  and a.escuela_id is null;

alter table public.asignaciones
  alter column cheque_id drop not null,
  alter column periodo drop not null,
  alter column escuela_id set not null;

drop view if exists public.hoja_maestro_acumulada;
create view public.hoja_maestro_acumulada
with (security_invoker = true) as
select
  c.maestro_id,
  c.fecha,
  c.periodo,
  'consumo'::text as tipo,
  c.catedratico,
  c.descripcion,
  c.monto as importe,
  c.recibido_conforme,
  c.recibido_por,
  (
    coalesce(a.asignado, 0) - sum(c.monto) over (
      partition by c.maestro_id
      order by c.fecha, c.id
      rows between unbounded preceding and current row
    )
  )::numeric(12,2) as saldo
from public.consumos c
left join (
  select maestro_id, sum(monto) as asignado
  from public.asignaciones
  where not anulada
  group by maestro_id
) a on a.maestro_id = c.maestro_id
where not c.anulado;

grant select on public.hoja_maestro_acumulada to authenticated;
grant insert on public.asignaciones to authenticated;
