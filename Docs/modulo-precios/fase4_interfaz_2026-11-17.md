# Fase 4: interfaz del módulo Instalaciones

Fecha: 2026-11-17

## Implementado

- Se creó `/instalaciones` con dashboard propio, navegación, paleta independiente e indicadores por rol.
- Se protegieron las rutas en middleware y en el servidor: `ventas` entra directamente a Instalaciones y solo puede abrir el resumen y Precios; `admin` puede abrir todas las secciones. `director` y `cliente` vuelven a su inicio.
- Se agregó la creación de usuarios con rol `ventas` al flujo administrativo.
- `/instalaciones/precios` consulta `panel_precios`, permite buscar y filtrar, presenta etiquetas de precio/promoción/vigencia/IVA, abre historial y genera enlaces firmados al documento original.
- Revisión permite aprobar, corregir y aprobar, descartar y aprobar en lote solo los elementos seleccionados. Los registros con confianza menor a 0.8 se resaltan.
- Documentos muestra su estado, permite reintentar los que fallaron y subir PDF/JPG/PNG/WebP de hasta 15 MB al bucket privado.
- Proveedores y remitentes permiten crear, editar y desactivar; no se implementó borrado.
- Las consultas desde el navegador usan la sesión del usuario; no se usa `service_role` en los componentes.

## Commits

- `459b367` feat: add protected installations workspace and price catalog
- `7debde9` feat: add price approval review flow
- `c58d30c` feat: add installation documents inbox and upload
- `65990c5` feat: add provider and sender management
- `343b09c` fix: show supplier in price history

## Alcance pendiente y verificación

- No se ejecutó ni se desplegó código contra producción en esta fase.
- El repositorio aún no contiene `supabase/functions/procesar-documento` ni `whatsapp-webhook`. La subida registra el archivo y crea el documento en estado `pendiente`; extracción con IA y paso automático a revisión dependen de la Fase 5.
- No se ejecutó la suite de pruebas ni una prueba de extremo a extremo con Supabase/Storage reales en esta fase.
- Los archivos de guía y migración que ya estaban sin seguimiento se dejaron fuera de estos commits.
