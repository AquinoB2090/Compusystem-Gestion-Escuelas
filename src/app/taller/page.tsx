'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { toast } from '../ui/Toaster';

type Order = {
  id: number; numero: number; cliente_nombre: string; cliente_telefono: string;
  equipo: string; marca: string | null; modelo: string | null; serie: string | null; accesorios: string | null;
  condicion_recepcion: string | null; problema_reportado: string; diagnostico: string | null;
  trabajo_realizado: string | null; estado: string; creado_en: string;
  tecnico: string | null; garantia_dias: number; monto_cobrado: number;
};
type WorkshopSummary = { trabajados:number; pendientes:number; totalCobrado:number };

const STAGES = [['recibido','Recibido'],['diagnostico','Diagnóstico'],['esperando_autorizacion','Esperando autorización'],['autorizado','Autorizado'],['reparacion','En reparación'],['listo','Listo para entregar'],['entregado','Entregado'],['no_reparable','No reparable'],['cancelado','Cancelado']];
const NEXT: Record<string, string[]> = {
  recibido: ['diagnostico', 'cancelado', 'entregado'],
  diagnostico: ['esperando_autorizacion', 'no_reparable', 'cancelado', 'entregado'],
  esperando_autorizacion: ['autorizado', 'no_reparable', 'cancelado', 'entregado'],
  autorizado: ['reparacion', 'cancelado', 'entregado'],
  reparacion: ['listo', 'no_reparable', 'cancelado', 'entregado'],
  listo: ['reparacion', 'entregado'],
  no_reparable: ['entregado', 'cancelado'],
  entregado: [],
  cancelado: ['recibido', 'entregado'],
};
const money = (v: number | null | undefined) => v == null ? '—' : new Intl.NumberFormat('es-GT', { style: 'currency', currency: 'GTQ' }).format(v);
const date = (v: string) => new Intl.DateTimeFormat('es-GT', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(v));
const stageLabel = (key: string) => STAGES.find(([value]) => value === key)?.[1] || key;
const stateOptions = (current: string) => Array.from(new Set([current, ...(NEXT[current] || [])]));

export default function TallerPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [summary,setSummary]=useState<WorkshopSummary>({trabajados:0,pendientes:0,totalCobrado:0});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('todas');
  const [showForm, setShowForm] = useState(false);
  const [printReceipt, setPrintReceipt] = useState<Order | null>(null);

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (filter === 'activas') params.set('estado', 'activas');
    else if (filter !== 'todas') params.set('estado', filter);
    if (search.trim()) params.set('q', search.trim());
    const r = await fetch(`/api/taller?${params}`);
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      const message = j.error || 'No se pudieron cargar las órdenes.';
      setError(message);
      toast.error(message);
      return false;
    }
    setError('');
    setOrders(j.ordenes || []);
    setSummary(j.resumen || {trabajados:0,pendientes:0,totalCobrado:0});
    return true;
  }, [filter, search]);

  useEffect(() => { const t = setTimeout(() => void load(), 180); return () => clearTimeout(t); }, [load]);
  useEffect(() => {
    const done = () => setPrintReceipt(null);
    window.addEventListener('afterprint', done);
    return () => window.removeEventListener('afterprint', done);
  }, []);

  const orderLabel = (id: number) => {
    const numero = orders.find(o => o.id === id)?.numero;
    return numero ? ` #${String(numero).padStart(5, '0')}` : '';
  };

  async function send(body: Record<string, unknown>, method = 'POST', success?: string | ((result: Record<string, unknown>) => string)) {
    setBusy(true);
    const r = await fetch('/api/taller', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { toast.error(j.error || 'No se pudo completar la acción.'); return null; }
    toast.success(typeof success === 'function' ? success(j) : success || 'Cambios guardados correctamente.');
    await load();
    return j as Record<string, unknown>;
  }

  function printOrderReceipt(o: Order) {
    toast.info(`Preparando la orden #${String(o.numero).padStart(5, '0')} para imprimir.`);
    setPrintReceipt(o);
    window.setTimeout(() => window.print(), 180);
  }

  async function submitOrder(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const body = Object.fromEntries(new FormData(form).entries());
    const result = await send(body, 'POST', j => {
      const numero = Number((j.orden as Order | undefined)?.numero);
      return numero ? `Orden #${String(numero).padStart(5, '0')} recibida correctamente.` : 'Orden recibida correctamente.';
    });
    if (!result) return;
    setShowForm(false);
    form.reset();
    const orden = result.orden as Order | undefined;
    if (orden) printOrderReceipt(orden);
  }

  async function saveOrder(id: number) {
    const field = (name: string) => (document.getElementById(`${name}-${id}`) as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement).value;
    await send({
      id,
      diagnostico: field('diag'),
      trabajo_realizado: field('trabajo'),
      estado: field('estado'),
      monto_cobrado: field('cobrado'),
    }, 'PATCH', `Orden${orderLabel(id)} guardada correctamente.`);
  }

  return <div className="installation-page workshop-page">
    <div className="installation-page-heading">
      <div>
        <span className="installation-eyebrow">COMPUSYSTEM · SERVICIO TÉCNICO</span>
        <h1>Taller de reparación</h1>
        <p>Recibe equipos e imprime la orden al momento. Después solo diagnóstico, trabajo, estado y cobro.</p>
      </div>
      <div className="workshop-heading-actions">
        <button className="installation-primary-link" onClick={() => setShowForm(v => !v)}>{showForm ? 'Cerrar' : '＋ Recibir equipo'}</button>
      </div>
    </div>

    {error && <div className="installation-alert workshop-error" role="alert">{error}</div>}

    <section className="workshop-summary" aria-label="Resumen del taller">
      <button className="workshop-summary-card" onClick={()=>setFilter('entregado')}><span>Equipos trabajados</span><b>{summary.trabajados}</b><small>Órdenes entregadas</small></button>
      <button className="workshop-summary-card" onClick={()=>setFilter('activas')}><span>Equipos pendientes</span><b>{summary.pendientes}</b><small>Órdenes aún en el taller</small></button>
      <button className="workshop-summary-card workshop-summary-revenue" onClick={()=>setFilter('todas')}><span>Total cobrado</span><b>{money(summary.totalCobrado)}</b><small>Cobros registrados, sin descontar costos</small></button>
    </section>

    {showForm && <form className="workshop-panel workshop-form" onSubmit={e => void submitOrder(e)}>
      <div className="workshop-panel-heading">
        <div>
          <span className="installation-eyebrow">RECEPCIÓN DE EQUIPO</span>
          <h2>Nueva orden de servicio</h2>
          <p>Guarda los datos de recepción e imprime la orden para entregar al cliente.</p>
        </div>
      </div>
      <div className="workshop-fields">
        <label>Nombre del cliente *<input name="cliente_nombre" required maxLength={140}/></label>
        <label>Teléfono *<input name="cliente_telefono" required maxLength={40}/></label>
        <label>Tipo de equipo *<input name="equipo" placeholder="Laptop, computadora de escritorio…" required maxLength={120}/></label>
        <label>Marca<input name="marca" maxLength={80}/></label>
        <label>Modelo<input name="modelo" maxLength={100}/></label>
        <label>Número de serie<input name="serie" maxLength={120}/></label>
        <label>Accesorios recibidos<input name="accesorios" placeholder="Cargador, funda, mouse…" maxLength={300}/></label>
        <label>Técnico asignado<input name="tecnico" maxLength={120}/></label>
        <label>Garantía del trabajo (días)<input name="garantia_dias" type="number" min="0" defaultValue="30"/></label>
        <label className="workshop-span">Condición visible al recibir<textarea name="condicion_recepcion" rows={2} placeholder="Golpes, pantalla, carcasa, piezas faltantes…" maxLength={1000}/></label>
        <label className="workshop-span">Problema reportado por el cliente *<textarea name="problema_reportado" rows={3} required maxLength={2000}/></label>
      </div>
      <div className="workshop-actions"><button className="installation-primary-link" disabled={busy}>{busy ? 'Guardando…' : 'Guardar e imprimir orden'}</button></div>
    </form>}

    <div className="workshop-toolbar">
      <label>Buscar<input value={search} onChange={e => setSearch(e.target.value)} placeholder="Cliente, equipo, problema u orden"/></label>
      <label>Estado<select value={filter} onChange={e => setFilter(e.target.value)}><option value="activas">En proceso</option><option value="todas">Todas las órdenes</option>{STAGES.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <button className="workshop-secondary" onClick={() => { void load().then(ok => { if (ok) toast.info('Lista de órdenes actualizada.'); }); }}>Actualizar</button>
    </div>

    <div className="workshop-list">
      {orders.map(o => <article className="workshop-order" key={o.id}>
        <div className="workshop-order-top">
          <div>
            <span className="workshop-order-number">ORDEN #{String(o.numero).padStart(5, '0')}</span>
            <h2>{o.equipo}{o.marca ? ` · ${o.marca}` : ''}{o.modelo ? ` ${o.modelo}` : ''}</h2>
            <p>{o.cliente_nombre} · {o.cliente_telefono}</p>
          </div>
          <span className={`workshop-badge status-${o.estado}`}>{stageLabel(o.estado)}</span>
        </div>
        <div className="workshop-order-summary">
          <div><small>Recibido</small><b>{date(o.creado_en)}</b></div>
          <div><small>Problema reportado</small><b>{o.problema_reportado}</b></div>
          <div><small>Monto cobrado</small><b>{money(o.monto_cobrado)}</b></div>
        </div>
        <section className="workshop-order-body">
          <div className="workshop-section-title"><span>✎</span><div><h3>Datos de la orden</h3><p>Diagnóstico, trabajo realizado, estado y monto cobrado.</p></div></div>
          <div className="workshop-detail-grid workshop-detail-grid--simple">
            <label className="workshop-span">Diagnóstico<textarea id={`diag-${o.id}`} defaultValue={o.diagnostico || ''} rows={3}/></label>
            <label className="workshop-span">Trabajo realizado<textarea id={`trabajo-${o.id}`} defaultValue={o.trabajo_realizado || ''} rows={3}/></label>
            <label>Estado<select id={`estado-${o.id}`} defaultValue={o.estado}>{stateOptions(o.estado).map(key => <option value={key} key={key}>{stageLabel(key)}</option>)}</select></label>
            <label>Monto cobrado (Q)<input id={`cobrado-${o.id}`} type="number" min="0" step="0.01" defaultValue={o.monto_cobrado ?? 0}/></label>
          </div>
          <div className="workshop-actions"><button className="installation-primary-link" disabled={busy} onClick={() => void saveOrder(o.id)}>Guardar orden</button></div>
        </section>
      </article>)}
      {!orders.length && <div className="workshop-empty"><b>No hay órdenes que mostrar.</b><span>Recibe un equipo o cambia los filtros de búsqueda.</span></div>}
    </div>

    {printReceipt && (() => {
      const field = (label: string, value: string | null | undefined) => <div><small>{label}</small><b>{value?.trim() || 'No especificado'}</b></div>;
      return <section className="workshop-print-receipt">
        <header className="print-receipt-head">
          <span className="print-receipt-logo">C</span>
          <div><b>Compusystem</b><small>SERVICIO TÉCNICO · TALLER</small></div>
          <span className="print-receipt-number">ORDEN #{String(printReceipt.numero).padStart(5, '0')}</span>
        </header>
        <h1>Orden de recepción</h1>
        <p className="print-receipt-date">Fecha de recepción: {date(printReceipt.creado_en)}</p>
        <div className="print-receipt-grid">
          {field('Cliente', printReceipt.cliente_nombre)}
          {field('Teléfono', printReceipt.cliente_telefono)}
          {field('Equipo', [printReceipt.equipo, printReceipt.marca, printReceipt.modelo].filter(Boolean).join(' · '))}
          {field('Número de serie', printReceipt.serie)}
          {field('Accesorios recibidos', printReceipt.accesorios)}
          {field('Técnico asignado', printReceipt.tecnico)}
          {field('Garantía (días)', String(printReceipt.garantia_dias ?? 30))}
          {field('Condición visible al recibir', printReceipt.condicion_recepcion)}
          {field('Problema reportado', printReceipt.problema_reportado)}
        </div>
        <footer>Presente este número de orden para consultar el estado del equipo.</footer>
      </section>;
    })()}
  </div>;
}
