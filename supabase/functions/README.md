# Edge Functions de Instalaciones

Las dos funciones procesan únicamente documentos del bucket privado `documentos-precios` y guardan los precios como `por_revisar`. La aprobación sigue siendo manual desde `/instalaciones/precios/revision`.

## Procesamiento manual

`procesar-documento` requiere un JWT de administración cuando se invoca desde el panel. La llamada interna del webhook usa la clave secreta del proyecto. La función usa `GEMINI_API_KEY` y `GEMINI_MODEL`; el valor del modelo se deja vacío en `.env.example` para que se configure con el nombre vigente elegido por administración.

## WhatsApp

`whatsapp-webhook` verifica `x-hub-signature-256`, solo guarda medios de remitentes activos en `public.remitentes`, acepta PDF/JPEG/PNG/WebP hasta 15 MB y deduplica por `wa_message_id`. La configuración tiene `verify_jwt = false` para que Meta pueda entregar el webhook; el endpoint valida la firma con `META_APP_SECRET`.

La función está escrita pero no se despliega ni se activa en esta fase. Primero hay que conectar el número en WhatsApp Business, definir `WHATSAPP_VERIFY_TOKEN`, `META_APP_SECRET`, `META_ACCESS_TOKEN` y `META_GRAPH_API_VERSION`, y registrar la URL del webhook en Meta.

## Variables

Para desarrollo local, copia `.env.example` a `.env` en esta carpeta y completa solo las credenciales que ya tengas. No guardes `.env` en Git. `GEMINI_MODEL` y los valores de WhatsApp se mantienen vacíos en el repositorio.

## Comandos de desarrollo y despliegue

Desde la raíz del repositorio:

```powershell
deno check supabase/functions/_shared/utils.ts supabase/functions/procesar-documento/index.ts supabase/functions/whatsapp-webhook/index.ts
deno test supabase/functions/_shared/utils_test.ts
npx supabase@3.2.0 functions serve procesar-documento --env-file supabase/functions/.env
npx supabase@3.2.0 functions serve whatsapp-webhook --env-file supabase/functions/.env
```

Despliegue futuro, cuando se hayan guardado los secretos:

```powershell
npx supabase@3.2.0 functions deploy procesar-documento
npx supabase@3.2.0 functions deploy whatsapp-webhook
```

No despliegues ni registres el webhook mientras el número no esté conectado y verificado.
