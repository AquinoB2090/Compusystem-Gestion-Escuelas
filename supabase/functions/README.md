# Edge Functions de Instalaciones

Las dos funciones procesan únicamente documentos del bucket privado `documentos-precios` y guardan los precios como `por_revisar`. La aprobación sigue siendo manual desde `/instalaciones/precios/revision`.

## Procesamiento manual

`procesar-documento` requiere un JWT de administración cuando se invoca desde el panel. La llamada interna del webhook usa la clave secreta del proyecto. La función usa `GEMINI_API_KEY` y `GEMINI_MODEL`.

La invocación responde `202` de inmediato y el análisis continúa en segundo plano (`EdgeRuntime.waitUntil`). La bandeja de documentos sondea el estado cada 5 segundos; no hace falta esperar a que Gemini termine. `procesando_desde` registra el inicio del intento para no confundir documentos antiguos con trabajos actuales. Si el worker se apaga, la siguiente invocación libera intentos que llevan más de 10 minutos.

### GEMINI_MODEL

El valor se deja vacío en `.env.example` porque los nombres vigentes deben copiarse de la documentación de Google. Se puede configurar **uno o varios** modelos separados por comas; el orden define la prioridad:

```powershell
npx supabase@3.2.0 secrets set GEMINI_API_KEY="..." GEMINI_MODEL="gemini-3.8-flash" GEMINI_THINKING_LEVEL="LOW"
```

`gemini-3.8-flash` es válido y acepta PDF, pero piensa en nivel `medium` por defecto. Para extraer precios ese razonamiento no aporta y solo aumenta latencia y presión sobre el modelo, por eso la función envía `thinkingConfig.thinkingLevel = LOW` de forma predeterminada. `MINIMAL` **no** es compatible con `gemini-3.8-flash`; si se configura, Gemini responderá `400`.

La función reintenta `429` y `5xx` con espera exponencial, respeta `Retry-After` y `retryDelay` de Gemini y pasa al siguiente modelo si la saturación persiste. Si no defines `GEMINI_FALLBACK_MODELS`, agrega `gemini-3.5-flash-lite` y `gemini-3.6-flash` después del modelo principal. Ambos figuran como estables en la lista oficial de Google. El presupuesto total por documento es de ~95s, por debajo del límite de 150s de una Edge Function en el plan free.

## WhatsApp

`whatsapp-webhook` verifica `x-hub-signature-256`, acepta documentos PDF/JPEG/PNG/WebP de cualquier número hasta 150 MB y deduplica por `wa_message_id`. Las filas existentes en `public.remitentes` solo sirven para sugerir un proveedor; no filtran quién puede enviar. La configuración tiene `verify_jwt = false` para que Meta pueda entregar el webhook; el endpoint valida la firma con `META_APP_SECRET`.

La función está escrita pero no se despliega ni se activa en esta fase. Primero hay que conectar el número en WhatsApp Business, definir `WHATSAPP_VERIFY_TOKEN`, `META_APP_SECRET`, `META_ACCESS_TOKEN` y `META_GRAPH_API_VERSION`, y registrar la URL del webhook en Meta.

## Variables

Para desarrollo local, copia `.env.example` a `.env` en esta carpeta y completa solo las credenciales que ya tengas. No guardes `.env` en Git. `GEMINI_MODEL` y los valores de WhatsApp se mantienen vacíos en el repositorio.

## Comandos de desarrollo y despliegue

Desde la raíz del repositorio:

```powershell
deno check supabase/functions/_shared/utils.ts supabase/functions/_shared/gemini.ts supabase/functions/procesar-documento/index.ts supabase/functions/whatsapp-webhook/index.ts
deno test supabase/functions/_shared/
npx supabase@3.2.0 functions serve procesar-documento --env-file supabase/functions/.env
npx supabase@3.2.0 functions serve whatsapp-webhook --env-file supabase/functions/.env
```

Despliegue futuro, cuando se hayan guardado los secretos:

```powershell
npx supabase@3.2.0 functions deploy procesar-documento
npx supabase@3.2.0 functions deploy whatsapp-webhook
```

No despliegues ni registres el webhook mientras el número no esté conectado y verificado.

## Diagnóstico rápido

| Síntoma | Causa probable | Acción |
| --- | --- | --- |
| `Configura GEMINI_API_KEY y GEMINI_MODEL` | Falta alguno de los secretos | Guardar ambos secretos y redesplegar la función |
| `HTTP 503: high demand` | Modelo saturado u obsoleto | Cambiar a un modelo vigente y agregar alternativas separadas por comas |
| `HTTP 400/401/403` | Clave inválida, sin permisos o solicitud mal formada | Revisar la clave y el nombre del modelo |
| Estado `procesando` por más de 10 minutos | El worker se apagó | Pulsar «Reintentar» en la bandeja; la siguiente invocación también lo libera |
| `No se encontraron precios válidos` | Gemini no extrajo importes | Revisar el original con «Ver original» y volver a subir una copia legible |
