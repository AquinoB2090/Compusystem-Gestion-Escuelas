-- Los precios recibidos son costo de compra. Ventas solo verá el precio con
-- el margen global configurado por administración, nunca el costo directo.
begin;

do $$
begin
  if to_regclass('public.precios') is null or to_regclass('public.panel_precios') is null
     or to_regclass('public.precios_vigentes') is null then
    raise exception 'Falta el módulo de precios instalado en public.';
  end if;
  if to_regprocedure('public.mp_es_admin()') is null or to_regprocedure('public.mp_es_staff()') is null then
    raise exception 'Faltan las funciones de acceso mp_es_admin/mp_es_staff.';
  end if;
  if to_regclass('public.configuracion_instalaciones') is not null
     or to_regclass('public.historial_precios') is not null then
    raise exception 'Ya existe configuración de margen o historial seguro. No ejecutes esta migración de nuevo.';
  end if;
end $$;

create table public.configuracion_instalaciones (
  id smallint primary key check (id = 1),
  margen_porcentaje numeric(7,3) check (margen_porcentaje is null or margen_porcentaje >= 0),
  actualizado_en timestamptz not null default now(),
  actualizado_por uuid references public.perfiles(id)
);
insert into public.configuracion_instalaciones (id, margen_porcentaje) values (1, null);
alter table public.configuracion_instalaciones enable row level security;

create policy admin_select on public.configuracion_instalaciones
  for select to authenticated using (public.mp_es_admin());
create policy admin_update on public.configuracion_instalaciones
  for update to authenticated using (public.mp_es_admin()) with check (public.mp_es_admin());
revoke all on public.configuracion_instalaciones from public, anon;
grant select, update on public.configuracion_instalaciones to authenticated;

-- El costo nunca se consulta directamente por cuentas de ventas.
drop policy if exists staff_select on public.precios;
drop policy if exists staff_select on public.documentos;
drop policy if exists "staff lee documentos aprobados" on storage.objects;
revoke all on public.precios from public, anon;
grant select, insert, update on public.precios to authenticated;

-- Solo las vistas de salida seguras consultan esta vista definer; no se publica
-- directamente porque conserva los costos de compra.
create or replace view public.precios_vigentes
  with (security_invoker = false, security_barrier = true) as
select distinct on (p.producto_id, p.proveedor_id, p.tipo) p.*
from public.precios p
where p.estado = 'aprobado'
  and p.vigente_desde <= public.mp_hoy()
  and (p.vigente_hasta is null or p.vigente_hasta >= public.mp_hoy())
order by p.producto_id, p.proveedor_id, p.tipo, p.vigente_desde desc, p.id desc;

-- El listado conserva el precio de venta en la columna histórica `precio`.
-- El costo se agrega al final y solo se devuelve al administrador.
create or replace view public.panel_precios
  with (security_invoker = false, security_barrier = true) as
select v.id as precio_id,
       c.nombre as categoria,
       p.id as producto_id,
       p.marca, p.modelo, p.nombre, p.especificaciones,
       pv.nombre as proveedor,
       v.tipo,
       case when cfg.margen_porcentaje is null then null::numeric(12,2)
            else round(v.precio * (1 + cfg.margen_porcentaje / 100), 2)::numeric(12,2) end as precio,
       v.moneda, v.incluye_iva,
       v.vigente_desde, v.vigente_hasta,
       (v.vigente_hasta - public.mp_hoy()) as dias_restantes,
       v.condiciones,
       case when public.mp_es_admin() then v.documento_id else null end as documento_id,
       v.precio = min(v.precio) over (partition by v.producto_id, v.moneda) as es_mejor_precio,
       case when public.mp_es_admin() then v.precio else null end as costo_compra,
       cfg.margen_porcentaje is not null as precio_configurado
from public.precios_vigentes v
cross join public.configuracion_instalaciones cfg
join public.productos p on p.id = v.producto_id
join public.categorias c on c.id = p.categoria_id
left join public.proveedores pv on pv.id = v.proveedor_id
where p.activo and public.mp_es_staff();

create view public.historial_precios
  with (security_invoker = false, security_barrier = true) as
select pr.id as precio_id,
       p.id as producto_id,
       c.nombre as categoria,
       p.marca, p.modelo, p.nombre,
       pv.nombre as proveedor,
       pr.tipo,
       case when cfg.margen_porcentaje is null then null
            else round(pr.precio * (1 + cfg.margen_porcentaje / 100), 2) end as precio,
       pr.moneda, pr.incluye_iva,
       pr.vigente_desde, pr.vigente_hasta,
       (pr.vigente_hasta - public.mp_hoy()) as dias_restantes,
       pr.condiciones,
       case when public.mp_es_admin() then pr.documento_id else null end as documento_id,
       case when public.mp_es_admin() then pr.precio else null end as costo_compra,
       cfg.margen_porcentaje is not null as precio_configurado
from public.precios pr
cross join public.configuracion_instalaciones cfg
join public.productos p on p.id = pr.producto_id
join public.categorias c on c.id = p.categoria_id
left join public.proveedores pv on pv.id = pr.proveedor_id
where pr.estado = 'aprobado' and p.activo and public.mp_es_staff();

revoke all on public.panel_precios, public.historial_precios from public, anon, authenticated;
grant select on public.panel_precios, public.historial_precios to authenticated;
revoke all on public.precios_vigentes, public.cola_revision from public, anon, authenticated;
grant select on public.cola_revision to authenticated;

commit;
