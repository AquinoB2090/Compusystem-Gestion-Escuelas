-- Los consumos de formatos en fotocopias se guardan en la base como quetzales.
-- Convierte registros creados antes de normalizar el monto (cantidad de copias = monto).
-- La condicion monto = descripcion hace que esta actualizacion sea idempotente.
update public.consumos c
set monto = c.monto / 4
from public.maestros m
where m.id = c.maestro_id
  and m.tipo_formato = 'fotocopias'
  and c.descripcion ~ '^[0-9]+(\.[0-9]+)?$'
  and c.monto = c.descripcion::numeric;

notify pgrst, 'reload schema';
