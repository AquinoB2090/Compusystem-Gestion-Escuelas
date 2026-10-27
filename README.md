# Saldos de fotocopias · Compusystem

Aplicación web en español para registrar cheques, asignaciones mensuales y consumos por maestro, y consultar o imprimir la hoja mensual. Usa Next.js y Supabase Auth/PostgreSQL con RLS.

## Configuración

1. Instala Node.js 20 o posterior.
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

Los directores reciben acceso de solo lectura a los datos de su escuela mediante políticas RLS en PostgreSQL. El acceso por apartado requiere `SUPABASE_SERVICE_ROLE_KEY` para mapear Compusystem a su cuenta admin y Directory a la cuenta de la escuela elegida. Define esa clave solo como variable de servidor (nunca con el prefijo `NEXT_PUBLIC_`). Para crear cuentas desde la pantalla admin, el endpoint valida el rol admin, crea una contraseña temporal aleatoria y la muestra una sola vez; entrégasela al director de forma privada. Los errores se conservan como anulaciones con motivo en el esquema.

El archivo SQL mencionado en la guía que acompañó el formato no venía en la carpeta del proyecto, por lo que `supabase/base_de_datos.sql` implementa el esquema requerido por esta aplicación. Si ya desplegaste un esquema con nombres o columnas distintos, compara la migración antes de aplicarla.

## Despliegue

Importa el repositorio en Vercel y define `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (o `NEXT_PUBLIC_SUPABASE_ANON_KEY`) y `SUPABASE_SERVICE_ROLE_KEY`. No publiques `.env.local`.
