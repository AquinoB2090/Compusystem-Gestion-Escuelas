# Saldos de fotocopias · Compusystem

Aplicación web en español para registrar cheques, asignaciones mensuales y consumos por maestro, y consultar o imprimir la hoja mensual. Usa Next.js y Supabase Auth/PostgreSQL con RLS.

## Configuración

1. Instala Node.js 22 o posterior.
2. Copia `.env.example` a `.env.local` y completa URL y clave publishable del proyecto Supabase (o usa `NEXT_PUBLIC_SUPABASE_ANON_KEY` si tu proyecto aún usa la clave anon).
3. Ejecuta `npm install` y `npm run dev`.
4. En un proyecto Supabase nuevo, ejecuta `supabase/base_de_datos.sql` desde SQL Editor.
5. En Supabase Authentication, crea el usuario admin y desactiva el registro público. Añade su perfil desde SQL Editor, sustituyendo el UUID:

   ```sql
   insert into public.perfiles(id,nombre,rol)
   values ('UUID-DEL-USUARIO','Nombre del administrador','admin');
   ```

6. Carga escuelas y maestros desde Table Editor o CSV. Crea director(es) en Authentication y asigna sus perfiles con `rol='director'` y la `escuela_id` correspondiente.

## Funciones incluidas

- Inicio de sesión con contraseña y cierre de sesión.
- Panel de saldos acumulados y consumo del mes actual; la base aplica el filtro de escuela para los directores.
- Alta de cheques y resumen del monto disponible.
- Asignaciones a maestros del centro del cheque, limitadas al disponible.
- Captura de consumos con responsable, descripción, monto y nombre de quien recibió.
- Hoja imprimible por maestro y mes, basada en el formato recibido y sin espacio de firma.
- Catálogos editables de escuelas y maestros, anulaciones con motivo obligatorio, reportes CSV y creación de cuentas de director.
- Vistas SQL `saldo_maestro`, `saldo_mensual`, `hoja_maestro` y `cheques_resumen`.
- Funciones SQL con validaciones y permisos para las operaciones de administración.

## Seguridad y datos

Los directores reciben acceso de solo lectura a los datos de su escuela mediante políticas RLS en PostgreSQL. El acceso por apartado requiere `SUPABASE_SECRET_KEY` para mapear Compusystem a su cuenta admin y Directory a la cuenta de la escuela elegida. Define esa clave solo como variable de servidor (nunca con el prefijo `NEXT_PUBLIC_`). Para crear cuentas desde la pantalla admin, el endpoint valida el rol admin, crea una contraseña temporal aleatoria y la muestra una sola vez; entrégasela al director de forma privada. Los errores se conservan como anulaciones con motivo en el esquema.

La base de datos ya desplegada usa `periodo`, `anulada`, `fecha_recepcion` y otras columnas propias. La app consulta ese esquema. `supabase/base_de_datos.sql` es una referencia autónoma creada antes de poder inspeccionar la base desplegada; no la ejecutes sobre el proyecto existente.

## Despliegue

### Vercel

1. Importa el repositorio de GitHub en Vercel. Vercel detecta Next.js automáticamente; usa `npm run build` como comando de compilación.
2. En **Project Settings → Environment Variables**, configura para Production (y Preview si usarás previews):
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
   - `SUPABASE_SECRET_KEY` (solo servidor; nunca debe llevar el prefijo `NEXT_PUBLIC_`)
3. Vuelve a desplegar después de guardar las variables. Mantén `.env.local` fuera del repositorio.
4. Antes de publicar, confirma en Supabase que las migraciones requeridas por la aplicación ya se ejecutaron. No ejecutes `supabase/base_de_datos.sql` sobre la base existente.
5. En **Supabase → Authentication → URL Configuration**, agrega el dominio de producción de Vercel a los redirect URLs y establece el Site URL al dominio final cuando vayas a usar enlaces de autenticación.

### Mantener actividad en Supabase Free

El workflow `.github/workflows/supabase-keepalive.yml` hace una consulta de solo lectura tres veces al día y se puede ejecutar manualmente desde la pestaña **Actions**. Se programa varias veces al día porque Supabase indica que una actividad baja durante siete días puede pausar un proyecto Free y que, por lo general, hacen falta varias solicitudes diarias; una consulta semanal no ofrece esa frecuencia.

En el repositorio de GitHub, configura:

- En **Settings → Secrets and variables → Actions → Variables**, agrega `SUPABASE_URL` con la URL del proyecto.
- En la pestaña **Secrets**, agrega `SUPABASE_SECRET_KEY` con la clave secreta del proyecto.

La clave secreta se usa solo como encabezado de API para una consulta GET y no se imprime en los logs. El workflow necesita estar en la rama predeterminada y las GitHub Actions habilitadas. El cron de GitHub puede retrasarse; Supabase no garantiza que las solicitudes programadas eviten toda pausa por inactividad. Para garantizar que no se pause por inactividad, Supabase requiere un plan de pago.
