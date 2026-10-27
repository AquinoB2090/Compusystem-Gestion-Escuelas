-- Inserta o actualiza las nueve escuelas en public.escuelas.
-- Se puede ejecutar más de una vez: codigo es la clave única.
insert into public.escuelas (nombre, codigo, activa)
values
  ('Escuela intercultural', 'INTERCULTURAL', true),
  ('Escuela Palo Amontonado', 'PALO-AMONTONADO', true),
  ('Escuela El Naranjo', 'EL-NARANJO', true),
  ('Escuela Santa Lucia Pre Primaria', 'SANTA-LUCIA-PRE-PRIMARIA', true),
  ('Escuela Sanra Lucia Primaria', 'SANRA-LUCIA-PRIMARIA', true),
  ('Escuela Casas Viejas', 'CASAS-VIEJAS', true),
  ('Escuela Tierra Blanca', 'TIERRA-BLANCA', true),
  ('Escuela Federal', 'FEDERAL', true),
  ('Escuela Santa Rita', 'SANTA-RITA', true)
on conflict (codigo) do update
set nombre = excluded.nombre,
    activa = excluded.activa;
