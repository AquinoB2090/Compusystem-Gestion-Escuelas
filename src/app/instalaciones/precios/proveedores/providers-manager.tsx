'use client';

import { useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

type Provider = { id: number; nombre: string; contacto: string | null; activo: boolean };
type MarginSetting = { margen_porcentaje: number | string | null };

export default function ProvidersManager() {
  const supabase = useMemo(() => createClient(), []);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [margin, setMargin] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function load() {
    setLoading(true);
    setError('');
    const [providerResult, marginResult] = await Promise.all([
      supabase.from('proveedores').select('id,nombre,contacto,activo').order('nombre'),
      supabase.from('configuracion_instalaciones').select('margen_porcentaje').eq('id', 1).maybeSingle(),
    ]);
    if (providerResult.error || marginResult.error) {
      setError('No se pudo cargar la configuracion de Instalaciones. Verifica la migracion de margen y vuelve a intentar.');
      setLoading(false);
      return;
    }
    setProviders((providerResult.data || []) as Provider[]);
    setMargin(marginResult.data?.margen_porcentaje == null ? '' : String(marginResult.data.margen_porcentaje));
    setLoading(false);
  }

  useEffect(() => { void load(); }, []);

  async function saveMargin(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const raw = String(form.get('margen_porcentaje') || '').trim();
    const value = raw === '' ? null : Number(raw);
    if (value !== null && (!Number.isFinite(value) || value < 0 || value > 9999.999)) {
      setError('El margen debe ser un porcentaje entre 0 y 9999.999, o quedar vacio para pausarlo.');
      return;
    }
    setBusy(true);
    setError('');
    setNotice('');
    const { data: { user } } = await supabase.auth.getUser();
    const { error: saveError } = await supabase.from('configuracion_instalaciones').update({
      margen_porcentaje: value,
      actualizado_en: new Date().toISOString(),
      actualizado_por: user?.id || null,
    }).eq('id', 1);
    setBusy(false);
    if (saveError) { setError('No se pudo guardar el margen global.'); return; }
    setMargin(value === null ? '' : String(value));
    setNotice(value === null ? 'Margen pausado. Ventas ya no vera precios hasta configurar uno.' : 'Margen global guardado; se recalcularon los precios de venta.');
  }

  async function saveProvider(event: React.FormEvent<HTMLFormElement>, provider?: Provider) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const nombre = String(data.get('nombre') || '').trim();
    const contacto = String(data.get('contacto') || '').trim() || null;
    if (!nombre) { setError('Escribe el nombre del proveedor.'); return; }
    setBusy(true);
    setError('');
    setNotice('');
    const result = provider
      ? await supabase.from('proveedores').update({ nombre, contacto }).eq('id', provider.id)
      : await supabase.from('proveedores').insert({ nombre, contacto });
    setBusy(false);
    if (result.error) {
      setError(result.error.code === '23505' ? 'Ya existe un proveedor con ese nombre.' : 'No se pudo guardar el proveedor.');
      return;
    }
    setNotice(provider ? 'Proveedor actualizado.' : 'Proveedor creado.');
    await load();
  }

  async function toggleProvider(provider: Provider) {
    const next = !provider.activo;
    setBusy(true);
    setError('');
    const { error: saveError } = await supabase.from('proveedores').update({ activo: next }).eq('id', provider.id);
    setBusy(false);
    if (saveError) { setError('No se pudo cambiar el estado del proveedor.'); return; }
    setNotice(next ? 'Proveedor activado.' : 'Proveedor desactivado.');
    await load();
  }

  return <div className="installation-page">
    <div className="installation-page-heading"><div><span className="installation-eyebrow">ADMINISTRACION</span><h1>Proveedores</h1><p>Administra proveedores y configuracion de precios.</p></div></div>
    {error && <div className="installation-alert" role="alert">{error}</div>}
    {notice && <div className="review-notice" role="status">{notice}</div>}
    <section className="provider-panel margin-setting-panel">
      <div className="provider-panel-heading"><div><h2>Margen global de venta</h2><p>Los datos de cotizacion se guardan como costo; a ventas solo se le muestra el costo mas este porcentaje.</p></div><span className={`document-status ${margin === '' ? 'status-error' : 'status-procesado'}`}>{margin === '' ? 'Pendiente' : 'Configurado'}</span></div>
      <form className="margin-setting-form" onSubmit={(event) => void saveMargin(event)}>
        <label>Porcentaje sobre costo<input name="margen_porcentaje" type="number" min="0" max="9999.999" step="0.001" value={margin} onChange={(event) => setMargin(event.target.value)} placeholder="Ej. 25" /></label>
        <button className="installation-primary-link" disabled={busy || loading}>{busy ? 'Guardando...' : 'Guardar margen'}</button>
        <small>Precio de venta = costo x (1 + porcentaje / 100). Dejalo vacio para ocultar precios a ventas.</small>
      </form>
    </section>
    <section className="provider-panel">
      <div className="provider-panel-heading"><div><h2>Proveedores</h2><p>Los proveedores desactivados no aparecen en los formularios nuevos.</p></div></div>
      <form className="provider-create-form" onSubmit={(event) => void saveProvider(event)}>
        <label>Nombre<input name="nombre" required maxLength={120} placeholder="Nombre de la empresa" /></label>
        <label>Contacto<input name="contacto" maxLength={160} placeholder="Nombre o datos de contacto" /></label>
        <button className="installation-primary-link" disabled={busy}>Agregar proveedor</button>
      </form>
      {loading ? <div className="price-empty">Cargando proveedores...</div> : <div className="provider-list">
        {providers.map((provider) => <article className={`provider-row ${provider.activo ? '' : 'provider-inactive'}`} key={provider.id}>
          <form className="provider-edit-form" onSubmit={(event) => void saveProvider(event, provider)}>
            <label>Proveedor<input name="nombre" required defaultValue={provider.nombre} maxLength={120} /></label>
            <label>Contacto<input name="contacto" defaultValue={provider.contacto || ''} maxLength={160} /></label>
            <button className="review-secondary" disabled={busy}>Guardar</button>
          </form>
          <span className={`document-status ${provider.activo ? 'status-procesado' : 'status-error'}`}>{provider.activo ? 'Activo' : 'Inactivo'}</span>
          <button className="review-secondary provider-toggle" disabled={busy} onClick={() => void toggleProvider(provider)}>{provider.activo ? 'Desactivar' : 'Activar'}</button>
        </article>)}
        {!providers.length && <div className="price-empty">Aun no hay proveedores registrados.</div>}
      </div>}
    </section>
  </div>;
}