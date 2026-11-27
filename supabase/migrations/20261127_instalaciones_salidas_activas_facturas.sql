begin;

alter table public.instalaciones_salidas
  alter column fecha_inicio type timestamptz using (fecha_inicio::timestamp at time zone 'America/Guatemala'),
  alter column fecha_fin type timestamptz using (fecha_fin::timestamp at time zone 'America/Guatemala'),
  alter column fecha_fin drop not null,
  alter column trabajo_realizado drop not null,
  alter column cobrado drop not null,
  alter column invertido drop not null;

alter table public.instalaciones_salidas
  add column estado text not null default 'finalizada' check (estado in ('activa', 'finalizada')),
  add column factura boolean not null default false;

alter table public.instalaciones_salidas alter column estado set default 'activa';
alter table public.instalaciones_salidas alter column fecha_inicio set default now();
alter table public.instalaciones_salidas alter column cobrado set default 0;
alter table public.instalaciones_salidas alter column invertido set default 0;

alter table public.instalaciones_salidas drop constraint instalaciones_salidas_fechas_validas;
alter table public.instalaciones_salidas
  add constraint instalaciones_salidas_estado_valido check (
    (estado = 'activa' and fecha_fin is null)
    or
    (estado = 'finalizada' and fecha_fin is not null and trabajo_realizado is not null
      and length(trim(trabajo_realizado)) > 0 and cobrado is not null and invertido is not null)
  ),
  add constraint instalaciones_salidas_fechas_validas check (fecha_fin is null or fecha_fin >= fecha_inicio);

alter table public.instalaciones_salidas drop column ganancia;
alter table public.instalaciones_salidas
  add column descuento_factura numeric(12,2)
    generated always as (case when factura then round(cobrado * 0.05, 2) else 0 end) stored,
  add column ganancia numeric(12,2)
    generated always as (cobrado - invertido - case when factura then round(cobrado * 0.05, 2) else 0 end) stored;

drop policy if exists instalaciones_salidas_access on public.instalaciones_salidas;
create policy instalaciones_salidas_select on public.instalaciones_salidas
  for select to authenticated
  using (exists (select 1 from public.perfiles p where p.id = auth.uid() and p.activo = true and p.rol in ('admin', 'ventas')));
create policy instalaciones_salidas_insert on public.instalaciones_salidas
  for insert to authenticated
  with check (
    creado_por = auth.uid()
    and exists (select 1 from public.perfiles p where p.id = auth.uid() and p.activo = true and p.rol in ('admin', 'ventas'))
  );
create policy instalaciones_salidas_update on public.instalaciones_salidas
  for update to authenticated
  using (
    creado_por = auth.uid()
    and exists (select 1 from public.perfiles p where p.id = auth.uid() and p.activo = true and p.rol in ('admin', 'ventas'))
  )
  with check (
    creado_por = auth.uid()
    and exists (select 1 from public.perfiles p where p.id = auth.uid() and p.activo = true and p.rol in ('admin', 'ventas'))
  );

grant update on public.instalaciones_salidas to authenticated;
notify pgrst, 'reload schema';
commit;
