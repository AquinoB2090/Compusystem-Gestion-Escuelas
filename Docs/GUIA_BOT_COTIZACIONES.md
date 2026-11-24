# Guía del bot de cotizaciones

## Objetivo

Agregar a Instalaciones un asistente que convierta solicitudes en borradores de cotización y permita descargarlos como Word. El canal es el panel web. WhatsApp y Meta quedan fuera de este alcance.

## Reglas del negocio

- Usar únicamente productos con precio de venta vigente, aprobado y visible en `panel_precios`.
- No agregar IVA. El total es la suma de cantidad por precio de venta.
- No mostrar costos de compra al bot ni al documento.
- Gemini interpreta la solicitud y pregunta cuando falten datos o la coincidencia no sea clara.
- Si el cliente menciona alternativas, el bot incluye todas en el borrador, sin pedir que elija una. Cada opción tiene su subtotal y total independientes; nunca se suman productos que sean alternativas entre sí.
- Cuando no se indica cantidad, se prepara una unidad de cada producto y se informa en el mensaje para que la cantidad pueda corregirse.
- La aplicación valida los IDs devueltos contra los productos consultados y calcula los montos; Gemini nunca devuelve precios autoritativos.
- El usuario revisa los renglones antes de descargar el Word.
- Los productos reconocidos permanecen en el borrador mientras el asistente pregunta datos faltantes; se pueden agregar más productos desde tarjetas del catálogo.
- Los datos de empresa, términos, contacto, validez y numeración final quedan pendientes hasta que el usuario los proporcione.

## Arquitectura

1. El panel de Instalaciones muestra **Cotizaciones** a los roles `admin` y `ventas`.
2. Un componente de chat envía la conversación a la Edge Function `cotizar` con la sesión del usuario.
3. La función valida el usuario activo y su rol, consulta el catálogo mediante RLS y solicita a Gemini una interpretación estructurada.
4. La función conserva únicamente productos de la consulta y toma de la base el precio y la descripción. Rechaza cantidades inválidas.
5. El panel presenta el borrador editable y genera un `.docx` localmente en el navegador.

No se requiere vectorizar los precios al inicio: son registros estructurados y el catálogo puede consultarse directamente. Se puede añadir búsqueda semántica si luego hace falta para catálogos mucho mayores o descripciones complejas.

## Etapas de implementación

- [x] Documentar alcance, arquitectura y guardrails.
- [x] Añadir la Edge Function `cotizar` y conectarla con Gemini.
- [x] Añadir la pantalla de chat y el borrador editable en Instalaciones.
- [x] Añadir la exportación Word con los campos ya acordados, sin IVA.
- [x] Añadir tarjetas de productos para agregarlos directamente al borrador y permitir descargar renglones reconocidos aunque haya preguntas pendientes.
- [x] Presentar todas las alternativas mencionadas en una sola cotización Word, con totales separados por opción.
- [x] Configurar los secretos de Gemini en Supabase y desplegar la función cuando el usuario lo indique. `cotizar` quedó activa en producción el 2026-11-24 (versión 3; alternativas y cálculo de renglones corregido).
- [ ] Revisar solicitudes ambiguas, precios vencidos, cantidades inválidas, intentos de pedir precios inexistentes, alternativas con total independiente y usuarios sin rol autorizado.
- [ ] Incorporar los datos comerciales restantes cuando los proporcione el usuario.

## Formato inicial del Word

Tomará como referencia el orden del PDF proporcionado: encabezado de cotización, fecha, destinatario, detalle con descripción/cantidad/precio unitario/total y total final. No copiará la identidad, direcciones ni términos del proveedor que aparece en el PDF. No tendrá IVA.

## Configuración y despliegue

La Edge Function requiere `GEMINI_API_KEY` y el mismo `GEMINI_MODEL`/`GEMINI_FALLBACK_MODELS` que el procesamiento de documentos. Los secretos se configuran en Supabase; no se ponen en el cliente, en el repositorio ni en variables `NEXT_PUBLIC_*`. Despliegue previsto, cuando se autorice:

```powershell
supabase functions deploy cotizar --no-verify-jwt
```

La función valida el JWT y el perfil internamente. No aplicar cambios directamente a producción desde el repositorio; primero desplegar y verificar la función de acuerdo con el flujo operativo del proyecto.

## Pendientes

- Razón social y datos de contacto/dirección que deben aparecer en Word.
- Términos de pago y vigencia de la oferta.
- Numeración consecutiva y almacenamiento/consulta de cotizaciones anteriores.
- Logotipo de Compusystem que se usará en el documento.
