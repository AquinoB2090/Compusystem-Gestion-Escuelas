import { requireInstallationRole } from '../access';
import OutingsManager, { type InstallationOuting } from './salidas-manager';

export default async function SalidasPage() {
  const { supabase } = await requireInstallationRole();
  const { data, error } = await supabase
    .from('instalaciones_salidas')
    .select('id,lugar,fecha_inicio,fecha_fin,trabajo_realizado,cobrado,invertido,factura,descuento_factura,ganancia,estado,creado_en,creado_por')
    .order('fecha_inicio', { ascending: false })
    .order('id', { ascending: false });

  return <div className="installation-page">
    <div className="installation-page-heading"><div><span className="installation-eyebrow">CONTROL DE TRABAJOS</span><h1>Salidas</h1><p>Registra dónde se hicieron las instalaciones y revisa el tiempo, cobro, inversión y ganancia.</p></div></div>
    {error ? <div className="installation-alert" role="alert">No se pudieron cargar las salidas. Verifica que esté aplicada la migración de Salidas.</div> : <OutingsManager initialOutings={(data ?? []) as InstallationOuting[]} />}
  </div>;
}
