# Revisión del documento 11 (seis combos)

Fecha: 25 de noviembre de 2026.
Alcance: revisión en producción y aplicación de la corrección autorizada por el usuario el 25 de noviembre de 2026. La corrección se aplicó con la clave de servicio leyendo/escribiendo vía REST (PostgREST); el archivo SQL queda como registro reproducible.

## Hallazgo

El documento `11` (`Gemini_Generated_Image_s6yxtas6yxtas6yx.jpg`, subido manualmente) terminó en estado `procesado`, pero dejó una sola fila en `cola_revision`:

| precio_id | nombre | precio | estado |
|---|---|---:|---|
| 65 | Combo de 2 Cámaras 5MP con Audio Bidireccional | Q5,850 | por_revisar |

El producto 62 asociado mezcla datos de dos renglones:

- `nombre` y `descripcion`: combo de **2 cámaras**, DVR 4 canales, disco 500GB (primer renglón).
- `especificaciones.camaras = 16`, `dvr_canales = 16`, `almacenamiento = 1TB` (último renglón).
- `precio = 5850`: corresponde al combo de 16 cámaras (último renglón).

Es exactamente el problema reportado: el lector tomó el nombre del primero y el precio/especificaciones del último, y omitió los seis renglones intermedios.

## Lectura de la imagen

Transcripción de los seis recuadros de precio, de arriba abajo:

| Cámaras | DVR | Disco | Precio |
|---:|---:|---|---:|
| 2 | 4 canales | 500GB | Q1,150 |
| 4 | 4 canales | 500GB | Q1,680 |
| 6 | 8 canales | 1TB | Q2,790 |
| 8 | 8 canales | 1TB | Q3,350 |
| 10 | 16 canales | 1TB | Q4,290 |
| 16 | 16 canales | 1TB | Q5,850 |

Encabezado: «MIRA Y ESCUCHA 5MP HDCVI PLUS / NUEVOS COMBOS DE CAMARAS / AUDIO 5MP 30 Mts / Bidireccional de Luz nocturna». Cámara `DH-HAC-HFW1500RLN-IL-T` Lite 5MP. Todos incluyen 20 m de cable UTP por cámara, video balún, transformadores y conectores.

## Corrección aplicada

`Docs/modulo-precios/corregir_combos_documento_11.sql` describe la misma operación que se aplicó:

1. Se descartó el precio 65 (renglón incorrecto).
2. Se reutilizaron los seis productos combo (ids 51, 57, 58, 59, 60 y 61) y se crearon los precios 66–71 en `por_revisar`, vinculados al documento 11, con confianza 0.98 y `vigente_desde = 2026-11-25`.
3. Verificación posterior: `cola_revision` devuelve exactamente seis filas del documento 11 con Q1,150 / Q1,680 / Q2,790 / Q3,350 / Q4,290 / Q5,850. El precio 65 quedó `descartado`.

La aprobación sigue siendo manual: los seis renglones están listos en la bandeja de revisión.

## Reenvío del 25 de noviembre (documento 12)

El usuario volvió a subir la misma imagen. El documento `12` se procesó con `intentos = 1`, sin error, y volvió a generar **una sola fila** (`precio_id = 72`, Q5,850, nombre del primer combo, producto 62 con 16 cámaras en especificaciones). Es decir, la función desplegada sigue siendo la versión anterior: el código corregido existe en el repositorio pero **no ha sido desplegado**.

## Causa raíz adicional encontrada

Incluso con la segunda lectura, Gemini devuelve los seis combos con `modelo = "DH-HAC-HFW1500RLN-IL-T"`, `moneda = "Q"`, `tipo = "Kit de videovigilancia"`, `categoria = "Sistemas de Seguridad"` y `especificaciones` como texto. Como `upsert_producto` identifica el producto por `marca + modelo` (o por nombre si `modelo` es null), los seis combos habrían colapsado en un solo producto aunque se leyeran los seis renglones.

Se reforzó `supabase/functions/_shared/utils.ts`:

- `Q` → `GTQ`, `Kit/Combo/Paquete` → `promocion`, sinónimos de seguridad → `Cámaras de seguridad`, confianza `Alta/Media/Baja` → número.
- Especificaciones en texto se convierten en objeto (`camaras`, `dvr_canales`, `almacenamiento`).
- En combos se fuerza `modelo = null` para que la identidad use el nombre del paquete y no el modelo de la cámara.

Se validó con la respuesta real de Gemini: `normalizarItems` produce 6 items, todos `GTQ/promocion`, con modelo null y cantidades 2/4/6/8/10/16. Se añadieron pruebas en `utils_test.ts`.

## Despliegue y verificación final (autorizado por el usuario)

Se desplegó la función con:

```powershell
npx supabase functions deploy procesar-documento --project-ref llqnsdwfatvtmobbkekz --yes
```

Antes de reprocesar, la bandeja estaba vacía: ya no estaban los documentos 1–11 ni los precios 1–71 (el precio 72 del reenvío se había descartado). Se puso el documento 12 en `pendiente` y se invocó la función desplegada. Resultado:

- `documentos.estado = procesado`, `intentos = 2`, `modelo_ia = gemini-3.5-flash-lite`, sin error.
- `cola_revision` devolvió **seis filas** del documento 12, sin corrección manual: Q1,150 / Q1,680 / Q2,790 / Q3,350 / Q4,290 / Q5,850 (precios 73–78).
- Los seis productos son distintos (ids 98–103), con `modelo = null`, cantidades 2/4/6/8/10/16 y canales DVR 4/4/8/8/16/16. Ya no colapsan en el producto 62.

Los seis renglones quedan en `por_revisar` para aprobación manual. `deno` no está disponible en este entorno, así que no se ejecutaron `deno check`/`deno test`; la normalización se comprobó compilando `utils.ts` con `tsc` y ejecutando la respuesta real de Gemini con Node, además de la prueba end-to-end en producción.
