-- Desactiva el precio de venta sin volver a exponer costos a ventas.
-- La función deja NULL en `precio` hasta que administración configure otro margen.
begin;
update public.configuracion_instalaciones
set margen_porcentaje = null,
    actualizado_en = now(),
    actualizado_por = auth.uid()
where id = 1;
commit;
