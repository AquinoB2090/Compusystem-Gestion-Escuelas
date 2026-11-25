'use client';

import { useMemo, useRef, useState, type FormEvent } from 'react';
import { AlignmentType, BorderStyle, Document, Packer, Paragraph, ShadingType, Table, TableCell, TableRow, TextRun, WidthType } from 'docx';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/client';

type ChatMessage = { role: 'user' | 'assistant'; content: string };
type QuoteItem = {
  precio_id: number;
  producto_id: number;
  categoria: string;
  descripcion: string;
  proveedor: string | null;
  quantity: number;
  unit_price: number;
  moneda: 'GTQ' | 'USD';
  line_total: number;
  condiciones: string | null;
  option_group: string | null;
};
type QuoteSuggestion = { precio_id: number; producto_id: number; categoria: string; descripcion: string; proveedor: string | null; precio: number; moneda: 'GTQ' | 'USD'; condiciones: string | null };
type QuoteResult = { message: string; questions: string[]; ready: boolean; items: QuoteItem[]; suggestions: QuoteSuggestion[] };

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Guatemala' }).format(new Date());
const money = (amount: number, currency: 'GTQ' | 'USD') => new Intl.NumberFormat('es-GT', { style: 'currency', currency }).format(amount);

export default function QuoteAssistant({ salesperson }: { salesperson: string }) {
  const supabase = useMemo(() => createClient(), []);
  const [messages, setMessages] = useState<ChatMessage[]>([{ role: 'assistant', content: 'Cuéntame qué productos necesitas y en qué cantidades. Si faltan detalles para elegirlos del catálogo, te haré preguntas.' }]);
  const [items, setItems] = useState<QuoteItem[]>([]);
  const [suggestions, setSuggestions] = useState<QuoteSuggestion[]>([]);
  const [ready, setReady] = useState(false);
  const [customer, setCustomer] = useState('');
  const [nit, setNit] = useState('');
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');
  const [quoteDate] = useState(today);
  const threadRef = useRef<HTMLDivElement>(null);

  const groups = [...new Set(items.map((item) => item.option_group || 'Cotización'))].map((label) => ({
    label,
    items: items.filter((item) => (item.option_group || 'Cotización') === label),
  }));
  const hasAlternatives = groups.length > 1 && groups.some((group) => group.label !== 'Cotización');
  const totalFor = (groupItems: QuoteItem[]) => groupItems.reduce((sum, item) => sum + item.quantity * item.unit_price, 0);

  async function sendMessage(event: FormEvent) {
    event.preventDefault();
    const content = input.trim();
    if (!content || busy) return;
    const updatedMessages: ChatMessage[] = [...messages, { role: 'user' as const, content }].slice(-12);
    setMessages(updatedMessages);
    setInput(''); setBusy(true); setError(''); setReady(false); setSuggestions([]);
    const { data, error: invokeError } = await supabase.functions.invoke('cotizar', { body: { messages: updatedMessages } });
    if (invokeError || data?.error) {
      let detail = typeof data?.error === 'string' ? data.error : '';
      if (invokeError instanceof FunctionsHttpError) {
        const responseBody = await invokeError.context.clone().json().catch(() => null);
        if (typeof responseBody?.error === 'string') detail = responseBody.error;
        else detail ||= `El servicio respondió con un error HTTP ${invokeError.context.status}.`;
      } else if (invokeError) {
        detail ||= `No se pudo conectar con el servicio (${invokeError.message}).`;
      }
      setError(detail || 'No se pudo completar la solicitud. Inténtalo de nuevo.');
    } else {
      const result = data as QuoteResult;
      setMessages([...updatedMessages, { role: 'assistant' as const, content: result.message }].slice(-12));
      if (result.items?.length) setItems(result.items);
      setSuggestions(result.suggestions || []);
      setReady(Boolean(result.ready));
    }
    setBusy(false);
    requestAnimationFrame(() => threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: 'smooth' }));
  }

  function changeQuantity(priceId: number, optionGroup: string | null, raw: string) {
    const quantity = Math.max(1, Math.min(10000, Math.floor(Number(raw) || 1)));
    setItems((current) => current.map((item) => item.precio_id === priceId && item.option_group === optionGroup ? { ...item, quantity, line_total: quantity * item.unit_price } : item));
  }

  function addSuggestedProduct(product: QuoteSuggestion) {
    const unitPrice = Number(product.precio);
    if (!Number.isFinite(unitPrice) || unitPrice < 0) return;
    setItems((current) => {
      const existing = current.find((item) => item.precio_id === product.precio_id && item.option_group === null);
      if (existing) return current.map((item) => item === existing ? { ...item, quantity: item.quantity + 1, line_total: (item.quantity + 1) * item.unit_price } : item);
      return [...current, { precio_id: product.precio_id, producto_id: product.producto_id, categoria: product.categoria, descripcion: product.descripcion, proveedor: product.proveedor, quantity: 1, unit_price: unitPrice, moneda: product.moneda, line_total: unitPrice, condiciones: product.condiciones, option_group: null }];
    });
    setReady(true);
  }

  async function downloadWord() {
    if (!items.length) return;
    setExporting(true); setError('');
    try {
      const quoteNumber = `COT-${quoteDate.replaceAll('-', '')}-${new Date().toLocaleTimeString('en-GB', { timeZone: 'America/Guatemala', hour12: false }).replaceAll(':', '')}`;
      const border = { style: BorderStyle.SINGLE, size: 1, color: 'D9E0E9' };
      const cell = (text: string, options: { bold?: boolean; align?: (typeof AlignmentType)[keyof typeof AlignmentType]; fill?: string } = {}) => new TableCell({
        width: { size: 1, type: WidthType.AUTO },
        borders: { top: border, bottom: border, left: border, right: border },
        ...(options.fill ? { shading: { type: ShadingType.CLEAR, color: 'FFFFFF', fill: options.fill } } : {}),
        margins: { top: 110, bottom: 110, left: 120, right: 120 },
        children: [new Paragraph({ alignment: options.align, children: [new TextRun({ text, bold: options.bold, size: 19, font: 'Aptos' })] })],
      });
      const makeTable = (groupItems: QuoteItem[]) => {
        const headerRow = new TableRow({ tableHeader: true, children: [
          cell('Descripción', { bold: true, fill: 'EEF1F8' }), cell('Cantidad', { bold: true, align: AlignmentType.CENTER, fill: 'EEF1F8' }), cell('Precio unitario', { bold: true, align: AlignmentType.RIGHT, fill: 'EEF1F8' }), cell('Total', { bold: true, align: AlignmentType.RIGHT, fill: 'EEF1F8' }),
        ] });
        const dataRows = groupItems.map((item) => new TableRow({ children: [
          cell(item.descripcion), cell(String(item.quantity), { align: AlignmentType.CENTER }), cell(money(item.unit_price, item.moneda), { align: AlignmentType.RIGHT }), cell(money(item.quantity * item.unit_price, item.moneda), { align: AlignmentType.RIGHT }),
        ] }));
        return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, columnWidths: [4800, 1000, 2200, 2080], rows: [headerRow, ...dataRows] });
      };
      const optionSections = groups.flatMap((group) => {
        const groupTotal = totalFor(group.items);
        const groupCurrency = group.items[0].moneda;
        return [
          ...(hasAlternatives ? [new Paragraph({ heading: 'Heading2', spacing: { before: 220, after: 100 }, children: [new TextRun({ text: group.label, bold: true, color: '5261C7', size: 25 })] })] : []),
          makeTable(group.items),
          new Paragraph({ alignment: AlignmentType.RIGHT, spacing: { before: 90, after: 170 }, children: [new TextRun({ text: `${hasAlternatives ? `Total ${group.label}` : 'Total'}: ${money(groupTotal, groupCurrency)}`, bold: true, size: 23, color: '202747' })] }),
        ];
      });
      const document = new Document({
        styles: { default: { document: { run: { font: 'Aptos', size: 21, color: '202747' }, paragraph: { spacing: { after: 100 } } } } },
        sections: [{ properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 1080, right: 1080, bottom: 1080, left: 1080 } } }, children: [
          new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: 'COMPUSYSTEM', bold: true, color: '5261C7', size: 24, font: 'Aptos Display' })] }),
          new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: 'COTIZACIÓN', bold: true, size: 34, font: 'Aptos Display' })] }),
          new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: `${quoteNumber}  ·  ${quoteDate}`, color: '68718A', size: 19 })] }),
          new Paragraph({ text: '' }),
          new Paragraph({ children: [new TextRun({ text: 'Cliente: ', bold: true }), new TextRun(customer || '________________________________')] }),
          ...(nit.trim() ? [new Paragraph({ children: [new TextRun({ text: 'NIT: ', bold: true }), new TextRun(nit.trim())] })] : []),
          new Paragraph({ children: [new TextRun({ text: 'Asesor: ', bold: true }), new TextRun(salesperson || '________________________________')] }),
          new Paragraph({ text: '' }),
          ...optionSections,
          new Paragraph({ text: '' }),
          new Paragraph({ children: [new TextRun({ text: 'Documento borrador sujeto a revisión.', italics: true, color: '7B849A', size: 18 })] }),
        ] }],
      });
      const blob = await Packer.toBlob(document);
      const url = URL.createObjectURL(blob);
      const link = window.document.createElement('a'); link.href = url; link.download = `${quoteNumber}.docx`; link.click(); URL.revokeObjectURL(url);
    } catch {
      setError('No se pudo crear el archivo Word. Inténtalo de nuevo.');
    } finally { setExporting(false); }
  }

  return <div className="installation-page">
    <div className="installation-page-heading"><div><span className="installation-eyebrow">ASISTENTE DE VENTAS</span><h1>Cotizaciones</h1><p>Describe lo que necesitas y prepara un borrador con precios de venta vigentes.</p></div></div>
    <div className="quote-workspace">
      <section className="quote-chat-card" aria-label="Chat para cotizar">
        <div className="quote-card-heading"><span className="quote-assistant-mark">C</span><div><b>Asistente de cotizaciones</b><small>Catálogo de productos con precio aprobado</small></div><span className="quote-online-dot" title="Disponible" /></div>
        <div className="quote-thread" ref={threadRef} aria-live="polite">
          {messages.map((message, index) => <div key={`${index}-${message.role}`} className={`quote-bubble ${message.role === 'user' ? 'quote-bubble-user' : ''}`}>{message.content}</div>)}
          {busy && <div className="quote-bubble quote-thinking">Buscando en el catálogo…</div>}
        </div>
        {error && <div className="quote-error" role="alert">{error}</div>}
        <form className="quote-composer" onSubmit={sendMessage}><textarea aria-label="Describe lo que necesitas" value={input} onChange={(event) => setInput(event.target.value)} placeholder="Ejemplo: necesito 4 cámaras para exterior, 4 MP…" rows={2} maxLength={2000} disabled={busy} /><button type="submit" disabled={busy || !input.trim()} aria-label="Enviar solicitud">{busy ? '…' : '↑'}</button></form>
        <small className="quote-chat-note">El bot solo puede usar precios aprobados. Revisa cada borrador antes de descargarlo.</small>
      </section>
      <section className="quote-draft-card" aria-label="Borrador de cotización">
        <div className="quote-draft-heading"><div><span className="installation-eyebrow">BORRADOR</span><h2>Detalle de cotización</h2></div><span className={`quote-draft-status ${ready ? 'quote-status-ready' : ''}`}>{ready ? 'Listo para revisar' : items.length ? 'Borrador parcial' : 'En preparación'}</span></div>
        <div className="quote-customer-fields"><label>Cliente<input value={customer} onChange={(event) => setCustomer(event.target.value)} placeholder="Nombre del cliente" maxLength={160} /></label><label>NIT <span>Opcional</span><input value={nit} onChange={(event) => setNit(event.target.value)} placeholder="NIT" maxLength={40} /></label></div>
        {!items.length ? <div className="quote-empty"><span>＋</span><b>Aún no hay productos</b><small>Describe lo que necesitas en el chat para empezar.</small></div> : <div className="quote-items-list">
          {groups.map((group) => <section className="quote-option-group" key={group.label}>
            {hasAlternatives && <h3 className="quote-option-heading">{group.label}</h3>}
            {group.items.map((item) => <article className="quote-item-row" key={`${item.precio_id}-${group.label}`}><div className="quote-item-name"><b>{item.descripcion}</b><small>{item.categoria}{item.proveedor ? ` · ${item.proveedor}` : ''}</small>{item.condiciones && <small>{item.condiciones}</small>}</div><label className="quote-quantity">Cant.<input type="number" min={1} max={10000} step={1} value={item.quantity} onChange={(event) => changeQuantity(item.precio_id, item.option_group, event.target.value)} /></label><div className="quote-item-price"><small>{money(item.unit_price, item.moneda)} c/u</small><b>{money(item.quantity * item.unit_price, item.moneda)}</b></div></article>)}
            <div className="quote-option-total"><span>{hasAlternatives ? `Total ${group.label}` : 'Total'}</span><b>{money(totalFor(group.items), group.items[0].moneda)}</b></div>
          </section>)}
          <small className="quote-no-tax">No se agrega IVA.</small>
        </div>}
        <section className="quote-catalog-picker" aria-label="Opciones sugeridas por el asistente">
          <div className="quote-picker-heading"><div><b>Opciones sugeridas</b><small>Solo productos relacionados con lo que estás solicitando.</small></div><span>{suggestions.length}</span></div>
          {!suggestions.length ? <small className="quote-catalog-status">Cuando el asistente encuentre opciones relacionadas, aparecerán aquí para agregarlas.</small> : <div className="quote-product-grid">{suggestions.map((product) => {
            const alreadyAdded = items.some((item) => item.precio_id === product.precio_id);
            return <article className="quote-product-card" key={product.precio_id}><span>{product.categoria}</span><b>{product.descripcion}</b>{product.proveedor && <small>{product.proveedor}</small>}{product.condiciones && <small>{product.condiciones}</small>}<div><strong>{money(product.precio, product.moneda)}</strong><button type="button" onClick={() => addSuggestedProduct(product)} disabled={alreadyAdded}>{alreadyAdded ? 'Agregado' : 'Agregar'}</button></div></article>;
          })}</div>}
        </section>
        <button className="quote-download-button" type="button" onClick={downloadWord} disabled={!items.length || exporting}>{exporting ? 'Creando Word…' : hasAlternatives ? 'Descargar opciones en Word' : 'Descargar cotización Word'}</button>
      </section>
    </div>
  </div>;
}
