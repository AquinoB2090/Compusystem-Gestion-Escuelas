-- Corrección manual del documento 11 (imagen con seis combos).
-- La lectura automática guardó un solo precio: Q5,850 con el nombre del primer
-- combo y las especificaciones del último. Se descarta ese renglón y se dejan
-- los seis combos reales en pendiente de verificación.
-- La imagen se leyó de arriba abajo:
--   2 cámaras  + DVR 4 canales  + disco 500GB -> Q1,150
--   4 cámaras  + DVR 4 canales  + disco 500GB -> Q1,680
--   6 cámaras  + DVR 8 canales  + disco 1TB   -> Q2,790
--   8 cámaras  + DVR 8 canales  + disco 1TB   -> Q3,350
--  10 cámaras  + DVR 16 canales + disco 1TB   -> Q4,290
--  16 cámaras  + DVR 16 canales + disco 1TB   -> Q5,850
begin;

update public.precios
set estado = 'descartado'
where id = 65 and documento_id = 11 and estado = 'por_revisar';

do $$
declare
  combo record;
  producto bigint;
  filas integer;
  descripcion_combo constant text := 'Incluye 20 metros de cable UTP por cámara, video balún, transformadores y conectores.';
begin
  for combo in
    select * from (values
      (2, 4, '500GB', 1150::numeric),
      (4, 4, '500GB', 1680::numeric),
      (6, 8, '1TB', 2790::numeric),
      (8, 8, '1TB', 3350::numeric),
      (10, 16, '1TB', 4290::numeric),
      (16, 16, '1TB', 5850::numeric)
    ) as combos(camaras, dvr_canales, almacenamiento, precio)
  loop
    producto := public.upsert_producto(
      (select nombre from public.categorias where lower(nombre) = lower('Cámaras de seguridad')),
      'Dahua',
      null,
      format('Combo de %s cámaras Dahua 5MP con DVR de %s canales y disco duro de %s',
        combo.camaras, combo.dvr_canales, combo.almacenamiento),
      descripcion_combo,
      jsonb_build_object(
        'camaras', combo.camaras,
        'resolucion', '5MP',
        'dvr_canales', combo.dvr_canales,
        'almacenamiento', combo.almacenamiento,
        'disco_duro', combo.almacenamiento,
        'audio', 'Bidireccional',
        'luz_nocturna', '30 m',
        'modelo_camara', 'DH-HAC-HFW1500RLN-IL-T'
      )
    );

    update public.precios
    set documento_id = 11,
        precio = combo.precio,
        vigente_desde = date '2026-11-25',
        confianza = 0.98,
        estado = 'por_revisar'
    where producto_id = producto
      and proveedor_id is null
      and tipo = 'promocion'
      and moneda = 'GTQ'
      and estado = 'por_revisar';
    get diagnostics filas = row_count;

    if filas = 0 then
      insert into public.precios (
        producto_id, documento_id, tipo, precio, moneda, vigente_desde,
        estado, confianza
      ) values (
        producto, 11, 'promocion', combo.precio, 'GTQ', date '2026-11-25',
        'por_revisar', 0.98
      );
    end if;
  end loop;
end $$;

commit;

-- Verificación posterior (solo lectura): debe devolver seis filas del documento 11.
-- select precio_id, nombre, precio, confianza
-- from public.cola_revision
-- where documento_id = 11
-- order by precio_id;
