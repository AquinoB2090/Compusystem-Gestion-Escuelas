# Instrucciones para Codex: agregar el módulo de precios a un sistema que YA está en producción

> **Cómo usar este documento:** cópialo a la raíz del repositorio (o a `docs/`), copia también los archivos de la sección 3, y dile a Codex:
>
> *"Lee `GUIA_CODEX_MODULO_PRECIOS.md` completo y síguelo fase por fase. Empieza por la Fase 0 y detente al terminar cada fase para mostrarme el resultado. No ejecutes nada contra producción."*

---

## 1. Contexto

- Es el sistema interno de una librería en Guatemala (empresa **Compusystem**), con **Supabase (PostgreSQL + Auth + Storage)**, **Next.js** y despliegue en **Vercel**. Costo objetivo: Q0, usando planes gratuitos.
- **Ya está en producción con datos reales.** Lleva los saldos de fotocopias por maestro y escuela. Tablas existentes en `public`:
  `Compusystem`, `escuelas`, `maestros`, `perfiles`, `cheques`, `asignaciones`, `consumos`, `ajustes_saldo`, `clientes_individuales`, `consumos_clientes`, `liquidaciones_clientes`.
- `perfiles` tiene los roles **`admin`**, **`director`** (ve solo su escuela) y **`cliente`** (cliente individual). El login usa un campo **`usuario`** (columna `perfiles.usuario`, obligatoria). Respeta ese patrón.
- Los directores y clientes **nunca** deben ver el módulo nuevo.
- Hay Row Level Security en la base. Probablemente existen funciones, políticas y vistas que **no aparecen** en el volcado de tablas: la Fase 0 sirve para descubrirlas.
- Nota: en el volcado, `consumos.periodo` aparece como `DEFAULT (...)`, pero casi seguro es una columna generada. **No restaures la base de pruebas desde ese volcado de texto**, usa un volcado real hecho con la CLI (Fase 1).

## 2. Qué se va a construir

Un módulo para cotizaciones de **cámaras de seguridad y aires acondicionados** (otro servicio de la empresa). Todas las cotizaciones llegan por WhatsApp (PDF e imágenes), siempre desde **un solo número**.

```
WhatsApp / subida manual → Storage + tabla `documentos` → IA lee el archivo
→ `precios` en estado "por_revisar" → el admin aprueba → panel de consulta (`panel_precios`)
```

Se construye en este orden: **base de datos → subida manual y revisión → panel de consulta → WhatsApp (al final, y solo si el usuario lo pide)**.

**Es una "app dentro de la app":** el módulo de instalaciones es una sección **completamente separada** de la información de escuelas y de clientes individuales. Comparte el mismo proyecto de Supabase, el mismo login y el mismo despliegue, pero **no comparte datos, pantallas ni consultas** con esas partes. Más adelante se le agregarán otras funciones de instalaciones (trabajos, clientes de instalación, etc.), por eso la sección se llama **Instalaciones** y los precios son solo su primera parte.

## 3. Archivos que recibes

Cópialos al repositorio, por ejemplo en `docs/modulo-precios/` (la guía de este documento no los reescribe, los usa):

| Archivo | Para qué |
|---|---|
| `modulo_precios_produccion.sql` | **La migración.** Solo crea objetos nuevos, en una transacción. Ya probada en una copia local de este esquema con datos de ejemplo. |
| `modulo_precios_rollback.sql` | Deshace solo lo que creó la migración. |
| `GUIA_MODULO_PRECIOS.md` | Diseño completo del módulo (flujo, tablas, pantallas, seguridad). Léela para entender el porqué. |
| `functions/_shared/utils.ts` | Validaciones (firma de Meta, limpieza de lo que devuelve la IA). |
| `functions/procesar-documento/index.ts` | Lee el documento con IA y guarda los precios. |
| `functions/whatsapp-webhook/index.ts` | Recibe mensajes de WhatsApp. **No lo despliegues todavía.** |

> **No uses** `modulo_precios.sql` ni `base_de_datos.sql` si aparecen: son versiones para una base nueva y vacía. En producción solo vale `modulo_precios_produccion.sql`.

## 4. Reglas innegociables

1. **Prohibido tocar producción por tu cuenta.** No tienes credenciales de producción y no las pidas. La migración la ejecuta el usuario en el SQL Editor de Supabase, después de las fases 1 y 2.
2. **Prohibido** `supabase db reset`, `supabase db push`, `supabase migration up` contra un proyecto enlazado, `drop`, `truncate`, y `delete`/`update` sin `where` sobre tablas existentes. Ejecuta comandos de base de datos **solo** contra la copia local.
3. **No modifiques** tablas, columnas, políticas, funciones, vistas ni datos existentes. La única excepción es el `CHECK` de `perfiles.rol`, que la migración ya maneja (agrega `ventas` y conserva `admin`, `director` y `cliente`).
4. **No cambies el comportamiento actual** de los roles `admin`, `director` y `cliente`, ni de ninguna pantalla existente. Si una pantalla existente necesita tocarse (por ejemplo, el menú), el cambio debe ser mínimo y aditivo.
5. **Secretos:** nunca los pongas en el repositorio. `SUPABASE_SERVICE_ROLE_KEY`, la clave de la IA y los tokens de Meta solo existen como *secrets* de Supabase o variables de entorno **sin** prefijo `NEXT_PUBLIC_`. Los volcados de la base contienen datos reales: agrégalos a `.gitignore` y no los subas.
6. **Sigue las convenciones del repositorio** (estructura de carpetas, cliente de Supabase, manejo de sesión, componentes, estilos, idioma de la interfaz: español). No introduzcas librerías nuevas si el repositorio ya resuelve eso.
7. **Si algo no cuadra con lo que dice esta guía, detente y pregunta.** No improvises sobre una base con datos reales.
8. **No inventes** nombres de modelos de IA ni versiones de API. Si necesitas uno, pregúntaselo al usuario o déjalo como variable de entorno.
9. **Separación total entre Instalaciones y Escuelas/Clientes.**
   - Ninguna tabla del módulo de instalaciones tiene llave foránea hacia `escuelas`, `maestros`, `cheques`, `asignaciones`, `consumos`, `ajustes_saldo`, `clientes_individuales`, `consumos_clientes` ni `liquidaciones_clientes`. Solo se relacionan con `perfiles` (quién hizo qué).
   - Ninguna pantalla, consulta ni componente de Instalaciones lee esas tablas, ni al revés.
   - Si más adelante se agregan clientes o trabajos de instalación, van en **tablas nuevas** del módulo (por ejemplo `clientes_instalacion`). **No reutilices** `clientes_individuales`, que es de fotocopias.
   - Los componentes y funciones compartidos se limitan a lo genérico (botones, tablas, formato de moneda, cliente de Supabase).
10. **Aislamiento verificable.** Quien tiene acceso solo a Instalaciones (`ventas`) no debe poder leer nada de escuelas ni de clientes por la API; quien tiene acceso solo a escuelas o clientes (`director`, `cliente`) no debe poder leer nada de Instalaciones. Se comprueba con pruebas (Fase 2) y no solo ocultando menús.

## 5. Fase 0: reconocimiento (solo lectura)

### 5.1 Repositorio
Reporta, sin cambiar nada:
- Versión de Next.js y si usa App Router o Pages Router; TypeScript o JavaScript.
- Dónde se crea el cliente de Supabase (navegador, servidor, middleware) y cómo se obtiene la sesión.
- **Cómo funciona el login por `usuario`** y cómo se lee el rol después. Dónde está la redirección por rol.
- Dónde están el menú de navegación y el layout.
- Librería de UI, sistema de estilos y componentes de tabla/formulario ya existentes.
- Si hay tipos de base de datos generados (`database.types.ts`) y cómo se generan.
- Pruebas existentes y cómo se ejecutan.
- Cómo se crean hoy los usuarios nuevos (director, cliente): hay que reutilizar ese flujo para el rol `ventas`.

### 5.2 Base de datos real
Pídele al usuario que ejecute **estas consultas en el SQL Editor de Supabase** (son de solo lectura) y te pegue los resultados. **Guárdalos** como `docs/modulo-precios/inspeccion_produccion.txt` (sin datos personales).

```sql
-- 1) CHOQUES DE NOMBRES (antes de migrar debe devolver 0 filas)
select 'tabla o vista' as tipo, c.relname as nombre
from pg_class c
where c.relnamespace = 'public'::regnamespace
  and c.relkind in ('r','v','m','p')
  and c.relname in ('categorias','proveedores','remitentes','documentos','productos','precios',
                    'panel_precios','cola_revision','precios_vigentes')
union all
select 'función', p.proname
from pg_proc p
where p.pronamespace = 'public'::regnamespace
  and p.proname in ('mp_es_admin','mp_es_staff','mp_hoy','upsert_producto','marcar_aprobacion');

-- 2) CHECKs de perfiles (debe haber UNO que mencione rol y 'admin')
select conname, pg_get_constraintdef(oid) as definicion
from pg_constraint
where conrelid = 'public.perfiles'::regclass and contype = 'c';

-- 3) Funciones que ya existen en public
select p.proname as funcion, pg_get_function_identity_arguments(p.oid) as argumentos, p.prosecdef as security_definer
from pg_proc p where p.pronamespace = 'public'::regnamespace order by 1;

-- 4) Vistas existentes
select viewname, definition from pg_views where schemaname = 'public' order by 1;

-- 5) Políticas RLS de public y de storage
select schemaname, tablename, policyname, cmd, roles, qual, with_check
from pg_policies where schemaname in ('public', 'storage') order by 1, 2, 3;

-- 6) ¿Qué tablas de public tienen RLS activado?
select c.relname, c.relrowsecurity as rls_activo
from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' order by 1;

-- 7) Triggers existentes
select event_object_table as tabla, trigger_name, action_timing, event_manipulation
from information_schema.triggers where trigger_schema = 'public' order by 1, 2;

-- 8) Buckets de Storage
select id, name, public from storage.buckets;
```

### 5.3 Qué revisar en los resultados (y cuándo detenerte)

| Hallazgo | Qué hacer |
|---|---|
| La consulta 1 devuelve filas | **Detente.** Hay objetos con los mismos nombres. Reporta cuáles y propón renombrar en la migración (por ejemplo, el prefijo `pm_` en las tablas). No apliques nada. |
| La consulta 2 muestra más de un CHECK que mencione rol y `'admin'`, o ninguno | **Detente** y reporta. La migración se detiene sola si hay más de uno. |
| Alguna política de `storage.objects` **sin** filtro por `bucket_id` y abierta a `authenticated` | **Riesgo:** esa política dejaría abierto el bucket privado nuevo a cualquier usuario autenticado (directores y clientes incluidos). Reporta y propón cerrarla o acotarla por `bucket_id` **antes** de crear el bucket. No la modifiques tú. |
| Alguna tabla de escuelas o clientes (`escuelas`, `maestros`, `cheques`, `asignaciones`, `consumos`, `ajustes_saldo`, `clientes_individuales`, `consumos_clientes`, `liquidaciones_clientes`, `perfiles`) **sin RLS**, o con una política abierta a todo usuario autenticado | **Bloqueante para el aislamiento.** Un usuario `ventas` inicia sesión como cualquier usuario autenticado, y sin RLS (o con política abierta) podría leer esas tablas por la API. Reporta y **no crees usuarios `ventas`** hasta que el usuario cierre eso. No cambies las políticas tú: propón el SQL y espera su aprobación. |
| Otras tablas de `public` sin RLS | Repórtalo aparte. No es parte de este trabajo, pero el usuario debe saberlo. |
| La consulta 3 incluye `es_admin`, `mi_escuela` u otras | Está bien. El módulo usa sus **propias** funciones con prefijo `mp_` precisamente para no pisarlas. Solo confirma que ninguna se llame `mp_*`. |

**Entregable de la Fase 0:** un resumen corto con los hallazgos del repositorio y de la base, y la lista de decisiones o riesgos. **Detente y espera confirmación.**

## 6. Fase 1: respaldo y copia de pruebas

> El plan gratuito de Supabase **no garantiza respaldos descargables**. Sin este paso no se migra.

### 6.1 Respaldo de producción (lo hace el usuario)
Con la CLI de Supabase enlazada al proyecto (verifica las opciones con `supabase db dump --help`):

```bash
supabase db dump -f respaldo_esquema.sql
supabase db dump --data-only -f respaldo_datos.sql
```
Alternativa con `pg_dump` y la cadena de conexión que muestra el botón **Connect** del panel de Supabase. Guarda los archivos **fuera del repositorio** (o ignorados por git) y una copia en otro lugar (por ejemplo, Google Drive). Contienen datos reales.

### 6.2 Copia local para probar (lo haces tú)
1. Levanta una base local que ya traiga los esquemas `auth` y `storage` (por ejemplo, `supabase start`, que usa Docker; si el repositorio ya tiene `supabase/config.toml`, úsalo).
2. Restaura `respaldo_esquema.sql` y luego `respaldo_datos.sql` **solo en la base local**.
3. Si la carga de `perfiles` falla por la llave foránea hacia `auth.users` (el volcado no incluye usuarios de `auth`), inserta usuarios de relleno en `auth.users` con los mismos `id` de `perfiles`, o carga con `set session_replication_role = replica;` en la sesión local.
4. Comprueba que hay datos: conteos de cada tabla.

### 6.3 Huella de los datos (antes y después)
Esta consulta devuelve, por tabla, el número de filas y un hash de todo su contenido. Se ejecuta **antes** y **después** de migrar, y el resultado debe ser **idéntico**. Si el esquema real tiene más tablas que estas, agrégalas.

```sql
select t, n, h from (
select 'Compusystem' t, count(*) n, md5(coalesce(string_agg(x::text,'|' order by x.id),'')) h from public."Compusystem" x union all
select 'escuelas', count(*), md5(coalesce(string_agg(x::text,'|' order by x.id),'')) from public.escuelas x union all
select 'maestros', count(*), md5(coalesce(string_agg(x::text,'|' order by x.id),'')) from public.maestros x union all
select 'perfiles', count(*), md5(coalesce(string_agg(x::text,'|' order by x.id),'')) from public.perfiles x union all
select 'cheques', count(*), md5(coalesce(string_agg(x::text,'|' order by x.id),'')) from public.cheques x union all
select 'asignaciones', count(*), md5(coalesce(string_agg(x::text,'|' order by x.id),'')) from public.asignaciones x union all
select 'consumos', count(*), md5(coalesce(string_agg(x::text,'|' order by x.id),'')) from public.consumos x union all
select 'ajustes_saldo', count(*), md5(coalesce(string_agg(x::text,'|' order by x.id),'')) from public.ajustes_saldo x union all
select 'clientes_individuales', count(*), md5(coalesce(string_agg(x::text,'|' order by x.id),'')) from public.clientes_individuales x union all
select 'consumos_clientes', count(*), md5(coalesce(string_agg(x::text,'|' order by x.id),'')) from public.consumos_clientes x union all
select 'liquidaciones_clientes', count(*), md5(coalesce(string_agg(x::text,'|' order by x.id),'')) from public.liquidaciones_clientes x
) s order by t;
```

**Entregable de la Fase 1:** confirmación de que existe el respaldo (nombre y tamaño del archivo, sin su contenido), que la copia local tiene datos, y la huella "antes" guardada.

## 7. Fase 2: migración en la copia local

1. Ejecuta `modulo_precios_produccion.sql` **en la copia local**. Debe terminar sin errores.
2. Ejecuta la huella otra vez. **Debe ser idéntica** a la de antes. Si cambia una sola fila, detente.
3. Verifica que las funciones y vistas que ya existían siguen **idénticas** (compara `pg_get_functiondef` antes y después).
4. Verifica el `CHECK` de roles: `select pg_get_constraintdef(oid) from pg_constraint where conname = 'perfiles_rol_check';` debe incluir `admin`, `director`, `cliente` y `ventas`.
5. **Pruebas de permisos** (simula la sesión con `set role authenticated; set request.jwt.claim.sub = '<uuid>';` o con usuarios reales de la copia). Crea un perfil `ventas` de prueba y comprueba:

| Usuario | Debe poder | No debe poder |
|---|---|---|
| `admin` | Todo el módulo: ver, crear, aprobar, subir archivos | Borrar (no hay política de delete) |
| `ventas` | Leer `panel_precios` y precios aprobados | Ver `cola_revision`, `remitentes`, escribir en cualquier tabla del módulo |
| `director` | Seguir viendo solo lo suyo | Ver o consultar **cualquier** cosa del módulo |
| `cliente` | Seguir viendo solo lo suyo | Ver o consultar **cualquier** cosa del módulo |
| `ventas` (aislamiento) | Leer su propio perfil | Leer o escribir **cualquier** fila de `escuelas`, `maestros`, `cheques`, `asignaciones`, `consumos`, `ajustes_saldo`, `clientes_individuales`, `consumos_clientes`, `liquidaciones_clientes` ni los perfiles de otros. Cada `select count(*)` debe dar 0. **Pruébalo contra las políticas reales de la copia**, no con datos de relleno. |
| cualquiera | | Ejecutar `upsert_producto` (solo `service_role`) |

6. Prueba el **rollback** (`modulo_precios_rollback.sql`): la huella debe seguir idéntica y los objetos del módulo desaparecer. Luego vuelve a aplicar la migración.
7. Prueba la **doble ejecución**: la segunda debe fallar y no cambiar nada.

**Entregable de la Fase 2:** resultados de todas las verificaciones. **Detente.** El usuario decide cuándo migrar producción.

## 8. Fase 3: producción (solo cuando el usuario lo ordene)

Esto lo ejecuta el usuario, no Codex. Entrégale este procedimiento:

1. Elegir un momento sin uso del sistema (la migración toma un bloqueo muy breve sobre `perfiles`).
2. Hacer un respaldo **nuevo** (6.1) y ejecutar la huella en producción. Guardar el resultado.
3. SQL Editor → pegar `modulo_precios_produccion.sql` → **Run**.
4. Ejecutar la huella otra vez y compararla. Debe ser idéntica.
5. Entrar con un usuario `admin`, uno `director` y uno `cliente` y confirmar que el sistema de fotocopias se comporta igual que antes.
6. Si algo no cuadra: `modulo_precios_rollback.sql` (primero vaciar el bucket desde el panel de Storage).

## 9. Fase 4: pantallas (Next.js)

Hazla en una rama o carpeta propia, sin tocar las pantallas actuales salvo el menú. Todo en español. Fechas en `es-GT`; montos con `Intl.NumberFormat('es-GT', { style: 'currency', currency: 'GTQ' })` (y `USD` donde corresponda).

### 9.0 Estructura: una app nueva dentro de la app
- Toda la sección vive bajo **`/instalaciones`**, con su **propio layout** (encabezado, navegación lateral o superior y título "Instalaciones"), distinto del de Escuelas/Clientes. Si el repositorio usa App Router, usa un grupo de rutas y un `layout.tsx` propio para `/instalaciones`.
- Menú interno de Instalaciones: **Precios** (consulta), **Revisión** (solo admin), **Documentos** (solo admin), **Proveedores** (solo admin). Debe quedar espacio para futuras secciones sin reestructurar.
- Inicio `/instalaciones`: resumen simple con (a) precios por revisar, (b) documentos con error, (c) promociones que vencen en 7 días o menos. Para `ventas`, solo (c) y un acceso directo a **Precios**.
- **Cambio de módulo:** un selector visible solo para quien tiene acceso a ambos (hoy, solo `admin`): "Escuelas y clientes" ↔ "Instalaciones". Quien tiene acceso a uno solo no ve selector y entra directo a su sección.
- Código organizado en carpetas propias del módulo (por ejemplo `.../instalaciones/` para rutas, componentes y acceso a datos), sin importar nada de las carpetas de escuelas o clientes.
- El menú o encabezado del sistema actual solo recibe un cambio mínimo: el selector de módulo para `admin`.

### 9.1 Acceso y roles
- Rutas nuevas bajo `/instalaciones/precios`. Se permiten solo a `admin` y `ventas`.
- `ventas` puede ver únicamente `/instalaciones/precios`. `admin` ve todas las subrutas.
- `director` y `cliente` que entren a la URL deben ser redirigidos a su inicio. Haz la verificación **en el servidor** (middleware y/o en cada página), no solo ocultando el menú. La base de datos ya les niega los datos, esto es una segunda capa.
- Agrega `ventas` a la redirección por rol del login (tras iniciar sesión, va a `/instalaciones`). `admin` conserva su inicio actual y cambia de módulo con el selector.
- Las rutas de Instalaciones **no** son accesibles para `director` ni `cliente`; y las de escuelas/clientes **no** lo son para `ventas`. Verifica ambos sentidos en el servidor.
- Extiende el flujo de creación de usuarios existente para permitir el rol `ventas`. Recuerda que `perfiles.usuario` es obligatorio.
- Agrega "Precios" al menú solo para `admin` y `ventas`.

### 9.2 `/instalaciones/precios` (admin y ventas): consulta
- Fuente: la vista `panel_precios`.
- Buscador por texto (marca, modelo, nombre) y filtros por categoría, proveedor y "solo promociones".
- Etiqueta **Mejor precio** (`es_mejor_precio`) y **Vence en N días** (`dias_restantes`), en rojo si faltan 3 o menos.
- Gris y "actualizado hace N días" si `vigente_desde` tiene más de 60 días y no tiene vencimiento.
- Al abrir un producto: historial de precios (tabla `precios`, ordenada por `vigente_desde`) y botón **Ver documento original** con `createSignedUrl(path, 60)` del bucket `documentos-precios`.
- Mostrar IVA solo si `incluye_iva` no es `null` ("Incluye IVA" / "Más IVA").
- Debe funcionar bien en el celular.

### 9.3 `/instalaciones/precios/revision` (solo admin): aprobación
- Fuente: la vista `cola_revision`, con el documento original visible al lado (PDF o imagen con enlace firmado).
- Acciones por renglón: **Aprobar** (`update precios set estado = 'aprobado'`), **Corregir** (editar precio, fechas, nombre, tipo y luego aprobar) y **Descartar** (`estado = 'descartado'`).
- Resaltar en amarillo los renglones con `confianza` menor a 0.8.
- Aprobación masiva solo para los seleccionados con casillas. **No** agregues "aprobar todo automáticamente".
- Al aprobar, la base registra sola `aprobado_por` y `aprobado_en`. No los envíes desde el cliente.

### 9.4 `/instalaciones/precios/documentos` (solo admin): bandeja
- Lista de `documentos` con su estado (`pendiente`, `procesando`, `procesado`, `error`) y el mensaje de error si lo hay.
- **Reintentar**: `update documentos set estado = 'pendiente'` donde estado = `error`.
- **Subir archivo**: validar en el cliente tipo (`application/pdf`, `image/jpeg`, `image/png`, `image/webp`) y tamaño (máx. 150 MB). Subir al bucket `documentos-precios` con la sesión del admin en `manual/AAAA/MM/<uuid>-<nombre-seguro>`, y luego insertar la fila en `documentos` con `origen = 'manual'`, `storage_path`, `mime`, `nombre_archivo` y `proveedor_id` elegido. El resto lo hace la función `procesar-documento`.
- La identidad del producto usa marca y modelo (o nombre cuando no hay modelo), ignorando mayúsculas y espacios. Al aprobar una revisión, el precio aprobado más reciente pasa a ser el vigente para ese producto, proveedor y tipo; los precios anteriores se conservan como historial.

### 9.5 `/instalaciones/precios/proveedores` (solo admin)
- Alta y edición de `proveedores` y de `remitentes`.
- Validar el teléfono de `remitentes` con `^[0-9]{8,15}$` (solo dígitos con código de país; Guatemala empieza con `502`).
- No se borra nada: desactivar con `activo = false`.

### 9.6 Reglas de código
- Todas las consultas pasan por el cliente de Supabase con la sesión del usuario, **sin** `service_role` en el navegador.
- Tipos generados si el repositorio ya los usa.
- Manejo de errores visible para el usuario (por ejemplo, "El cheque excede…" no aplica aquí, pero sí los errores de subida y de permisos).

## 10. Fase 5: funciones de Supabase (Edge Functions)

1. Revisa `functions/_shared/utils.ts`, `procesar-documento` y `whatsapp-webhook`. Si el proyecto usa Deno, ejecuta `deno check` y agrega pruebas con `Deno.test` para `firmaValida` y `normalizarItems`. Casos a cubrir:
   - Firma válida; cuerpo alterado; secreto distinto; encabezado ausente o mal formado; secreto vacío.
   - Precio negativo, `NaN`, texto o mayor a 10 000 000: se descarta.
   - Moneda distinta de `GTQ`/`USD` o tipo distinto de `lista`/`promocion`: se descarta.
   - `vigente_hasta` anterior a `vigente_desde`: se anula la fecha.
   - Categoría desconocida: pasa a `Otros`. `confianza` limitada a 0–1. Entrada que no es un objeto con `items`: lista vacía.
2. Ubícalas en `supabase/functions/` si el repositorio ya sigue esa convención.
3. **No las despliegues.** Entrega al usuario los comandos exactos (están en la sección "Paso 4" de `GUIA_MODULO_PRECIOS.md`).
4. La variable `GEMINI_MODEL` queda **sin valor**: el usuario copia el nombre vigente desde la documentación de Google. No lo inventes.
5. `whatsapp-webhook` **no se activa** en esta etapa. Solo se activa cuando el usuario confirme que ya conectó su número (coexistencia de WhatsApp Business, paso 7 de la guía). Con un solo remitente, en `remitentes` va una sola fila.

## 11. Criterios de aceptación

- [ ] Huella de datos idéntica antes y después de migrar (copia local y, luego, producción).
- [ ] `es_admin()` y demás funciones existentes sin cambios.
- [ ] Roles `admin`, `director`, `cliente` funcionan exactamente igual que antes.
- [ ] `ventas` ve `/instalaciones` y nada más del sistema; no puede escribir.
- [ ] Ninguna tabla del módulo tiene llave foránea hacia las tablas de escuelas o clientes (verifícalo con una consulta a `pg_constraint`), y ningún archivo de `/instalaciones` importa código de escuelas o clientes.
- [ ] `ventas` obtiene 0 filas de **todas** las tablas de escuelas y clientes con las políticas reales; `director` y `cliente` obtienen 0 filas de todo el módulo.
- [ ] El selector de módulo solo lo ve quien tiene acceso a ambos.
- [ ] `director` y `cliente` no pueden ver nada del módulo, ni por la URL ni por la API.
- [ ] Subir un PDF o foto desde el panel crea un documento, la función lo procesa y los precios aparecen en `/instalaciones/precios/revision`.
- [ ] Un precio aprobado aparece en `/instalaciones/precios`; uno vencido ayer no aparece; uno que vence hoy sí aparece.
- [ ] No quedan secretos en el repositorio.
- [ ] El rollback funciona en la copia local.
- [ ] Las pruebas existentes del repositorio siguen pasando.

## 12. Cómo reportar

Al terminar cada fase, entrega:
1. Qué hiciste y qué archivos cambiaste o creaste.
2. Los comandos que ejecutaste y su resultado resumido.
3. **Lo que no pudiste verificar** y por qué (por ejemplo, no se probó contra WhatsApp ni contra la IA reales).
4. Preguntas abiertas.

## 13. Preguntas abiertas para el usuario (no bloquean las fases 0 a 3)

1. ¿Los precios que llegan por WhatsApp son **costo** (lo que paga la empresa) o **precio de venta**? Si es costo, habrá que agregar margen y que `ventas` vea el precio de venta.
2. ¿Quiénes consultarán el panel? Define cuántos usuarios `ventas` hay que crear.
3. Nombre del modelo de IA vigente (para `GEMINI_MODEL`).
4. ¿Cuándo se conectará el número de WhatsApp Business? Hasta entonces, solo subida manual.
5. **¿El `admin` de escuelas debe ver también Instalaciones?** Hoy sí (un solo `admin` ve todo, con selector de módulo). Si prefieres un administrador de Instalaciones que **no** vea escuelas, y que el `admin` de escuelas **no** vea Instalaciones, hay que agregar un rol nuevo (por ejemplo `admin_instalaciones`) y ajustar las políticas del módulo. Decídelo antes de la Fase 3.
