'use client';

import { useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

type Client = { id: number; nombre: string; telefono: string | null; activo: boolean };
type ClientConsumption = { id: number; cliente_id: number; fecha: string; descripcion: string; cantidad: number; unidad: 'fotocopias' | 'quetzales' };
const money = (value: number) => `Q ${Number(value || 0).toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function AdminClients() {
  const supabase = useMemo(() => createClient(), []);
  const [clients, setClients] = useState<Client[]>([]);
  const [consumptions, setConsumptions] = useState<ClientConsumption[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function load() {
    const [clientResult, consumptionResult] = await Promise.all([
      supabase.from('clientes_individuales').select('id,nombre,telefono,activo').eq('activo', true).order('nombre'),
      supabase.from('consumos_clientes').select('id,cliente_id,fecha,descripcion,cantidad,unidad').order('fecha', { ascending: false }).limit(1000),
    ]);
    if (clientResult.error || consumptionResult.error) {
      setError('No se pudieron cargar los clientes. Aplica la migración de clientes individuales en Supabase.');
      return;
    }
    setClients((clientResult.data || []) as Client[]);
    setConsumptions((consumptionResult.data || []) as ClientConsumption[]);
  }

  useEffect(() => { void load(); }, []);

  async function addClient(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    setBusy(true); setError(''); setNotice('');
    const { error: insertError } = await supabase.from('clientes_individuales').insert({
      nombre: String(values.get('nombre') || '').trim(),
      telefono: String(values.get('telefono') || '').trim() || null,
    });
    setBusy(false);
    if (insertError) { setError(insertError.message); return; }
    form.reset();
    setNotice('Cliente individual agregado.');
    await load();
  }

  async function addConsumption(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedId) return;
    const form = event.currentTarget;
    const values = new FormData(form);
    const quantity = Number(values.get('cantidad'));
    const unit = String(values.get('unidad')) as 'fotocopias' | 'quetzales';
    if (!Number.isFinite(quantity) || quantity <= 0 || (unit === 'fotocopias' && !Number.isInteger(quantity))) {
      setError(unit === 'fotocopias' ? 'La cantidad de fotocopias debe ser un número entero.' : 'Escribe una cantidad mayor que cero.');
      return;
    }
    setBusy(true); setError(''); setNotice('');
    const { error: insertError } = await supabase.from('consumos_clientes').insert({
      cliente_id: selectedId,
      fecha: String(values.get('fecha')),
      descripcion: String(values.get('descripcion') || '').trim(),
      cantidad: quantity,
      unidad: unit,
    });
    setBusy(false);
    if (insertError) { setError(insertError.message); return; }
    form.reset();
    setNotice('Consumo registrado en el contador del cliente.');
    await load();
  }

  const visibleClients = clients.filter((client) => client.nombre.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  const copiesTotal = consumptions.filter((row) => row.unidad === 'fotocopias').reduce((sum, row) => sum + Number(row.cantidad || 0), 0);
  const quetzalesTotal = consumptions.filter((row) => row.unidad === 'quetzales').reduce((sum, row) => sum + Number(row.cantidad || 0), 0);
  const selected = clients.find((client) => client.id === selectedId);

  return <>
    <div className="welcome"><div><span className="eyebrow">PANEL DE ADMINISTRACIÓN</span><h1>Clientes individuales</h1><p>Registra clientes sin asignarles saldo y lleva el contador de lo que consumen.</p></div></div>
    {error && <div className="alert error">{error}<button onClick={() => setError('')}>×</button></div>}
    {notice && <div className="alert success">{notice}<button onClick={() => setNotice('')}>×</button></div>}
    <div className="stats client-stats">
      <div className="stat-card"><div className="stat-top"><span>Clientes activos</span><span className="stat-icon blue">♙</span></div><strong>{clients.length}</strong><small>Sin saldo asignado</small></div>
      <div className="stat-card"><div className="stat-top"><span>Fotocopias consumidas</span><span className="stat-icon orange">▤</span></div><strong>{copiesTotal.toLocaleString('es-GT')} fotocopias</strong><small>Contador acumulado</small></div>
      <div className="stat-card"><div className="stat-top"><span>Consumo en quetzales</span><span className="stat-icon green">Q</span></div><strong>{money(quetzalesTotal)}</strong><small>Contador acumulado</small></div>
    </div>
    <div className="client-layout">
      <section className="form-card client-create-card"><div className="form-heading"><span className="form-icon blue">+</span><div><h2>Agregar cliente</h2><p>El cliente tendrá un contador de consumo, sin saldo inicial.</p></div></div><form className="data-form single" onSubmit={addClient}><label>Nombre<input name="nombre" required placeholder="Nombre del cliente" /></label><label>Teléfono (opcional)<input name="telefono" type="tel" /></label><button className="button primary" disabled={busy}>Agregar cliente</button></form></section>
      <section className="client-list-section"><div className="section-head"><div><h2>Clientes</h2><p>{clients.length} registrados</p></div><label className="search"><span>⌕</span><input aria-label="Buscar cliente" placeholder="Buscar cliente..." value={search} onChange={(event) => setSearch(event.target.value)} /></label></div><div className="client-list">{visibleClients.map((client) => {
        const rows = consumptions.filter((row) => row.cliente_id === client.id);
        const copies = rows.filter((row) => row.unidad === 'fotocopias').reduce((sum, row) => sum + Number(row.cantidad || 0), 0);
        const quetzales = rows.filter((row) => row.unidad === 'quetzales').reduce((sum, row) => sum + Number(row.cantidad || 0), 0);
        return <article className={`client-card ${selectedId === client.id ? 'selected' : ''}`} key={client.id}><div className="client-card-head"><span className="school-card-icon">♙</span><div className="school-card-content"><b>{client.nombre}</b><small>{client.telefono || 'Cliente individual'}</small></div><button className="button primary small" onClick={() => setSelectedId(selectedId === client.id ? null : client.id)}>{selectedId === client.id ? 'Cerrar' : 'Registrar consumo'}</button></div><div className="client-counters"><span>{copies.toLocaleString('es-GT')} fotocopias</span><span>{money(quetzales)} en quetzales</span><b>{rows.length} consumos</b></div>{selectedId === client.id && <form className="client-consumption-form" onSubmit={addConsumption}><label>Fecha<input type="date" name="fecha" required defaultValue={new Date().toLocaleDateString('en-CA')} /></label><label>Descripción<input name="descripcion" required placeholder="Descripción del consumo" /></label><label>Cantidad<input type="number" name="cantidad" min="0.01" step="0.01" required /></label><label>Unidad<select name="unidad" defaultValue="fotocopias"><option value="fotocopias">Fotocopias</option><option value="quetzales">Quetzales</option></select></label><button className="button primary" disabled={busy}>Guardar consumo</button></form>}</article>;
      })}{!visibleClients.length && <div className="empty school-empty">{clients.length ? 'No se encontraron clientes con ese nombre.' : 'Agrega un cliente para comenzar el contador.'}</div>}</div></section>
    </div>
    {selected && <section className="table-card client-history"><div className="table-title">Historial de {selected.nombre}</div><table><thead><tr><th>FECHA</th><th>DESCRIPCIÓN</th><th>CANTIDAD</th></tr></thead><tbody>{consumptions.filter((row) => row.cliente_id === selected.id).map((row) => <tr key={row.id}><td>{row.fecha}</td><td>{row.descripcion}</td><td>{row.unidad === 'fotocopias' ? `${Number(row.cantidad).toLocaleString('es-GT')} fotocopias` : money(Number(row.cantidad))}</td></tr>)}{!consumptions.some((row) => row.cliente_id === selected.id) && <tr><td colSpan={3} className="empty">Aún no tiene consumos registrados.</td></tr>}</tbody></table></section>}
  </>;
}
