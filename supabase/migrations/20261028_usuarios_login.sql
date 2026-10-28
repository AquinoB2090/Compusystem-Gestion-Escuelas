-- Identifica cada cuenta por nombre de usuario; el inicio de sesión ya no
-- necesita mostrar una lista de escuelas ni un selector de rol.
alter table public.perfiles add column if not exists usuario text;

with nombres_base as (
  select
    p.id,
    case
      when p.rol = 'admin' then 'compusystem'
      else coalesce(nullif(regexp_replace(lower(split_part(u.email, '@', 1)), '[^a-z0-9._-]', '', 'g'), ''), 'usuario')
    end as base
  from public.perfiles p
  left join auth.users u on u.id = p.id
  where p.usuario is null or btrim(p.usuario) = ''
), numerados as (
  select id, base, row_number() over (partition by base order by id) as posicion
  from nombres_base
)
update public.perfiles p
set usuario = n.base || case when n.posicion = 1 then '' else n.posicion::text end
from numerados n
where p.id = n.id;

alter table public.perfiles alter column usuario set not null;
create unique index if not exists perfiles_usuario_lower_uidx
  on public.perfiles (lower(usuario));

notify pgrst, 'reload schema';
