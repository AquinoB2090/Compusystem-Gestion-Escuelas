'use client';

import { useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { buildClientStatementPdf } from '@/lib/clientStatementPdf';
import {
  REPORT_TYPES,
  reportTypeLabel,
  validateStatementOptions,
  type ReportType,
} from '@/lib/clientStatement';
import { toast } from './Toaster';

type Client = { id: number; nombre: string; telefono: string | null; activo: boolean };
type Movement = {
  id: number;
  cliente_id: number;
  fecha: string;
  descripcion: string;
  cantidad: number;
  unidad: 'fotocopias' | 'quetzales';
  creado_en?: string | null;
};
type Payment = {
  id: number;
  cliente_id: number;
  fecha: string;
  descripcion: string;
  monto: number;
  creado_en?: string | null;
};
type ReportFile = { archivo: string; tipo: ReportType; fecha: string; hora: string };
type ReportsStatus = 'loading' | 'ready' | 'error';

const money = (value: number) =>
  `Q ${Number(value || 0).toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const currentMonthValue = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
};

const firstDayOfMonth = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
};

const todayValue = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};

export default function AdminClients() {
  const db = useMemo(() => createClient(), []);
  const [summaryMonth, setSummaryMonth] = useState(currentMonthValue);
  const [clients, setClients] = useState<Client[]>([]);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setErrorState] = useState('');
  const [notice, setNoticeState] = useState('');

  const [reportTarget, setReportTarget] = useState<Client | null>(null);
  const [reportType, setReportType] = useState<ReportType>('desde_ultimo_abono');
  const [reportFrom, setReportFrom] = useState(firstDayOfMonth);
  const [reportTo, setReportTo] = useState(todayValue);
  const [reportBusy, setReportBusy] = useState(false);
  const [reportsByClient, setReportsByClient] = useState<Record<number, ReportFile[]>>({});
  const [reportsStatus, setReportsStatus] = useState<Record<number, ReportsStatus>>({});

  const setError = (message: string) => {
    setErrorState(message);
    if (message) toast.error(message);
  };
  const setNotice = (message: string) => {
    setNoticeState(message);
    if (message) toast.success(message);
  };

  async function load() {
    const [clientsResult, movementsResult, paymentsResult] = await Promise.all([
      db.from('clientes_individuales').select('id,nombre,telefono,activo').eq('activo', true).order('nombre'),
      db.from('consumos_clientes')
        .select('id,cliente_id,fecha,descripcion,cantidad,unidad,creado_en')
        .order('fecha', { ascending: false })
        .order('creado_en', { ascending: false }),
      db.from('liquidaciones_clientes')
        .select('id,cliente_id,fecha,descripcion,monto,creado_en')
        .order('fecha', { ascending: false })
        .order('creado_en', { ascending: false }),
    ]);

    if (clientsResult.error || movementsResult.error || paymentsResult.error) {
      setError('No se pudieron cargar los datos. Aplica las migraciones de clientes y liquidaciones.');
      return;
    }
    setClients(clientsResult.data || []);
    setMovements(movementsResult.data || []);
    setPayments(paymentsResult.data || []);
  }

  async function loadReports(clientId: number) {
    setReportsStatus((previous) => ({ ...previous, [clientId]: 'loading' }));
    try {
      const response = await fetch(`/api/clientes/reportes?cliente_id=${clientId}`, { cache: 'no-store' });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'No se pudo leer el historial de reportes.');
      setReportsByClient((previous) => ({ ...previous, [clientId]: result.reports || [] }));
      setReportsStatus((previous) => ({ ...previous, [clientId]: 'ready' }));
    } catch (loadError) {
      setReportsByClient((previous) => ({ ...previous, [clientId]: [] }));
      setReportsStatus((previous) => ({ ...previous, [clientId]: 'error' }));
      setError(loadError instanceof Error ? loadError.message : 'No se pudo leer el historial de reportes.');
    }
  }

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (selected) void loadReports(selected);
  }, [selected]);

  function openReportDialog(client: Client) {
    setReportTarget(client);
    setReportType('desde_ultimo_abono');
    setReportFrom(firstDayOfMonth());
    setReportTo(todayValue());
    setErrorState('');
  }

  async function generateReport() {
    const client = reportTarget;
    if (!client) return;

    const clientMovements = movements.filter((row) => row.cliente_id === client.id);
    const clientPayments = payments.filter((row) => row.cliente_id === client.id);
    if (!clientMovements.length && !clientPayments.length) {
      setError('Este cliente todavía no tiene movimientos para incluir en el reporte.');
      return;
    }

    const validation = validateStatementOptions({
      reportType,
      from: reportType === 'rango' ? reportFrom : null,
      to: reportType === 'rango' ? reportTo : null,
    });
    if (validation) {
      setError(validation);
      return;
    }

    setReportBusy(true);
    setErrorState('');
    try {
      const generated = await buildClientStatementPdf({
        clientName: client.nombre,
        phone: client.telefono,
        movements: clientMovements,
        payments: clientPayments,
        reportType,
        from: reportType === 'rango' ? reportFrom : null,
        to: reportType === 'rango' ? reportTo : null,
      });

      // Se descarga de inmediato, aunque falle el guardado en el historial.
      const blob = generated.pdf.output('blob');
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = generated.filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1500);

      try {
        const response = await fetch(
          `/api/clientes/reportes?cliente_id=${client.id}&tipo=${reportType}&archivo=${encodeURIComponent(generated.filename)}`,
          { method: 'POST', headers: { 'Content-Type': 'application/pdf' }, body: blob },
        );
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || 'No se pudo guardar el reporte en el historial.');
        setNotice('Reporte PDF generado y guardado en el historial.');
        setReportTarget(null);
        await loadReports(client.id);
      } catch (uploadError) {
        setError(
          `El PDF se descargó, pero no se pudo guardar en el historial. ${uploadError instanceof Error ? uploadError.message : ''}`.trim(),
        );
        setReportTarget(null);
      }
    } catch (generateError) {
      setError(generateError instanceof Error ? generateError.message : 'No se pudo generar el estado de cuenta.');
    } finally {
      setReportBusy(false);
    }
  }

  async function deleteReport(clientId: number, archivo: string) {
    if (!window.confirm('¿Eliminar este reporte PDF? Esta acción no se puede deshacer.')) return;
    try {
      const response = await fetch(
        `/api/clientes/reportes/${encodeURIComponent(archivo)}?cliente_id=${clientId}`,
        { method: 'DELETE' },
      );
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'No se pudo eliminar el reporte.');
      setNotice('Reporte eliminado.');
      await loadReports(clientId);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'No se pudo eliminar el reporte.');
    }
  }

  async function createNewClient(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setBusy(true);
    setError('');
    setNotice('');
    const response = await fetch('/api/usuarios', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nombre: String(data.get('nombre')),
        usuario: String(data.get('usuario')),
        password: String(data.get('password')),
        rol: 'cliente',
        crear_cliente: true,
        cliente_nombre: String(data.get('nombre')),
        telefono: String(data.get('telefono') || ''),
      }),
    });
    const result = await response.json();
    setBusy(false);
    if (!response.ok) {
      setError(result.error || 'No se pudo crear el cliente y su acceso.');
      return;
    }
    form.reset();
    setNotice(`Cliente y cuenta creados. Usuario: ${result.usuario}. Anota la contraseña; no se podrá volver a consultar.`);
    await load();
  }

  async function saveMovement(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const unidad = String(data.get('unidad')) as Movement['unidad'];
    const cantidad = Number(data.get('cantidad'));
    if (cantidad <= 0 || !Number.isFinite(cantidad) || (unidad === 'fotocopias' && !Number.isInteger(cantidad))) {
      setError('Cantidad inválida para la unidad seleccionada.');
      return;
    }
    setBusy(true);
    setError('');
    const { error: insertError } = await db.from('consumos_clientes').insert({
      cliente_id: selected,
      fecha: data.get('fecha'),
      descripcion: String(data.get('descripcion') || ''),
      cantidad,
      unidad,
    });
    setBusy(false);
    if (insertError) {
      setError(insertError.message);
      return;
    }
    form.reset();
    setNotice('Consumo registrado.');
    await load();
  }

  async function liquidate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const monto = Number(data.get('monto'));
    if (monto <= 0 || !Number.isFinite(monto)) {
      setError('Escribe un monto válido.');
      return;
    }
    setBusy(true);
    const { error: insertError } = await db.from('liquidaciones_clientes').insert({
      cliente_id: selected,
      fecha: data.get('fecha'),
      monto,
      descripcion: String(data.get('descripcion') || 'Liquidación'),
    });
    setBusy(false);
    if (insertError) {
      setError(insertError.message);
      return;
    }
    form.reset();
    setNotice('Liquidación registrada y descontada de la deuda.');
    await load();
  }

  async function editClientMovement(kind: 'consumo' | 'liquidacion', item: Movement | Payment) {
    const isConsumption = kind === 'consumo';
    const row = item as Movement | Payment;
    const fecha = window.prompt('Fecha (AAAA-MM-DD):', row.fecha);
    if (fecha === null || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return;
    const descripcion = window.prompt('Descripción:', row.descripcion);
    if (descripcion === null || !descripcion.trim()) return;

    let values: Record<string, unknown>;
    if (isConsumption) {
      const consumption = item as Movement;
      const amount = Number(window.prompt(
        consumption.unidad === 'fotocopias' ? 'Cantidad de fotocopias:' : 'Cantidad en quetzales:',
        String(consumption.cantidad),
      ));
      if (!Number.isFinite(amount) || amount <= 0 || (consumption.unidad === 'fotocopias' && !Number.isInteger(amount))) {
        setError('Ingresa una cantidad válida.');
        return;
      }
      values = { fecha, descripcion: descripcion.trim(), cantidad: amount };
    } else {
      const amount = Number(window.prompt('Monto pagado en quetzales:', String((item as Payment).monto)));
      if (!Number.isFinite(amount) || amount <= 0) {
        setError('Ingresa un monto válido.');
        return;
      }
      values = { fecha, descripcion: descripcion.trim(), monto: amount };
    }

    setBusy(true);
    setError('');
    const result = await db
      .from(isConsumption ? 'consumos_clientes' : 'liquidaciones_clientes')
      .update(values)
      .eq('id', row.id);
    setBusy(false);
    if (result.error) {
      setError(result.error.message);
      return;
    }
    setNotice('Movimiento actualizado.');
    await load();
  }

  async function deleteClientMovement(kind: 'consumo' | 'liquidacion', id: number) {
    if (!window.confirm('¿Eliminar este movimiento? Esta acción no se puede deshacer.')) return;
    setBusy(true);
    setError('');
    const result = await db
      .from(kind === 'consumo' ? 'consumos_clientes' : 'liquidaciones_clientes')
      .delete()
      .eq('id', id);
    setBusy(false);
    if (result.error) {
      setError(result.error.message);
      return;
    }
    setNotice('Movimiento eliminado.');
    await load();
  }

  const qEquivalent = (rows: Movement[]) =>
    rows.reduce((sum, row) => sum + (row.unidad === 'quetzales' ? Number(row.cantidad) : Number(row.cantidad) / 4), 0);

  const nextMonth = (() => {
    const [year, month] = summaryMonth.split('-').map(Number);
    return `${month === 12 ? year + 1 : year}-${String(month === 12 ? 1 : month + 1).padStart(2, '0')}-01`;
  })();
  const inMonth = (date: string) => date >= `${summaryMonth}-01` && date < nextMonth;
  const monthlyPayments = payments.filter((row) => inMonth(row.fecha));
  const monthlyPaid = monthlyPayments.reduce((sum, row) => sum + Number(row.monto), 0);
  const totalPending = clients.reduce(
    (sum, client) => sum + Math.max(
      0,
      qEquivalent(movements.filter((row) => row.cliente_id === client.id))
        - payments.filter((row) => row.cliente_id === client.id).reduce((paid, row) => paid + Number(row.monto), 0),
    ),
    0,
  );
  const visible = clients.filter((client) =>
    client.nombre.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()),
  );
  const current = clients.find((client) => client.id === selected);
  const monthLabel = new Intl.DateTimeFormat('es-GT', { month: 'long', year: 'numeric' }).format(
    new Date(Number(summaryMonth.slice(0, 4)), Number(summaryMonth.slice(5, 7)) - 1, 1),
  );

  const movementRow = (row: Movement) => (
    <tr key={`m${row.id}`}>
      <td>{row.fecha}</td>
      <td>{row.descripcion}</td>
      <td>Consumo</td>
      <td>
        {money(row.unidad === 'fotocopias' ? Number(row.cantidad) / 4 : Number(row.cantidad))}
        {row.unidad === 'fotocopias' ? ` · ${row.cantidad} copias` : ''}
      </td>
      <td>
        <div className="movement-actions">
          <button className="button secondary small" disabled={busy} onClick={() => editClientMovement('consumo', row)}>Editar</button>
          <button className="button danger small" disabled={busy} onClick={() => deleteClientMovement('consumo', row.id)}>Eliminar</button>
        </div>
      </td>
    </tr>
  );

  const paymentRow = (row: Payment) => (
    <tr key={`p${row.id}`}>
      <td>{row.fecha}</td>
      <td>{row.descripcion}</td>
      <td>Liquidación</td>
      <td>− {money(Number(row.monto))}</td>
      <td>
        <div className="movement-actions">
          <button className="button secondary small" disabled={busy} onClick={() => editClientMovement('liquidacion', row)}>Editar</button>
          <button className="button danger small" disabled={busy} onClick={() => deleteClientMovement('liquidacion', row.id)}>Eliminar</button>
        </div>
      </td>
    </tr>
  );

  return (
    <>
      {error && <div className="alert error">{error}<button onClick={() => setError('')}>×</button></div>}
      {notice && <div className="alert success">{notice}<button onClick={() => setNotice('')}>×</button></div>}

      <section className="stats">
        <div className="stat-card">
          <div className="stat-top"><span>Ya pagado</span><span className="stat-icon green">Q</span></div>
          <strong>{money(monthlyPaid)}</strong>
          <small>{monthLabel}</small>
        </div>
        <div className="stat-card">
          <div className="stat-top"><span>Deuda total pendiente</span><span className="stat-icon orange">Q</span></div>
          <strong>{money(totalPending)}</strong>
          <small>Todos los meses</small>
        </div>
      </section>

      <div className="section-head">
        <div><h2>Resumen por cliente</h2><p>Pagos de {monthLabel} y deuda pendiente total</p></div>
        <label className="report-filter">Mes<input type="month" value={summaryMonth} onChange={(event) => setSummaryMonth(event.target.value)} /></label>
      </div>
      <div className="table-card">
        <table>
          <thead><tr><th>CLIENTE</th><th>YA PAGADO</th><th>PENDIENTE TOTAL</th></tr></thead>
          <tbody>
            {clients.map((client) => {
              const clientPayments = monthlyPayments.filter((row) => row.cliente_id === client.id);
              const allMovements = movements.filter((row) => row.cliente_id === client.id);
              const allPayments = payments.filter((row) => row.cliente_id === client.id);
              const paid = clientPayments.reduce((sum, row) => sum + Number(row.monto), 0);
              const pending = Math.max(
                0,
                qEquivalent(allMovements) - allPayments.reduce((sum, row) => sum + Number(row.monto), 0),
              );
              return (
                <tr key={client.id}>
                  <td>{client.nombre}</td>
                  <td>{money(paid)}</td>
                  <td>{money(pending)}</td>
                </tr>
              );
            })}
            {!clients.length && <tr><td className="empty" colSpan={3}>No hay clientes individuales registrados.</td></tr>}
          </tbody>
        </table>
      </div>

      <section className="form-card">
        <div className="form-heading">
          <span className="form-icon blue">+</span>
          <div><h2>Nuevo cliente y acceso</h2><p>La contraseña se muestra solo al crearla; después puede restablecerse en Usuarios.</p></div>
        </div>
        <form className="data-form" onSubmit={createNewClient}>
          <label>Nombre<input name="nombre" required /></label>
          <label>Teléfono<input name="telefono" type="tel" /></label>
          <label>Usuario<input name="usuario" required minLength={3} pattern="[a-zA-Z0-9._-]+" /></label>
          <label>Contraseña<input name="password" type="password" required minLength={8} /></label>
          <div className="form-actions wide"><button className="button primary" disabled={busy}>Crear cliente y usuario</button></div>
        </form>
      </section>

      <div className="section-head">
        <div><h2>Cuentas y deudas</h2><p>Consumo equivalente en Q menos liquidaciones registradas.</p></div>
        <label className="search">
          <span>⌕</span>
          <input placeholder="Buscar cliente..." value={search} onChange={(event) => setSearch(event.target.value)} />
        </label>
      </div>

      <div className="client-list">
        {visible.map((client) => {
          const clientMovements = movements.filter((row) => row.cliente_id === client.id);
          const clientPayments = payments.filter((row) => row.cliente_id === client.id);
          const used = qEquivalent(clientMovements);
          const paid = clientPayments.reduce((sum, row) => sum + Number(row.monto), 0);
          const copies = clientMovements
            .filter((row) => row.unidad === 'fotocopias')
            .reduce((sum, row) => sum + Number(row.cantidad), 0);
          const reports = reportsByClient[client.id] || [];
          const reportsState = reportsStatus[client.id];

          return (
            <article className={`client-card ${selected === client.id ? 'selected' : ''}`} key={client.id}>
              <div className="client-card-head">
                <div className="school-card-content">
                  <b>{client.nombre}</b>
                  <small>
                    {client.telefono || 'Cliente individual'} · {clientMovements.length} consumos · {clientPayments.length} liquidaciones
                  </small>
                </div>
                <div className="client-card-actions">
                  <button
                    className="button secondary small"
                    disabled={reportBusy && reportTarget?.id === client.id}
                    onClick={() => openReportDialog(client)}
                  >
                    Descargar PDF
                  </button>
                  <button className="button secondary small" onClick={() => setSelected(selected === client.id ? null : client.id)}>
                    {selected === client.id ? 'Cerrar' : 'Ver cuenta'}
                  </button>
                </div>
              </div>

              <div className="client-counters">
                <div className="client-metric client-debt"><span>Deuda pendiente</span><strong>{money(used - paid)}</strong></div>
                <div className="client-metric"><span>Consumo acumulado</span><strong>{money(used)}</strong></div>
                <div className="client-metric"><span>Total pagado</span><strong>{money(paid)}</strong></div>
                <div className="client-copy-count">{copies.toLocaleString('es-GT')} fotocopias</div>
              </div>

              {selected === client.id && (
                <>
                  <div className="client-layout">
                    <form className="client-consumption-form" onSubmit={saveMovement}>
                      <h3>Registrar consumo</h3>
                      <label>Fecha<input type="date" name="fecha" required defaultValue={todayValue()} /></label>
                      <label>Descripción<input name="descripcion" required /></label>
                      <label>Cantidad<input type="number" name="cantidad" min="0.01" step="0.01" required /></label>
                      <label>Unidad<select name="unidad"><option value="fotocopias">Fotocopias</option><option value="quetzales">Quetzales</option></select></label>
                      <button className="button primary" disabled={busy}>Guardar consumo</button>
                    </form>
                    <form className="client-consumption-form" onSubmit={liquidate}>
                      <h3>Registrar liquidación</h3>
                      <label>Fecha<input type="date" name="fecha" required defaultValue={todayValue()} /></label>
                      <label>Descripción<input name="descripcion" defaultValue="Liquidación" /></label>
                      <label>Monto pagado<input type="number" name="monto" min="0.01" step="0.01" required /></label>
                      <button className="button primary" disabled={busy}>Guardar liquidación</button>
                    </form>
                  </div>

                  <section className="table-card client-history">
                    <div className="table-title">Movimientos de {client.nombre}</div>
                    <table>
                      <thead><tr><th>FECHA</th><th>DETALLE</th><th>TIPO</th><th>IMPORTE</th><th>ACCIONES</th></tr></thead>
                      <tbody>
                        {clientMovements.map(movementRow)}
                        {clientPayments.map(paymentRow)}
                        {!clientMovements.length && !clientPayments.length && (
                          <tr><td className="empty" colSpan={5}>Sin movimientos registrados.</td></tr>
                        )}
                      </tbody>
                    </table>
                  </section>

                  <section className="report-history">
                    <div className="report-history-head">
                      <div>
                        <h3>Historial de reportes</h3>
                        <p>PDF guardados de este cliente, del más reciente al más antiguo.</p>
                      </div>
                      <button
                        className="button secondary small"
                        disabled={reportsState === 'loading'}
                        onClick={() => void loadReports(client.id)}
                      >
                        Actualizar
                      </button>
                    </div>

                    {(!reportsState || reportsState === 'loading') && <p className="muted">Cargando reportes...</p>}
                    {reportsState === 'error' && <p className="muted">No se pudo cargar el historial de reportes.</p>}
                    {reportsState === 'ready' && !reports.length && <p className="muted">Sin reportes generados.</p>}
                    {reportsState === 'ready' && reports.length > 0 && (
                      <ul className="report-history-list">
                        {reports.map((report) => (
                          <li key={report.archivo}>
                            <div className="report-history-info">
                              <b>{reportTypeLabel(report.tipo)}</b>
                              <small>{report.fecha} · {report.hora}</small>
                            </div>
                            <div className="report-history-actions">
                              <a
                                className="button secondary small"
                                href={`/api/clientes/reportes/${encodeURIComponent(report.archivo)}?cliente_id=${client.id}`}
                                target="_blank"
                                rel="noreferrer"
                              >
                                Ver/Descargar
                              </a>
                              <button className="button danger small" onClick={() => void deleteReport(client.id, report.archivo)}>
                                Eliminar
                              </button>
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                </>
              )}
            </article>
          );
        })}
        {!visible.length && <div className="empty school-empty">No hay clientes para mostrar.</div>}
      </div>

      {current && <p className="muted">Saldo calculado en quetzales, a Q 0.25 por fotocopia.</p>}

      {reportTarget && (
        <div
          className="modal-backdrop"
          role="presentation"
          onClick={(event) => {
            if (event.target === event.currentTarget && !reportBusy) setReportTarget(null);
          }}
        >
          <div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="report-dialog-title">
            <div className="modal-head">
              <div>
                <h2 id="report-dialog-title">Generar estado de cuenta</h2>
                <p>{reportTarget.nombre}</p>
              </div>
              <button className="modal-close" aria-label="Cerrar" disabled={reportBusy} onClick={() => setReportTarget(null)}>×</button>
            </div>

            <label className="modal-field">
              Tipo de reporte
              <select value={reportType} onChange={(event) => setReportType(event.target.value as ReportType)}>
                {REPORT_TYPES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
            </label>

            {reportType === 'rango' && (
              <div className="modal-range">
                <label className="modal-field">Desde<input type="date" value={reportFrom} onChange={(event) => setReportFrom(event.target.value)} /></label>
                <label className="modal-field">Hasta<input type="date" value={reportTo} onChange={(event) => setReportTo(event.target.value)} /></label>
              </div>
            )}

            <p className="modal-note">
              El PDF se guardará en el historial del cliente. En “Desde el último abono” el saldo anterior se calcula con todo el historial y solo se muestran el último abono y los movimientos posteriores.
            </p>

            <div className="modal-actions">
              <button className="button secondary" disabled={reportBusy} onClick={() => setReportTarget(null)}>Cancelar</button>
              <button className="button primary" disabled={reportBusy} onClick={() => void generateReport()}>
                {reportBusy ? 'Generando...' : 'Generar y descargar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
