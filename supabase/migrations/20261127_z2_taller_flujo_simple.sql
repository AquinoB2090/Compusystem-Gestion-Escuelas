-- Simplificación del flujo de taller: cobro único en la orden y entrega directa.
begin;

-- El monto cobrado pasa a ser un dato de la orden. Se conserva lo ya pagado
-- en taller_pagos para no perder información histórica.
alter table public.taller_ordenes add column if not exists monto_cobrado numeric(12,2);
update public.taller_ordenes o
   set monto_cobrado = coalesce((
     select sum(p.monto) from public.taller_pagos p where p.orden_id = o.id
   ), 0)
 where monto_cobrado is null;
alter table public.taller_ordenes alter column monto_cobrado set default 0;
alter table public.taller_ordenes alter column monto_cobrado set not null;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'taller_ordenes_monto_cobrado_check') then
    alter table public.taller_ordenes
      add constraint taller_ordenes_monto_cobrado_check check (monto_cobrado >= 0);
  end if;
end $$;

-- Cualquier orden puede marcarse como entregada directamente. El resto de
-- transiciones se mantiene, pero ya no exigen presupuesto ni aprobación.
create or replace function public.taller_registrar_historial_estado()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if tg_op='INSERT' then
    insert into public.taller_historial(orden_id,estado_nuevo,detalle,creado_por)
      values(new.id,new.estado,'Equipo recibido en taller.',coalesce(auth.uid(),new.creado_por));
  elsif old.estado is distinct from new.estado then
    if not (case old.estado
      when 'recibido' then new.estado in ('diagnostico','cancelado','entregado')
      when 'diagnostico' then new.estado in ('esperando_autorizacion','no_reparable','cancelado','entregado')
      when 'esperando_autorizacion' then new.estado in ('autorizado','no_reparable','cancelado','entregado')
      when 'autorizado' then new.estado in ('reparacion','cancelado','entregado')
      when 'reparacion' then new.estado in ('listo','no_reparable','cancelado','entregado')
      when 'listo' then new.estado in ('reparacion','entregado')
      when 'no_reparable' then new.estado in ('entregado','cancelado')
      when 'cancelado' then new.estado in ('recibido','entregado')
      else false
    end) then
      raise exception 'Cambio de estado no permitido para esta orden.' using errcode='23514';
    end if;
    insert into public.taller_historial(orden_id,estado_anterior,estado_nuevo,detalle,creado_por)
      values(new.id,old.estado,new.estado,'Estado actualizado a '||new.estado||'.',auth.uid());
  end if;
  return new;
end; $$;

drop trigger if exists taller_validar_aprobacion on public.taller_ordenes;

notify pgrst, 'reload schema';
commit;
