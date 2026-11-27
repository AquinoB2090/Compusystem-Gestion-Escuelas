'use client';

import { useMemo, useState, type FormEvent } from 'react';
import { createClient } from '@/lib/supabase/client';

export type InstallationOuting = {
  id: number;
  lugar: string;
  fecha_inicio: string;
  fecha_fin: string | null;
  trabajo_realizado: string | null;
  cobrado: number | null;
  invertido: number | null;
  factura: boolean;
  descuento_factura: number | null;
  ganancia: number | null;
  estado: 'activa' | 'finalizada';
  creado_en: string;
  creado_por: string;
};

const outingColumns = 'id,lugar,fecha_inicio,fecha_fin,trabajo_realizado,cobrado,invertido,factura,descuento_factura,ganancia,estado,creado_en,creado_por';
const money = (amount: number) => `Q ${Number(amount || 0).toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const daysBetween = (start: string, end: string) => Math.max(1, Math.ceil((Date.parse(end) - Date.parse(start)) / 86400000));
const dateTimeLabel = (value: string) => new Intl.DateTimeFormat('es-GT', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));

export default function OutingsManager({ initialOutings }: { initialOutings: InstallationOuting[] }) {
  const [outings, setOutings] = useState(initialOutings);
  const [busy, setBusy] = useState<number | 'start' | false>(false);
  const [finishingId, setFinishingId] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const completed = useMemo(() => outings.filter(outing => outing.estado === 'finalizada'), [outings]);
  const active = useMemo(() => outings.filter(outing => outing.estado === 'activa'), [outings]);
  const totals = useMemo(() => completed.reduce((sum, outing) => ({
    cobrado: sum.cobrado + Number(outing.cobrado || 0),
    invertido: sum.invertido + Number(outing.invertido || 0),
    descuento: sum.descuento + Number(outing.descuento_factura || 0),
    ganancia: sum.ganancia + Number(outing.ganancia || 0),
  }), { cobrado: 0, invertido: 0, descuento: 0, ganancia: 0 }), [completed]);

  async function startOuting(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setBusy('start'); setError(''); setNotice('');
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setError('Tu sesión venció. Inicia sesión de nuevo.'); setBusy(false); return; }
    const { data, error: saveError } = await supabase.from('instalaciones_salidas').insert({
      lugar: String(form.get('lugar') || '').trim(),
      estado: 'activa',
      creado_por: user.id,
    }).select(outingColumns).single();
    if (saveError) { setError('No se pudo iniciar la salida. Revisa el lugar e intenta de nuevo.'); setBusy(false); return; }
    setOutings(current => [data as InstallationOuting, ...current]);
    formElement.reset(); setNotice('Salida iniciada. Puedes mantener varias instalaciones activas al mismo tiempo.'); setBusy(false);
  }

  async function finishOuting(event: FormEvent<HTMLFormElement>, outing: InstallationOuting) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const hasInvoice = form.get('factura') === 'on';
    const payload = {
      estado: 'finalizada' as const,
      fecha_fin: new Date().toISOString(),
      trabajo_realizado: String(form.get('trabajo_realizado') || '').trim(),
      cobrado: Number(form.get('cobrado')),
      invertido: Number(form.get('invertido')),
      factura: hasInvoice,
    };
    setBusy(outing.id); setError(''); setNotice('');
    const { data, error: finishError } = await createClient().from('instalaciones_salidas').update(payload)
      .eq('id', outing.id).eq('estado', 'activa').select(outingColumns).single();
    if (finishError) { setError('No se pudo finalizar esta instalación. Verifica tu acceso e intenta de nuevo.'); setBusy(false); return; }
    setOutings(current => current.map(item => item.id === outing.id ? data as InstallationOuting : item));
    setFinishingId(null); setNotice(`Instalación de ${outing.lugar} finalizada.`); setBusy(false);
  }

  return <>
    <section className="outing-summary" aria-label="Resumen de salidas">
      <article className="outing-active-total"><span>Instalaciones activas</span><b>{active.length}</b></article>
      <article><span>Total cobrado</span><b>{money(totals.cobrado)}</b></article>
      <article><span>Total invertido</span><b>{money(totals.invertido)}</b></article>
      <article className={totals.ganancia < 0 ? 'outing-loss' : ''}><span>Ganancia neta</span><b>{money(totals.ganancia)}</b><small>Facturas: − {money(totals.descuento)}</small></article>
    </section>

    <section className="outing-panel">
      <div className="outing-panel-heading"><div><span className="installation-eyebrow">NUEVA INSTALACIÓN</span><h2>Iniciar salida</h2><p>Guarda el lugar al comenzar. Agrega el trabajo, cobro e inversión al finalizar.</p></div></div>
      <form className="outing-form outing-start-form" onSubmit={startOuting}>
        <label>Lugar<input name="lugar" required maxLength={180} placeholder="Cliente, municipio o dirección" /></label>
        <div className="outing-form-actions"><button className="installation-primary-link" type="submit" disabled={busy !== false}>{busy === 'start' ? 'Iniciando…' : 'Iniciar instalación'} <span>→</span></button></div>
      </form>
    </section>

    {error && <div className="outing-form-message outing-form-error" role="alert">{error}</div>}
    {notice && <div className="outing-form-message outing-form-success" role="status">{notice}</div>}

    <section className="outing-history">
      <div className="outing-history-heading"><div><span className="installation-eyebrow">EN PROCESO</span><h2>Instalaciones activas</h2></div><span>{active.length} {active.length === 1 ? 'activa' : 'activas'}</span></div>
      {!active.length ? <div className="price-empty"><b>No hay instalaciones activas</b><span>Al iniciar una salida, aparecerá aquí hasta que la finalices.</span></div> : <div className="outing-list">{active.map(outing => <article className="outing-card outing-card-active" key={outing.id}>
        <div className="outing-card-heading"><div><span className="outing-place-icon">↗</span><div><h3>{outing.lugar}</h3><small>Iniciada {dateTimeLabel(outing.fecha_inicio)}</small></div></div><span className="outing-active-badge"><i />En curso</span></div>
        {finishingId === outing.id ? <form className="outing-form outing-finish-form" onSubmit={event => finishOuting(event, outing)}>
          <label className="outing-wide">Trabajo realizado<textarea name="trabajo_realizado" required maxLength={4000} rows={3} placeholder="Describe la instalación o el trabajo realizado" /></label>
          <label>Cuánto se cobró (Q)<input name="cobrado" type="number" min="0" step="0.01" required placeholder="0.00" /></label>
          <label>Cuánto se invirtió (Q)<input name="invertido" type="number" min="0" step="0.01" required placeholder="0.00" /></label>
          <label className="outing-invoice-toggle"><input name="factura" type="checkbox" /> Se entregó factura (descontar 5% del cobro)</label>
          <div className="outing-form-actions"><button className="outing-cancel-button" type="button" onClick={() => setFinishingId(null)}>Cancelar</button><button className="installation-primary-link" type="submit" disabled={busy === outing.id}>{busy === outing.id ? 'Finalizando…' : 'Finalizar instalación'} <span>✓</span></button></div>
        </form> : <div className="outing-active-actions"><span>Al finalizar, registra el trabajo, el cobro, la inversión y la factura.</span><button className="installation-primary-link" type="button" onClick={() => { setError(''); setFinishingId(outing.id); }}>Finalizar salida <span>→</span></button></div>}
      </article>)}</div>}
    </section>

    <section className="outing-history">
      <div className="outing-history-heading"><div><span className="installation-eyebrow">HISTORIAL</span><h2>Instalaciones finalizadas</h2></div><span>{completed.length} {completed.length === 1 ? 'registro' : 'registros'}</span></div>
      {!completed.length ? <div className="price-empty"><b>Aún no hay instalaciones finalizadas</b><span>El historial aparecerá aquí al cerrar una salida.</span></div> : <div className="outing-list">{completed.map(outing => <article className="outing-card" key={outing.id}>
        <div className="outing-card-heading"><div><span className="outing-place-icon">↗</span><div><h3>{outing.lugar}</h3><small>{dateTimeLabel(outing.fecha_inicio)} – {outing.fecha_fin ? dateTimeLabel(outing.fecha_fin) : '—'}</small></div></div><b className={`outing-profit ${Number(outing.ganancia) < 0 ? 'outing-loss' : ''}`}>{money(Number(outing.ganancia))}<small>ganancia neta</small></b></div>
        <p className="outing-work">{outing.trabajo_realizado}</p>
        <div className="outing-card-metrics"><span><small>Duración</small><b>{outing.fecha_fin ? `${daysBetween(outing.fecha_inicio, outing.fecha_fin)} ${daysBetween(outing.fecha_inicio, outing.fecha_fin) === 1 ? 'día' : 'días'}` : '—'}</b></span><span><small>Cobrado</small><b>{money(Number(outing.cobrado))}</b></span><span><small>Inversión</small><b>{money(Number(outing.invertido))}</b></span>{outing.factura && <span><small>Descuento factura (5%)</small><b>− {money(Number(outing.descuento_factura))}</b></span>}</div>
      </article>)}</div>}
    </section>
  </>;
}
