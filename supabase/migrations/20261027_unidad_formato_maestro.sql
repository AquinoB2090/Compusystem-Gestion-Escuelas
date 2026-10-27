-- Guarda por maestro si los importes de su formato representan quetzales o copias.
alter table public.maestros
  add column if not exists tipo_formato text not null default 'quetzales';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'maestros_tipo_formato_check'
      and conrelid = 'public.maestros'::regclass
  ) then
    alter table public.maestros
      add constraint maestros_tipo_formato_check
      check (tipo_formato in ('quetzales', 'fotocopias'));
  end if;
end;
$$;

notify pgrst, 'reload schema';
