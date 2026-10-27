-- La pantalla de formato registra consumos directamente con el usuario autenticado.
grant insert on public.consumos to authenticated;

notify pgrst, 'reload schema';
