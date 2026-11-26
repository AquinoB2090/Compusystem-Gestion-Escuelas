-- Corrección manual de los seis combos visibles en el documento 8.
-- Los seis precios quedan pendientes de autorización en la bandeja.
begin;

do $$
declare
  combo record;
  producto bigint;
  descripcion_combo constant text := 'Incluye 20 metros de cable UTP por cámara, video balún, transformadores y conectores.';
begin
  -- Reutiliza el precio pendiente existente para el combo de 2 cámaras.
  update public.productos
  set modelo = null,
      nombre = 'Combo de 2 cámaras Dahua 5MP con DVR de 4 canales y disco duro de 500GB',
      descripcion = descripcion_combo,
      especificaciones = jsonb_build_object(
        'camaras', 2, 'resolucion', '5MP', 'dvr_canales', 4,
        'almacenamiento', '500GB', 'audio', 'Bidireccional',
        'luz_nocturna', '30 m', 'modelo_camara', 'DH-HAC-HFW1500RLN-IL-T'
      )
  where id = 51;

  update public.precios
  set precio = 1060, confianza = 0.98
  where id = 51 and documento_id = 8 and estado = 'por_revisar';

  if not found then
    raise exception 'No se encontró el precio 51 pendiente del documento 8.';
  end if;

  for combo in
    select * from (values
      (4, 4, '500GB', 1520::numeric),
      (6, 8, '1TB', 2530::numeric),
      (8, 8, '1TB', 3025::numeric),
      (10, 16, '1TB', 3920::numeric),
      (16, 16, '1TB', 5380::numeric)
    ) as combos(camaras, dvr_canales, almacenamiento, precio)
  loop
    producto := public.upsert_producto(
      'Cámaras de seguridad', 'Dahua', null,
      format('Combo de %s cámaras Dahua 5MP con DVR de %s canales y disco duro de %s',
        combo.camaras, combo.dvr_canales, combo.almacenamiento),
      descripcion_combo,
      jsonb_build_object(
        'camaras', combo.camaras, 'resolucion', '5MP',
        'dvr_canales', combo.dvr_canales, 'almacenamiento', combo.almacenamiento,
        'audio', 'Bidireccional', 'luz_nocturna', '30 m',
        'modelo_camara', 'DH-HAC-HFW1500RLN-IL-T'
      )
    );

    insert into public.precios (
      producto_id, documento_id, tipo, precio, moneda, incluye_iva,
      vigente_desde, vigente_hasta, condiciones, estado, confianza
    ) values (
      producto, 8, 'promocion', combo.precio, 'GTQ', null,
      date '2026-11-25', null, null, 'por_revisar', 0.98
    );
  end loop;
end $$;

commit;
