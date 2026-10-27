# Saldos de fotocopias · Compusystem

Aplicación web en español para registrar cheques, asignaciones mensuales y consumos por maestro, y consultar o imprimir la hoja mensual. Usa Next.js y Supabase Auth/PostgreSQL con RLS.

## Configuración

1. Instala Node.js 20 o posterior.
2. Copia `.env.example` a `.env.local` y completa URL y clave anon del proyecto Supabase.
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
- Vistas SQL `saldo_maestro`, `saldo_mensual`, `hoja_maestro` y `cheques_resumen`.
- Funciones SQL con validaciones y permisos para las operaciones de administración.

## Seguridad y datos

Los directores reciben acceso de solo lectura a los datos de su escuela mediante políticas RLS en PostgreSQL. La clave `SUPABASE_SERVICE_ROLE_KEY` no se usa en el navegador ni es necesaria para las funciones actuales; mantén cualquier clave de servicio solo en el servidor. Los errores se conservan como anulaciones con motivo en el esquema.

El archivo SQL mencionado en la guía que acompañó el formato no venía en la carpeta del proyecto, por lo que `supabase/base_de_datos.sql` implementa el esquema requerido por esta aplicación. Si ya desplegaste un esquema con nombres o columnas distintos, compara la migración antes de aplicarla.

## Despliegue

Importa el repositorio en Vercel y define `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_ANON_KEY`. No publiques `.env.local`. La creación de usuarios y catálogos puede hacerse desde Supabase Auth/Table Editor, como indica la guía.
