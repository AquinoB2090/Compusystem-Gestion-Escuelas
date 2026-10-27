'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import { createClient } from '@/lib/supabase/client';

type School = { id: number; nombre: string };
type Teacher = { id: number; nombre: string; escuela_id: number; tipo_formato?: 'quetzales' | 'fotocopias' };
type Balance = { maestro_id: number; saldo: number };
type SheetEntry = {
  fecha: string;
  catedratico: string | null;
  descripcion: string;
  saldo: number;
};

const now = new Date();
const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
const money = (amount: number) => `Q ${Number(amount || 0).toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const formatAmount = (amount: number, unit: 'quetzales' | 'fotocopias') => unit === 'quetzales'
  ? money(amount)
  : `${Number(amount || 0).toLocaleString('es-GT', { maximumFractionDigits: 2 })} fotocopias`;
const monthLabel = (value: string) => {
  const [year, month] = value.split('-').map(Number);
  return new Intl.DateTimeFormat('es-GT', { month: 'long', year: 'numeric' }).format(new Date(year, month - 1, 1));
};

export default function AdminSchools({
  schools,
  teachers,
  balances,
  onRefresh,
}: {
  schools: School[];
  teachers: Teacher[];
  balances: Balance[];
  onRefresh: () => Promise<void>;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [schoolId, setSchoolId] = useState<number | null>(null);
  const [addingTeacher, setAddingTeacher] = useState(false);
  const [teacherName, setTeacherName] = useState('');
  const [teacherBusy, setTeacherBusy] = useState(false);
  const [teacherError, setTeacherError] = useState('');
  const [teacherSuccess, setTeacherSuccess] = useState('');
  const [activeTeacher, setActiveTeacher] = useState<Teacher | null>(null);
  const [month, setMonth] = useState(currentMonth);
  const [entries, setEntries] = useState<SheetEntry[]>([]);
  const [draftAmounts, setDraftAmounts] = useState<Record<number, string>>({});
  const [sheetError, setSheetError] = useState('');
  const [consumptionBusy, setConsumptionBusy] = useState(false);
  const [unitBusy, setUnitBusy] = useState(false);
  const [consumptionError, setConsumptionError] = useState('');
  const [sheetRefresh, setSheetRefresh] = useState(0);
  const dialog = useRef<HTMLDialogElement>(null);

  const school = schools.find((item) => item.id === schoolId) || null;
  const schoolTeachers = teachers.filter((teacher) => teacher.escuela_id === schoolId);
  const activeBalance = activeTeacher ? balances.find((balance) => balance.maestro_id === activeTeacher.id)?.saldo || 0 : 0;
  const formatUnit = activeTeacher?.tipo_formato || 'quetzales';
  const entryRowCount = Math.max(22, entries.length + 1);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (activeTeacher && !element.open) element.showModal();
    if (!activeTeacher && element.open) element.close();
  }, [activeTeacher]);

  useEffect(() => {
    if (!activeTeacher) return;
    let cancelled = false;
    setEntries([]);
    setDraftAmounts({});
    setSheetError('');
    supabase
      .from('hoja_maestro_acumulada')
      .select('fecha,catedratico,descripcion,saldo')
      .eq('maestro_id', activeTeacher.id)
      .eq('periodo', `${month}-01`)
      .order('fecha')
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) setSheetError('No se pudo cargar la hoja de este maestro.');
        else setEntries((data || []) as SheetEntry[]);
      });
    return () => { cancelled = true; };
  }, [activeTeacher, month, sheetRefresh, supabase]);

  async function addTeacher(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!school) return;
    setTeacherBusy(true);
    setTeacherError('');
    setTeacherSuccess('');
    const { error } = await supabase.from('maestros').insert({
      nombre: teacherName.trim(),
      escuela_id: school.id,
      activo: true,
    });
    if (error) {
      setTeacherError('No se pudo agregar el maestro. Revisa el nombre e inténtalo de nuevo.');
      setTeacherBusy(false);
      return;
    }
    setTeacherName('');
    setAddingTeacher(false);
    setTeacherSuccess('Maestro agregado a la escuela.');
    await onRefresh();
    setTeacherBusy(false);
  }

  async function changeFormatUnit(unit: 'quetzales' | 'fotocopias') {
    if (!activeTeacher || unit === formatUnit) return;
    setUnitBusy(true);
    setConsumptionError('');
    const { error } = await supabase.from('maestros').update({ tipo_formato: unit }).eq('id', activeTeacher.id);
    if (error) {
      setConsumptionError('No se pudo guardar el tipo de formato. Ejecuta primero la migracion de unidades.');
      setUnitBusy(false);
      return;
    }
    setActiveTeacher({ ...activeTeacher, tipo_formato: unit });
    await onRefresh();
    setUnitBusy(false);
  }

  async function registerConsumption(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeTeacher) return;
    const form = event.currentTarget;
    const values = new FormData(form);
    const pending = Array.from({ length: entryRowCount - entries.length }, (_, offset) => entries.length + offset)
      .map((index) => ({
        fecha: String(values.get(`fecha-${index}`) || ''),
        catedratico: String(values.get(`catedratico-${index}`) || '').trim(),
        monto: Number(values.get(`monto-${index}`)),
      }))
      .filter((row) => row.fecha || row.catedratico || Number.isFinite(row.monto) && row.monto > 0);
    if (!pending.length) {
      setConsumptionError('Ingresa al menos un consumo antes de guardar el formato.');
      return;
    }
    for (const row of pending) {
      if (!row.fecha.startsWith(`${month}-`)) {
        setConsumptionError('Cada fecha debe pertenecer al mes seleccionado en la hoja.');
        return;
      }
      if (!row.catedratico || !Number.isFinite(row.monto) || row.monto <= 0) {
        setConsumptionError('Completa fecha, catedratico responsable y cantidad en cada fila utilizada.');
        return;
      }
    }
    setConsumptionBusy(true);
    setConsumptionError('');
    const { error } = await supabase.from('consumos').insert(pending.map((row) => ({
      maestro_id: activeTeacher.id,
      fecha: row.fecha,
      periodo: `${row.fecha.slice(0, 7)}-01`,
      catedratico: row.catedratico,
      descripcion: String(row.monto),
      monto: row.monto,
      recibido_conforme: false,
      recibido_por: null,
    })));
    if (error) {
      setConsumptionError(`No se pudo guardar el formato: ${error.message}`);
      setConsumptionBusy(false);
      return;
    }
    form.reset();
    setDraftAmounts({});
    setConsumptionError('');
    setSheetRefresh((value) => value + 1);
    await onRefresh();
    setConsumptionBusy(false);
  }

  return (
    <>
      {!school ? (
        <>
          <div className="welcome school-welcome">
            <div>
              <span className="eyebrow">PANEL DE ADMINISTRACIÓN</span>
              <h1>Escuelas</h1>
              <p>Selecciona una escuela para abrir sus formatos de fotocopias y administrar sus maestros.</p>
            </div>
            <div className="date-pill">{new Intl.DateTimeFormat('es-GT', { day: 'numeric', month: 'long', year: 'numeric' }).format(now)}</div>
          </div>
          <div className="school-grid">
            {schools.map((item) => {
              const count = teachers.filter((teacher) => teacher.escuela_id === item.id).length;
              const schoolBalances = balances.filter((balance) => teachers.some((teacher) => teacher.id === balance.maestro_id && teacher.escuela_id === item.id));
              const totalQuetzales = schoolBalances.filter((balance) => teachers.find((teacher) => teacher.id === balance.maestro_id)?.tipo_formato !== 'fotocopias').reduce((sum, balance) => sum + Number(balance.saldo || 0), 0);
              const totalCopies = schoolBalances.filter((balance) => teachers.find((teacher) => teacher.id === balance.maestro_id)?.tipo_formato === 'fotocopias').reduce((sum, balance) => sum + Number(balance.saldo || 0), 0);
              return (
                <button className="school-card" key={item.id} onClick={() => { setSchoolId(item.id); setTeacherSuccess(''); }}>
                  <span className="school-card-icon">⌂</span>
                  <span className="school-card-content"><b>{item.nombre}</b><small>{count} {count === 1 ? 'maestro' : 'maestros'}</small></span>
                  <span className="school-card-balance">{[totalQuetzales ? money(totalQuetzales) : '', totalCopies ? formatAmount(totalCopies, 'fotocopias') : ''].filter(Boolean).join(' · ') || money(0)}</span>
                  <span className="school-card-arrow">›</span>
                </button>
              );
            })}
            {!schools.length && <div className="empty school-empty">No hay escuelas registradas.</div>}
          </div>
        </>
      ) : (
        <>
          <div className="section-head school-detail-head">
            <div>
              <button className="back-link" onClick={() => { setSchoolId(null); setAddingTeacher(false); setTeacherError(''); }}>← Todas las escuelas</button>
              <span className="eyebrow">FORMATO DE FOTOCOPIAS</span>
              <h1>{school.nombre}</h1>
              <p>Abre la hoja individual de cada maestro o registra uno nuevo.</p>
            </div>
            <button className="button primary" onClick={() => { setAddingTeacher((value) => !value); setTeacherError(''); }}>
              {addingTeacher ? 'Cancelar' : '+ Agregar maestro'}
            </button>
          </div>
          {teacherSuccess && <div className="alert success">{teacherSuccess}<button onClick={() => setTeacherSuccess('')}>×</button></div>}
          {addingTeacher && (
            <form className="teacher-add-form" onSubmit={addTeacher}>
              <label>Nombre del maestro<input autoFocus required value={teacherName} onChange={(event) => setTeacherName(event.target.value)} placeholder="Escribe el nombre completo" /></label>
              <button className="button primary" disabled={teacherBusy}>{teacherBusy ? 'Guardando…' : 'Guardar maestro'}</button>
              {teacherError && <div className="alert error teacher-add-error">{teacherError}</div>}
            </form>
          )}
          <div className="teacher-list-head"><h2>Maestros</h2><span>{schoolTeachers.length} registrados</span></div>
          <div className="teacher-sheet-grid">
            {schoolTeachers.map((teacher, index) => {
              const balance = balances.find((item) => item.maestro_id === teacher.id)?.saldo || 0;
              return (
                <article className="teacher-sheet-card" key={teacher.id}>
                  <span className={`teacher-avatar tone-${index % 5}`}>{teacher.nombre.slice(0, 1)}</span>
                  <div className="teacher-sheet-info"><b>{teacher.nombre}</b><small>Saldo actual · {formatAmount(balance, teacher.tipo_formato || 'quetzales')}</small></div>
                  <button className="button secondary small" onClick={() => { setActiveTeacher(teacher); setMonth(currentMonth); setConsumptionError(''); }}>Abrir formato</button>
                </article>
              );
            })}
            {!schoolTeachers.length && <div className="empty school-empty">Todavía no hay maestros en esta escuela. Agrega uno para crear su formato.</div>}
          </div>
        </>
      )}

      <dialog ref={dialog} className="sheet-dialog school-sheet-dialog" onClose={() => setActiveTeacher(null)}>
        <div className="sheet-toolbar">
          <button className="button secondary" onClick={() => setActiveTeacher(null)}>Cerrar</button>
          <label className="sheet-month">Mes<select value={month} onChange={(event) => { setMonth(event.target.value); setConsumptionError(''); }}>
            {Array.from({ length: 36 }, (_, index) => {
              const date = new Date(now.getFullYear(), now.getMonth() - index, 1);
              const value = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
              return <option value={value} key={value}>{monthLabel(value)}</option>;
            })}
          </select></label>
          <label className="sheet-month">Tipo de formato<select aria-label="Tipo de formato" value={formatUnit} disabled={unitBusy} onChange={(event) => changeFormatUnit(event.target.value as 'quetzales' | 'fotocopias')}><option value="quetzales">Quetzales</option><option value="fotocopias">Fotocopias</option></select></label>
          <button className="button primary" type="submit" form="school-consumption-form" disabled={consumptionBusy}>{consumptionBusy ? 'Guardando...' : 'Guardar formato'}</button>
          <button className="button primary" onClick={() => window.print()}>Imprimir formato</button>
        </div>
        <div className="print-sheet school-print-sheet">
          <div className="school-sheet-branding"><Image src="/compusystem-logo.jpeg" alt="Logotipo de Compusystem" width={802} height={507} className="school-sheet-logo" /></div>
          <div className="school-sheet-contact"><b>Prop. Olga Marina Arrivillaga Aldana de Aquino</b><span>Barrio El Porvenir, Guastatoya, El Progreso</span><span>Tel. 7945-0482 · e-mail: compussystem@hotmail.com</span><span>NIT 48577030</span></div>
          <div className="school-sheet-rule" />
          <div className="school-sheet-meta"><span>Seño: <b>{activeTeacher?.nombre || '________________________'}</b></span><span>Mes <b>{monthLabel(month)}</b></span><span>{new Date(`${month}-01T12:00:00`).getFullYear()}</span><b>{formatAmount(activeBalance, formatUnit)}</b></div>
          {consumptionError && <p className="sheet-entry-error no-print">{consumptionError}</p>}
          <p className="sheet-entry-hint no-print">Escribe la cantidad consumida en Descripcion. Saldo Q se calcula automaticamente; guarda todas las filas con el boton Guardar formato.</p>
          {sheetError && <p className="sheet-load-error">{sheetError}</p>}
          <form id="school-consumption-form" onSubmit={registerConsumption}>
          <table className="school-format-table">
            <thead><tr><th>Fecha</th><th>Catedr&aacute;tico Responsable</th><th>Descripci&oacute;n</th><th>{formatUnit === 'quetzales' ? 'Saldo Q' : 'Saldo fotocopias'}</th></tr></thead>
            <tbody>
              {Array.from({ length: entryRowCount }, (_, index) => {
                const entry = entries[index];
                const editable = Boolean(activeTeacher) && index >= entries.length;
                const amountThroughRow = Object.entries(draftAmounts).reduce((sum, [rowIndex, amount]) => Number(rowIndex) <= index ? sum + (Number(amount) || 0) : sum, 0);
                return <tr key={index} className={editable ? 'sheet-entry-row' : undefined}>
                  <td>{entry?.fecha ? new Intl.DateTimeFormat('es-GT').format(new Date(entry.fecha + 'T12:00:00')) : editable ? <input className="sheet-cell-input" type="date" name={`fecha-${index}`} aria-label="Fecha" disabled={consumptionBusy} /> : ''}</td>
                  <td>{entry?.catedratico || (editable ? <input className="sheet-cell-input" name={`catedratico-${index}`} aria-label="Catedratico responsable" disabled={consumptionBusy} placeholder="Escribe aqui" /> : '')}</td>
                  <td>{entry?.descripcion || (editable ? <input className="sheet-cell-input" type="number" name={`monto-${index}`} min="0.01" step="0.01" aria-label="Cantidad consumida" disabled={consumptionBusy} placeholder="Cantidad Q" value={draftAmounts[index] || ''} onChange={(event) => setDraftAmounts((current) => ({ ...current, [index]: event.target.value }))} /> : '')}</td>
                  <td>{entry ? formatAmount(entry.saldo, formatUnit) : editable && amountThroughRow ? formatAmount(activeBalance - amountThroughRow, formatUnit) : ''}</td>
                </tr>;
              })}
            </tbody>
          </table>
          </form>
          <div className="school-sheet-footer">Venta y soporte técnico: Computadoras, cámaras de seguridad, biométrico, control de acceso electrónico, alarmas, red estructurada, desarrollo de software y aire acondicionado.</div>
        </div>
      </dialog>
    </>
  );
}
