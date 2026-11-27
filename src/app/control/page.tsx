import { redirect } from 'next/navigation';
import ModuleNavbar from '../ui/ModuleNavbar';
import { createClient } from '@/lib/supabase/server';
import './control.css';

const money = (value: number) => `Q ${value.toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const sum = (rows: Array<Record<string, unknown>> | null, key: string) =>
  (rows ?? []).reduce((total, row) => total + Number(row[key] ?? 0), 0);

function guatemalaMonth() {
  const values = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Guatemala', year: 'numeric', month: '2-digit' }).formatToParts(new Date());
  const year = values.find((part) => part.type === 'year')!.value;
  const month = values.find((part) => part.type === 'month')!.value;
  const next = new Date(Number(year), Number(month), 1);
  const nextMonth = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`;
  return { month: `${year}-${month}`, dateStart: `${year}-${month}-01`, dateEnd: `${nextMonth}-01`, start: `${year}-${month}-01T00:00:00-06:00`, end: `${nextMonth}-01T00:00:00-06:00` };
}

export default async function ControlPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  const { data: profile } = await supabase.from('perfiles').select('nombre,rol').eq('id', user.id).eq('activo', true).maybeSingle();
  if (!profile || profile.rol !== 'admin') redirect('/');

  const period = guatemalaMonth();
  const [schools, teachers, schoolActivity, openOutings, outings, openOrders, workshopOrders, deliveredOrders] = await Promise.all([
    supabase.from('escuelas').select('id', { count: 'exact', head: true }).eq('activa', true),
    supabase.from('maestros').select('id', { count: 'exact', head: true }).eq('activo', true),
    supabase.from('consumos').select('monto').eq('anulado', false).gte('fecha', period.dateStart).lt('fecha', period.dateEnd),
    supabase.from('instalaciones_salidas').select('id', { count: 'exact', head: true }).eq('estado', 'activa'),
    supabase.from('instalaciones_salidas').select('cobrado,invertido,ganancia').eq('estado', 'finalizada').gte('fecha_fin', period.start).lt('fecha_fin', period.end),
    supabase.from('taller_ordenes').select('id', { count: 'exact', head: true }).not('estado', 'in', '(entregado,cancelado)'),
    supabase.from('taller_ordenes').select('monto_cobrado,estado').gte('creado_en', period.start).lt('creado_en', period.end),
    supabase.from('taller_ordenes').select('id', { count: 'exact', head: true }).eq('estado', 'entregado').gte('entregado_en', period.start).lt('entregado_en', period.end),
  ]);

  const monthLabel = new Intl.DateTimeFormat('es-GT', { month: 'long', year: 'numeric', timeZone: 'America/Guatemala' }).format(new Date(`${period.dateStart}T12:00:00-06:00`));
  const schoolError = Boolean(schools.error || teachers.error || schoolActivity.error);
  const installationsError = Boolean(openOutings.error || outings.error);
  const workshopError = Boolean(openOrders.error || workshopOrders.error || deliveredOrders.error);
  const collected = sum(outings.data as Array<Record<string, unknown>> | null, 'cobrado');
  const profit = sum(outings.data as Array<Record<string, unknown>> | null, 'ganancia');
  const workshopCollected = sum(workshopOrders.data as Array<Record<string, unknown>> | null, 'monto_cobrado');

  return <div className="control-app">
    <ModuleNavbar active="control" available={['escuela', 'instalaciones', 'taller', 'control']} />
    <main className="control-main">
      <header className="control-heading">
        <div><span className="control-eyebrow">CENTRO DE MONITOREO</span><h1>Control general</h1><p>Resumen operativo de los tres módulos de Compusystem.</p></div>
        <span className="control-period">{monthLabel}</span>
      </header>
      <section className="control-grid" aria-label="Indicadores por módulo">
        <article className="control-card control-school">
          <div className="control-card-top"><span className="control-icon">▦</span><span className="control-module">ESCUELA</span><a href="/">Abrir módulo <span aria-hidden="true">↗</span></a></div>
          <h2>Gestión escolar</h2>
          {schoolError ? <p className="control-error">No se pudieron cargar todos los indicadores.</p> : <>
            <div className="control-stats"><div><b>{schools.count ?? 0}</b><span>Escuelas activas</span></div><div><b>{teachers.count ?? 0}</b><span>Maestros activos</span></div></div>
            <div className="control-foot"><span>Consumo registrado este mes</span><strong>{money(sum(schoolActivity.data as Array<Record<string, unknown>> | null, 'monto'))}</strong></div>
          </>}
        </article>
        <article className="control-card control-installations">
          <div className="control-card-top"><span className="control-icon">◈</span><span className="control-module">INSTALACIONES</span><a href="/instalaciones">Abrir módulo <span aria-hidden="true">↗</span></a></div>
          <h2>Trabajos y salidas</h2>
          {installationsError ? <p className="control-error">No se pudieron cargar todos los indicadores.</p> : <>
            <div className="control-stats"><div><b>{openOutings.count ?? 0}</b><span>Salidas activas</span></div><div><b>{outings.data?.length ?? 0}</b><span>Finalizadas este mes</span></div></div>
            <div className="control-foot"><span>Cobrado este mes</span><strong>{money(collected)}</strong></div>
            <div className="control-foot control-foot-secondary"><span>Ganancia registrada</span><strong>{money(profit)}</strong></div>
          </>}
        </article>
        <article className="control-card control-workshop">
          <div className="control-card-top"><span className="control-icon">⚒</span><span className="control-module">TALLER</span><a href="/taller">Abrir módulo <span aria-hidden="true">↗</span></a></div>
          <h2>Servicio técnico</h2>
          {workshopError ? <p className="control-error">No se pudieron cargar todos los indicadores.</p> : <>
            <div className="control-stats"><div><b>{openOrders.count ?? 0}</b><span>Órdenes en proceso</span></div><div><b>{deliveredOrders.count ?? 0}</b><span>Entregadas este mes</span></div></div>
            <div className="control-foot"><span>Cobrado en órdenes recibidas este mes</span><strong>{money(workshopCollected)}</strong></div>
          </>}
        </article>
      </section>
      <p className="control-note">Los indicadores financieros agrupan los registros del mes por fecha de finalización en Instalaciones y fecha de recepción en Taller.</p>
    </main>
  </div>;
}
