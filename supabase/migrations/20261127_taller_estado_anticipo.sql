-- Permite reabrir órdenes canceladas y registrar anticipos antes de fijar presupuesto.
begin;

create or replace function public.taller_registrar_historial_estado()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if tg_op='INSERT' then
    insert into public.taller_historial(orden_id,estado_nuevo,detalle,creado_por)
      values(new.id,new.estado,'Equipo recibido en taller.',coalesce(auth.uid(),new.creado_por));
  elsif old.estado is distinct from new.estado then
    if not (case old.estado
      when 'recibido' then new.estado in ('diagnostico','cancelado')
      when 'diagnostico' then new.estado in ('esperando_autorizacion','no_reparable','cancelado')
      when 'esperando_autorizacion' then new.estado in ('autorizado','no_reparable','cancelado')
      when 'autorizado' then new.estado in ('reparacion','cancelado')
      when 'reparacion' then new.estado in ('listo','no_reparable','cancelado')
      when 'listo' then new.estado in ('reparacion','entregado')
      when 'no_reparable' then new.estado in ('entregado','cancelado')
      when 'cancelado' then new.estado='recibido'
      else false
    end) then raise exception 'Cambio de estado no permitido para esta orden.' using errcode='23514'; end if;
    if new.estado='esperando_autorizacion' and (nullif(btrim(new.diagnostico),'') is null or new.presupuesto is null) then
      raise exception 'Se requiere diagnóstico y presupuesto antes de solicitar autorización.' using errcode='23514';
    end if;
    insert into public.taller_historial(orden_id,estado_anterior,estado_nuevo,detalle,creado_por)
      values(new.id,old.estado,new.estado,'Estado actualizado a '||new.estado||'.',auth.uid());
  end if;
  return new;
end; $$;

create or replace function public.taller_validar_pago()
returns trigger language plpgsql security definer set search_path=public as $$
declare base numeric(12,2); piezas numeric(12,2); abonado numeric(12,2);
begin
  select presupuesto into base from public.taller_ordenes where id=new.orden_id for update;
  if not found then raise exception 'No se encontró la orden.' using errcode='23503'; end if;
  select coalesce(sum(cantidad*precio_unitario),0) into piezas from public.taller_orden_repuestos where orden_id=new.orden_id;
  select coalesce(sum(monto),0) into abonado from public.taller_pagos where orden_id=new.orden_id;
  if (base is not null or piezas > 0) and new.monto > greatest(0,coalesce(base,0)+piezas-abonado)+0.005 then
    raise exception 'El pago supera el saldo pendiente de la orden.' using errcode='23514';
  end if;
  return new;
end; $$;
notify pgrst,'reload schema';
commit;
