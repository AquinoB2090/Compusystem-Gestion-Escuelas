# Aceptación del módulo Instalaciones

Fecha: 17 de noviembre de 2026.

## Revisado

- Middleware y guardas del servidor: admin/ventas pueden entrar a `/instalaciones`; ventas queda limitado a `/instalaciones` y `/instalaciones/precios`; admin es requisito para revisión, documentos y proveedores; director/cliente son redirigidos fuera del módulo. Ventas se dirige a Instalaciones después del login.
- Búsqueda estática de imports bajo `src/app/instalaciones`: no se encontraron imports de las pantallas o carpetas de escuelas/clientes.
- Consulta de solo lectura a producción: 0 llaves foráneas desde tablas del módulo hacia escuelas, maestros, cheques, asignaciones, consumos, tablas de clientes y saldos; 0 tablas base del módulo sin RLS; 0 políticas de lectura staff restantes en precios/documentos/configuración.
- Las vistas `panel_precios` e `historial_precios` son seleccionables por authenticated. `upsert_producto` no es ejecutable por anon ni authenticated y sí por service_role.
- La huella de las tablas existentes de escuelas/clientes permaneció idéntica tras la migración.
- `npm run build`, `npm run test:clientes` (10/10), `deno test` (5/5) y `deno check` pasaron.

Tres llaves foráneas del módulo apuntan a `perfiles` para auditoría y autoría (`documentos`, `precios` y `configuracion_instalaciones`); ninguna se dirige a las tablas de escuelas o clientes.

## Pendiente para cerrar aceptación end-to-end

La guía prohíbe desplegar las Edge Functions en esta fase. Por eso falta validar una cotización real desde la IA y probar la entrega real de WhatsApp. El procesamiento requiere que administración configure `GEMINI_API_KEY` y el nombre vigente de `GEMINI_MODEL`; WhatsApp requiere conectar el número y configurar las credenciales de Meta. No se activó ni desplegó ninguno.

Los commits locales no han sido desplegados en Vercel. El porcentaje global de margen sigue `NULL` en producción; se debe definir cuando la nueva interfaz se encuentre desplegada. Hasta que eso ocurra, ventas no recibe precios de venta.
