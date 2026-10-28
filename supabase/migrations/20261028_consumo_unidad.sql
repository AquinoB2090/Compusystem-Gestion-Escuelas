-- Permite registrar consumos de maestros en copias o quetzales y llevar
-- El monto se conserva normalizado a quetzales para calcular el saldo.
alter table public.consumos
  add column if not exists unidad text not null default 'fotocopias';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'consumos_unidad_check'
      and conrelid = 'public.consumos'::regclass
  ) then
    alter table public.consumos
      add constraint consumos_unidad_check
      check (unidad in ('fotocopias', 'quetzales'));
  end if;
end;
$$;

create or replace view public.hoja_maestro_acumulada
with (security_invoker = true) as
with asignado as (
  select maestro_id, sum(monto) as monto
  from public.asignaciones where not anulada group by maestro_id
), movimientos as (
  select c.maestro_id, c.fecha, c.periodo, c.id, 1 as orden,
    'consumo'::text as tipo, c.catedratico::text as catedratico,
    c.descripcion::text as descripcion, c.monto::numeric(12,2) as importe,
    c.recibido_conforme, c.recibido_por::text as recibido_por,
    -c.monto::numeric(12,2) as cambio, c.unidad::text as unidad
  from public.consumos c where not c.anulado
  union all
  select j.maestro_id, j.creado_en::date,
    date_trunc('month', j.creado_en)::date, j.id, 0,
    'ajuste'::text, 'Administración'::text,
    ('Ajuste de saldo: ' || j.motivo)::text, j.saldo_delta::numeric(12,2),
    false, null::text, j.saldo_delta::numeric(12,2), 'fotocopias'::text
  from public.ajustes_saldo j
)
select x.maestro_id, x.fecha, x.periodo, x.tipo, x.catedratico,
  x.descripcion, x.importe, x.recibido_conforme, x.recibido_por,
  (coalesce(a.monto, 0) + sum(x.cambio) over (
    partition by x.maestro_id order by x.fecha, x.orden, x.id
    rows between unbounded preceding and current row
  ))::numeric(12,2) as saldo,
  x.unidad
from movimientos x
left join asignado a on a.maestro_id = x.maestro_id;

grant select on public.hoja_maestro_acumulada to authenticated;
notify pgrst, 'reload schema';
