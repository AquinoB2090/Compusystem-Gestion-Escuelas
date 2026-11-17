# Fase 5: procesamiento de cotizaciones y margen de venta

Fecha: 17 de noviembre de 2026.

## Cálculo comercial acordado

Las cotizaciones contienen costo de compra. Administración configura un porcentaje global en Instalaciones → Precios → Proveedores y remitentes. El precio para ventas se calcula como `costo × (1 + margen / 100)`. Mientras el margen esté vacío, ventas ve los artículos pero no ve costo ni precio de venta. Administración conserva acceso al costo y al documento original.

## Cambios

- Se añadió la función `procesar-documento`: valida rol admin, reclama documentos pendientes, obtiene el archivo del bucket privado, analiza PDF/imágenes con Gemini, valida la respuesta y guarda precios en `por_revisar` mediante `upsert_producto`.
- Se añadió `whatsapp-webhook`: verifica Meta HMAC, acepta solo remitentes activos y PDF/JPEG/PNG/WebP hasta 15 MB, deduplica mensajes y deriva el documento al procesador.
- La subida manual y el reintento de documentos invocan el procesador.
- El nombre del modelo Gemini y las credenciales externas quedan vacíos en el ejemplo local. No se desplegaron las funciones ni se activó WhatsApp.
- Se añadió la migración `margen_global_produccion.sql` y el rollback seguro del margen `desactivar_margen_global.sql`.
- Producción recibió la migración de margen, tras generar los respaldos `respaldo_esquema_pre_margen_2026-11-17.sql` (58,352 bytes) y `respaldo_datos_pre_margen_2026-11-17.sql` (104,671 bytes) fuera del repositorio.

## Verificación de producción

- Huella de las tablas de las escuelas/clientes idéntica después de la migración.
- RLS deja en `precios` únicamente políticas de administración; también se quitaron las políticas de lectura de documentos y de objetos de Storage para staff.
- La configuración de margen inicia en `NULL`; funciones de inserción conservan ejecución solo para `service_role`.
- `panel_precios` e `historial_precios` están disponibles para `authenticated`; vistas marcadas `security_barrier` y `security_invoker=false` para permitir la salida filtrada segura sin exponer el costo subyacente.
- Prueba local simuló admin, ventas sin margen, ventas con margen y director. Ventas no pudo leer costos, tabla `documentos` ni objetos de Storage; el precio calculado con 15% sobre costo Q200 fue Q230. Todos los fixtures se revirtieron.

## Comprobaciones de código

- `deno test supabase/functions/_shared/utils_test.ts`: 5/5 aprobadas.
- `deno check` de utilidades y ambas funciones: aprobado.
- `npm run test:clientes`: 10/10 aprobadas.
- `npm run build`: se encontró un cierre JSX sobrante, preexistente, en `src/app/ui/Dashboard.tsx`; se corrigió en un commit separado y se volvió a ejecutar la compilación (resultado registrado en el cierre de la fase).

## Pendiente deliberado

El procesador necesita `GEMINI_API_KEY` y un `GEMINI_MODEL` vigente configurados como secretos de Supabase antes de desplegarlo. WhatsApp requiere conexión del número y variables de Meta antes de registrar el webhook. Ambos despliegues/activaciones quedan pendientes según el orden de la guía.

Ventas no tendrá precio de venta en producción hasta configurar el porcentaje global desde la pantalla de administración después de desplegar el cambio web.
