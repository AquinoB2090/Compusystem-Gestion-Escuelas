# Registro de corrección de permisos en producción

Fecha: 2026-11-17  
Proyecto: producción enlazada de Compusystem  
Cambio aplicado: `correccion_permisos.sql` (solo permisos RLS/Storage y ACL de función)

## Respaldo previo

Se generaron ambos volcados antes del cambio y quedaron fuera del repositorio:

- `D:\respaldo-seguro\respaldo_esquema_pre_permisos_2026-11-17.sql` — 58,184 bytes.
- `D:\respaldo-seguro\respaldo_datos_pre_permisos_2026-11-17.sql` — 104,080 bytes.

## Ejecución y verificaciones

- El SQL correctivo terminó en producción sin errores.
- `upsert_producto(...)`: ejecución denegada a `anon` y `authenticated`; permitida a `service_role`.
- `documentos`: `staff_select` queda limitado a documentos que tienen un precio aprobado; administración conserva sus políticas.
- `storage.objects`: administración puede leer el bucket privado y subir archivos; staff solo puede leer archivos asociados con precios aprobados.
- Huella de las 11 tablas de escuelas/clientes: conteos y hashes idénticos inmediatamente antes y después del cambio. Las consultas de huella se guardaron fuera del repositorio en `D:\respaldo-seguro\huella_pre_permisos_2026-11-17.txt` y `D:\respaldo-seguro\huella_post_permisos_2026-11-17.txt`.

No se ejecutó la migración inicial ni el rollback, y no se modificaron filas de negocio.
