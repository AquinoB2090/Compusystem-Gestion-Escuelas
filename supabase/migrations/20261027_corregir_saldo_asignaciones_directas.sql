-- Incluye las asignaciones directas (sin cheque ni periodo) en el saldo acumulado.
create or replace view public.saldo_maestro
with (security_invoker = true) as
select
  m.escuela_id,
  m.id as maestro_id,
  m.nombre as maestro,
  coalesce(a.asignado, 0)::numeric(12,2) as asignado,
  coalesce(c.consumido, 0)::numeric(12,2) as consumido,
  (coalesce(a.asignado, 0) - coalesce(c.consumido, 0))::numeric(12,2) as saldo
from public.maestros m
left join (
  select maestro_id, sum(monto) as asignado
  from public.asignaciones
  where not anulada
  group by maestro_id
) a on a.maestro_id = m.id
left join (
  select maestro_id, sum(monto) as consumido
  from public.consumos
  where not anulado
  group by maestro_id
) c on c.maestro_id = m.id
where m.activo;

grant select on public.saldo_maestro to authenticated;
notify pgrst, 'reload schema';
