'use client';

import { useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

type PriceRow = {
  precio_id: number; categoria: string; producto_id: number; marca: string | null; modelo: string | null; nombre: string;
  especificaciones: Record<string, unknown> | null; proveedor: string | null; tipo: 'lista' | 'promocion'; precio: number;
  moneda: 'GTQ' | 'USD'; incluye_iva: boolean | null; vigente_desde: string; vigente_hasta: string | null;
  dias_restantes: number | null; condiciones: string | null; documento_id: number | null; es_mejor_precio: boolean; costo_compra: number | null; precio_configurado: boolean;
};
type HistoryRow = { precio_id: number; precio: number | null; costo_compra: number | null; moneda: 'GTQ' | 'USD'; proveedor: string | null; tipo: string; incluye_iva: boolean | null; vigente_desde: string; vigente_hasta: string | null; condiciones: string | null; documento_id: number | null };
type Choice = { id: number; nombre: string };

const currency = (amount: number, code: 'GTQ' | 'USD') => new Intl.NumberFormat('es-GT', { style: 'currency', currency: code }).format(Number(amount));
const date = (value: string) => new Intl.DateTimeFormat('es-GT', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(`${value}T12:00:00`));
const ageInDays = (value: string) => Math.floor((new Date().setHours(0, 0, 0, 0) - new Date(`${value}T12:00:00`).getTime()) / 86400000);

export default function PricesCatalog({ role }: { role: 'admin' | 'ventas' }) {
  const supabase = useMemo(() => createClient(), []);
  const [rows, setRows] = useState<PriceRow[]>([]);
  const [categories, setCategories] = useState<Choice[]>([]);
  const [providers, setProviders] = useState<Choice[]>([]);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [provider, setProvider] = useState('');
  const [promotionsOnly, setPromotionsOnly] = useState(false);
  const [selected, setSelected] = useState<PriceRow | null>(null);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [documents, setDocuments] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState(true);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [error, setError] = useState('');

  async function load() {
    setLoading(true); setError('');
    const [priceResult, categoryResult, providerResult] = await Promise.all([
      supabase.from('panel_precios').select('*').order('nombre').order('precio'),
      supabase.from('categorias').select('id,nombre').order('nombre'),
      supabase.from('proveedores').select('id,nombre').eq('activo', true).order('nombre'),
    ]);
    if (priceResult.error) setError('No se pudieron cargar los precios. Verifica tu acceso e inténtalo otra vez.');
    else setRows((priceResult.data || []) as PriceRow[]);
    if (!categoryResult.error) setCategories(categoryResult.data || []);
    if (!providerResult.error) setProviders(providerResult.data || []);
    setLoading(false);
  }
  useEffect(() => { setPromotionsOnly(new URLSearchParams(window.location.search).get('promociones') === '1'); void load(); }, []);

  const visibleRows = rows.filter((row) => {
    const term = search.trim().toLocaleLowerCase('es-GT');
    const text = [row.marca, row.modelo, row.nombre].filter(Boolean).join(' ').toLocaleLowerCase('es-GT');
    return (!term || text.includes(term)) && (!category || row.categoria === category) && (!provider || row.proveedor === provider) && (!promotionsOnly || row.tipo === 'promocion');
  });

  async function openProduct(row: PriceRow) {
    setSelected(row); setHistory([]); setHistoryLoading(true); setError('');
    const result = await supabase.from('historial_precios').select('precio_id,precio,costo_compra,moneda,proveedor,tipo,incluye_iva,vigente_desde,vigente_hasta,condiciones,documento_id')
      .eq('producto_id', row.producto_id).order('vigente_desde', { ascending: false });
    if (result.error) setError('No se pudo cargar el historial de este producto.');
    else {
      const items = (result.data || []) as HistoryRow[];
      setHistory(items);
      const documentIds = role === 'admin' ? Array.from(new Set(items.map((item) => item.documento_id).filter((id): id is number => id !== null))) : [];
      if (documentIds.length) {
        const { data } = await supabase.from('documentos').select('id,storage_path').in('id', documentIds);
        const paths = new Map((data || []).map((document) => [document.id, document.storage_path]));
        const links: Record<number, string> = {};
        for (const id of documentIds) {
          const path = paths.get(id);
          if (!path) continue;
          const { data: signed } = await supabase.storage.from('documentos-precios').createSignedUrl(path, 60);
          if (signed?.signedUrl) links[id] = signed.signedUrl;
        }
        setDocuments((current) => ({ ...current, ...links }));
      }
    }
    setHistoryLoading(false);
  }

  return <div className="installation-page">
    <div className="installation-page-heading"><div><span className="installation-eyebrow">CATÁLOGO</span><h1>Precios</h1><p>Consulta precios vigentes y compara opciones por proveedor.</p></div></div>
    <section className="price-toolbar" aria-label="Filtros de precios">
      <label className="price-search">Buscar producto<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Marca, modelo o nombre" /></label>
      <label>Categoría<select value={category} onChange={(event) => setCategory(event.target.value)}><option value="">Todas</option>{categories.map((item) => <option value={item.nombre} key={item.id}>{item.nombre}</option>)}</select></label>
      <label>Proveedor<select value={provider} onChange={(event) => setProvider(event.target.value)}><option value="">Todos</option>{providers.map((item) => <option value={item.nombre} key={item.id}>{item.nombre}</option>)}</select></label>
      <label className="price-promo-toggle"><input type="checkbox" checked={promotionsOnly} onChange={(event) => setPromotionsOnly(event.target.checked)} /> Solo promociones</label>
    </section>
    {error && <div className="installation-alert" role="alert">{error} <button className="price-retry" onClick={() => selected ? void openProduct(selected) : void load()}>Reintentar</button></div>}
    {loading ? <div className="price-empty">Cargando precios…</div> : !visibleRows.length ? <div className="price-empty"><b>{rows.length ? 'No encontramos resultados' : 'Aún no hay precios publicados'}</b><span>{rows.length ? 'Prueba con otros filtros.' : 'Los precios aprobados aparecerán aquí.'}</span></div> : <div className="price-grid">
      {visibleRows.map((row) => {
        const stale = !row.vigente_hasta && ageInDays(row.vigente_desde) > 60;
        return <button className={`price-card ${stale ? 'price-card-stale' : ''}`} key={row.precio_id} onClick={() => void openProduct(row)}>
          <span className="price-card-top"><span>{row.categoria}</span>{row.tipo === 'promocion' && <span className="price-promo-badge">Promoción</span>}</span>
          <b className="price-product-name">{[row.marca, row.modelo].filter(Boolean).join(' ') || row.nombre}</b>
          {row.nombre !== [row.marca, row.modelo].filter(Boolean).join(' ') && <span className="price-product-description">{row.nombre}</span>}
          <span className="price-amount">{row.precio_configurado ? currency(row.precio, row.moneda) : 'Margen pendiente'}</span>
          {row.costo_compra !== null && <span className="price-cost">Costo de compra: {currency(row.costo_compra, row.moneda)}</span>}
          <span className="price-provider">{row.proveedor || 'Proveedor sin especificar'}</span>
          <span className="price-badges">{row.es_mejor_precio && <span className="price-best">Mejor precio</span>}{row.dias_restantes !== null && row.dias_restantes >= 0 && <span className={`price-expiry ${row.dias_restantes <= 3 ? 'urgent' : ''}`}>Vence en {row.dias_restantes} {row.dias_restantes === 1 ? 'día' : 'días'}</span>}{row.incluye_iva !== null && <span className="price-tax">{row.incluye_iva ? 'Incluye IVA' : 'Más IVA'}</span>}</span>
          {stale && <small className="price-stale-note">Actualizado hace {ageInDays(row.vigente_desde)} días</small>}
          <span className="price-card-link">Ver historial <span>→</span></span>
        </button>;
      })}
    </div>}
    {!loading && rows.length > 0 && <p className="price-result-count">{visibleRows.length} {visibleRows.length === 1 ? 'resultado' : 'resultados'}</p>}
    {selected && <div className="price-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelected(null); }}><section className="price-modal" role="dialog" aria-modal="true" aria-labelledby="price-modal-title">
      <button className="price-modal-close" aria-label="Cerrar" onClick={() => setSelected(null)}>×</button><span className="installation-eyebrow">HISTORIAL DEL PRODUCTO</span><h2 id="price-modal-title">{[selected.marca, selected.modelo].filter(Boolean).join(' ') || selected.nombre}</h2><p className="price-modal-subtitle">{selected.nombre} · {selected.categoria}</p>
      {historyLoading ? <div className="price-empty">Cargando historial…</div> : <div className="price-history-list">{history.map((item) => <article className="price-history-row" key={item.precio_id}><div>{item.precio !== null ? <b>{currency(item.precio, item.moneda)}</b> : <b>Margen pendiente</b>}{item.costo_compra !== null && <span>Costo de compra: {currency(item.costo_compra, item.moneda)}</span>}<span>{item.tipo === 'promocion' ? 'Promoción' : 'Precio de lista'}{item.incluye_iva !== null ? ` · ${item.incluye_iva ? 'Incluye IVA' : 'Más IVA'}` : ''}</span><small>{item.proveedor || 'Proveedor sin especificar'}</small><small>Vigente desde {date(item.vigente_desde)}{item.vigente_hasta ? ` hasta ${date(item.vigente_hasta)}` : ''}</small>{item.condiciones && <small>{item.condiciones}</small>}</div>{role === 'admin' && item.documento_id && documents[item.documento_id] && <a className="installation-primary-link" href={documents[item.documento_id]} target="_blank" rel="noreferrer">Ver documento original</a>}</article>)}{!history.length && <div className="price-empty">No hay historial disponible.</div>}</div>}
    </section></div>}
  </div>;
}
