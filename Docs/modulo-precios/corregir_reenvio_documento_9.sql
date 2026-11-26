-- El reenvio es la misma imagen que el documento 8. Mantiene una sola revision
-- pendiente por combo y la vincula al archivo mas reciente (documento 9).
begin;

update public.precios
set estado = 'descartado'
where id = 57 and documento_id = 9 and estado = 'por_revisar';

do $$
declare
  combo record;
  producto bigint;
  descripcion_combo constant text := 'Incluye 20 metros de cable UTP por camara, video balun, transformadores y conectores.';
  filas integer;
begin
  for combo in
    select * from (values
      (2, 4, '500GB', 1060::numeric),
      (4, 4, '500GB', 1520::numeric),
      (6, 8, '1TB', 2530::numeric),
      (8, 8, '1TB', 3025::numeric),
      (10, 16, '1TB', 3920::numeric),
      (16, 16, '1TB', 5380::numeric)
    ) as combos(camaras, dvr_canales, almacenamiento, precio)
  loop
    producto := public.upsert_producto(
      (select nombre from public.categorias where id = 1), 'Dahua', null,
      format('Combo de %s camaras Dahua 5MP con DVR de %s canales y disco duro de %s',
        combo.camaras, combo.dvr_canales, combo.almacenamiento),
      descripcion_combo,
      jsonb_build_object(
        'camaras', combo.camaras, 'resolucion', '5MP',
        'dvr_canales', combo.dvr_canales, 'almacenamiento', combo.almacenamiento,
        'audio', 'Bidireccional', 'luz_nocturna', '30 m',
        'modelo_camara', 'DH-HAC-HFW1500RLN-IL-T'
      )
    );

    update public.precios
    set documento_id = 9, precio = combo.precio, vigente_desde = date '2026-11-25', confianza = 0.98
    where producto_id = producto and proveedor_id is null
      and tipo = 'promocion' and moneda = 'GTQ' and estado = 'por_revisar';
    get diagnostics filas = row_count;

    if filas = 0 then
      insert into public.precios (
        producto_id, documento_id, tipo, precio, moneda, vigente_desde,
        estado, confianza
      ) values (
        producto, 9, 'promocion', combo.precio, 'GTQ', date '2026-11-25',
        'por_revisar', 0.98
      );
    end if;
  end loop;
end $$;

commit;
