import { requireInstallationRole } from './access';

export default async function InstalacionesPage() {
  const { supabase, profile } = await requireInstallationRole();
  const promocionesQuery = supabase.from('panel_precios').select('precio_id', { count: 'exact', head: true })
    .eq('tipo', 'promocion').gte('dias_restantes', 0).lte('dias_restantes', 7);
  const adminQueries = profile.rol === 'admin' ? Promise.all([
    supabase.from('cola_revision').select('precio_id', { count: 'exact', head: true }),
    supabase.from('documentos').select('id', { count: 'exact', head: true }).eq('estado', 'error'),
  ]) : Promise.resolve(null);
  const [promotions, adminCounts] = await Promise.all([promocionesQuery, adminQueries]);
  const reviewCount = adminCounts?.[0].count ?? 0;
  const errorCount = adminCounts?.[1].count ?? 0;
  const hasError = Boolean(promotions.error || adminCounts?.some((result) => result.error));

  return <div className="installation-page">
    <div className="installation-page-heading"><div><span className="installation-eyebrow">COMPUSYSTEM · ESPACIO DE TRABAJO</span><h1>Instalaciones</h1><p>Precios y cotizaciones para cámaras de seguridad y aire acondicionado.</p></div><span className="installation-date">{new Intl.DateTimeFormat('es-GT', { dateStyle: 'long' }).format(new Date())}</span></div>
    {hasError && <div className="installation-alert" role="status">No se pudieron cargar algunos indicadores. Puedes abrir las secciones para volver a intentar.</div>}
    <section className={`installation-metrics ${profile.rol === 'ventas' ? 'installation-metrics-sales' : ''}`} aria-label="Indicadores">
      {profile.rol === 'admin' && <>
        <a className="installation-metric" href="/instalaciones/precios/revision"><span className="installation-metric-icon metric-review">✓</span><span className="installation-metric-label">Precios por revisar</span><b>{reviewCount}</b><small>A la espera de aprobación</small></a>
        <a className="installation-metric" href="/instalaciones/precios/documentos"><span className="installation-metric-icon metric-error">!</span><span className="installation-metric-label">Documentos con error</span><b>{errorCount}</b><small>Requieren atención</small></a>
      </>}
      <a className="installation-metric" href="/instalaciones/precios?promociones=1"><span className="installation-metric-icon metric-promo">%</span><span className="installation-metric-label">Promociones por vencer</span><b>{promotions.count ?? 0}</b><small>Vencen en los próximos 7 días</small></a>
    </section>
    <section className="installation-start-card"><div className="installation-start-icon">₲</div><div><span className="installation-eyebrow">CONSULTA DE PRECIOS</span><h2>Encuentra opciones vigentes</h2><p>Compara precios aprobados, revisa promociones y consulta condiciones del proveedor.</p><a className="installation-primary-link" href="/instalaciones/precios">Abrir precios <span>→</span></a></div></section>
  </div>;
}
