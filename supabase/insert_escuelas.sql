-- Inserta las nueve escuelas sin duplicar nombres ya existentes.
insert into public.escuelas (nombre, activa)
select escuelas.nombre, true
from (values
  ('Escuela intercultural'),
  ('Escuela Palo Amontonado'),
  ('Escuela El Naranjo'),
  ('Escuela Santa Lucia Pre Primaria'),
  ('Escuela Sanra Lucia Primaria'),
  ('Escuela Casas Viejas'),
  ('Escuela Tierra Blanca'),
  ('Escuela Federal'),
  ('Escuela Santa Rita')
) as escuelas(nombre)
where not exists (
  select 1 from public.escuelas existente
  where lower(trim(existente.nombre)) = lower(trim(escuelas.nombre))
);
