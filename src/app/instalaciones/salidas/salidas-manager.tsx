'use client';

import { useMemo, useState, type FormEvent } from 'react';
import { createClient } from '@/lib/supabase/client';

export type InstallationOuting = {
  id: number;
  lugar: string;
  fecha_inicio: string;
  fecha_fin: string;
  trabajo_realizado: string;
  cobrado: number;
  invertido: number;
  ganancia: number;
  creado_en: string;
};

const money = (amount: number) => `Q ${Number(amount || 0).toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const daysBetween = (start: string, end: string) => Math.floor((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000) + 1;
const dateLabel = (value: string) => new Intl.DateTimeFormat('es-GT', { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(`${value}T00:00:00Z`));

export default function OutingsManager({ initialOutings }: { initialOutings: InstallationOuting[] }) {
  const [outings, setOutings] = useState(initialOutings);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const totals = useMemo(() => outings.reduce((sum, outing) => ({
    cobrado: sum.cobrado + Number(outing.cobrado),
    invertido: sum.invertido + Number(outing.invertido),
    ganancia: sum.ganancia + Number(outing.ganancia),
  }), { cobrado: 0, invertido: 0, ganancia: 0 }), [outings]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    setBusy(true); setError(''); setNotice('');
    const form = new FormData(formElement);
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setError('Tu sesión venció. Inicia sesión de nuevo.'); setBusy(false); return; }
    const payload = {
      lugar: String(form.get('lugar') || '').trim(),
      fecha_inicio: String(form.get('fecha_inicio') || ''),
      fecha_fin: String(form.get('fecha_fin') || ''),
      trabajo_realizado: String(form.get('trabajo_realizado') || '').trim(),
      cobrado: Number(form.get('cobrado')),
      invertido: Number(form.get('invertido')),
      creado_por: user.id,
    };
    const { data, error: saveError } = await supabase.from('instalaciones_salidas').insert(payload)
      .select('id,lugar,fecha_inicio,fecha_fin,trabajo_realizado,cobrado,invertido,ganancia,creado_en').single();
    if (saveError) { setError('No se pudo guardar la salida. Revisa los datos e intenta de nuevo.'); setBusy(false); return; }
    setOutings(current => [data as InstallationOuting, ...current].sort((a, b) => b.fecha_inicio.localeCompare(a.fecha_inicio)));
    formElement.reset();
    setNotice('Salida registrada.'); setBusy(false);
  }

  return <>
    <section className="outing-summary" aria-label="Resumen de salidas">
      <article><span>Salidas registradas</span><b>{outings.length}</b></article>
      <article><span>Total cobrado</span><b>{money(totals.cobrado)}</b></article>
      <article><span>Total invertido</span><b>{money(totals.invertido)}</b></article>
      <article className={totals.ganancia < 0 ? 'outing-loss' : ''}><span>Ganancia total</span><b>{money(totals.ganancia)}</b></article>
    </section>

    <section className="outing-panel">
      <div className="outing-panel-heading"><div><span className="installation-eyebrow">NUEVO REGISTRO</span><h2>Registrar salida</h2><p>La duración y la ganancia se calculan automáticamente.</p></div></div>
      <form className="outing-form" onSubmit={save}>
        <label>Lugar<input name="lugar" required maxLength={180} placeholder="Cliente, municipio o dirección" /></label>
        <label>Fecha de inicio<input name="fecha_inicio" type="date" required /></label>
        <label>Fecha de finalización<input name="fecha_fin" type="date" required /></label>
        <label className="outing-wide">Trabajo realizado<textarea name="trabajo_realizado" required maxLength={4000} rows={3} placeholder="Describe la instalación o el trabajo realizado" /></label>
        <label>Cuánto se cobró (Q)<input name="cobrado" type="number" min="0" step="0.01" required placeholder="0.00" /></label>
        <label>Cuánto se invirtió (Q)<input name="invertido" type="number" min="0" step="0.01" required placeholder="0.00" /></label>
        {error && <div className="outing-form-message outing-form-error" role="alert">{error}</div>}
        {notice && <div className="outing-form-message outing-form-success" role="status">{notice}</div>}
        <div className="outing-form-actions"><button className="installation-primary-link" type="submit" disabled={busy}>{busy ? 'Guardando…' : 'Guardar salida'} <span>→</span></button></div>
      </form>
    </section>

    <section className="outing-history">
      <div className="outing-history-heading"><div><span className="installation-eyebrow">HISTORIAL</span><h2>Salidas registradas</h2></div><span>{outings.length} {outings.length === 1 ? 'registro' : 'registros'}</span></div>
      {!outings.length ? <div className="price-empty"><b>Aún no hay salidas</b><span>Los registros aparecerán aquí después de guardarlos.</span></div> : <div className="outing-list">{outings.map(outing => <article className="outing-card" key={outing.id}>
        <div className="outing-card-heading"><div><span className="outing-place-icon">↗</span><div><h3>{outing.lugar}</h3><small>{dateLabel(outing.fecha_inicio)}{outing.fecha_fin === outing.fecha_inicio ? '' : ` – ${dateLabel(outing.fecha_fin)}`}</small></div></div><b className={`outing-profit ${Number(outing.ganancia) < 0 ? 'outing-loss' : ''}`}>{money(Number(outing.ganancia))}<small>ganancia</small></b></div>
        <p className="outing-work">{outing.trabajo_realizado}</p>
        <div className="outing-card-metrics"><span><small>Duración</small><b>{daysBetween(outing.fecha_inicio, outing.fecha_fin)} {daysBetween(outing.fecha_inicio, outing.fecha_fin) === 1 ? 'día' : 'días'}</b></span><span><small>Cobrado</small><b>{money(Number(outing.cobrado))}</b></span><span><small>Inversión</small><b>{money(Number(outing.invertido))}</b></span></div>
      </article>)}</div>}
    </section>
  </>;
}
