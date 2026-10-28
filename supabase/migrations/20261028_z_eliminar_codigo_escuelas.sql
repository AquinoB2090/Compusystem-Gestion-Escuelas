-- El código de escuela no participa en el acceso ni en las relaciones; las referencias usan id.
alter table public.escuelas
  drop column if exists codigo;

notify pgrst, 'reload schema';
