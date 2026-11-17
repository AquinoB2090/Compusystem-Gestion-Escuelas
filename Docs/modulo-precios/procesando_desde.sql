-- Tracks the current processing attempt, independently from the original upload time.
begin;
alter table public.documentos
  add column if not exists procesando_desde timestamptz;
comment on column public.documentos.procesando_desde is 'Inicio del intento actual de procesamiento; NULL fuera del estado procesando.';
commit;
