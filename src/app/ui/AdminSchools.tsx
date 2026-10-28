'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import { createClient } from '@/lib/supabase/client';
import { downloadTeacherSheetPdf } from '@/lib/teacherSheetPdf';

type School = { id: number; nombre: string };
type Teacher = { id: number; nombre: string; escuela_id: number; tipo_formato?: 'quetzales' | 'fotocopias'; activo?: boolean };
type Balance = { maestro_id: number; saldo: number };
type MonthlyConsumption = { maestro_id: number; escuela_id: number; consumido: number };
type SheetEntry = {
  fecha: string;
  catedratico: string | null;
  descripcion: string;
  saldo: number;
};

const now = new Date();
const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
const localDateISO = () => {
  const date = new Date();
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 10);
};
const defaultEntryDate = (month: string) => {
  const today = localDateISO();
  return today.startsWith(`${month}-`) ? today : `${month}-01`;
};
const COPIES_PER_QUETZAL = 4;
const money = (amount: number) => `Q ${Number(amount || 0).toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const formatAmount = (amount: number, unit: 'quetzales' | 'fotocopias') => unit === 'quetzales'
  ? money(amount)
  : `${(Number(amount || 0) * COPIES_PER_QUETZAL).toLocaleString('es-GT', { maximumFractionDigits: 2 })} fotocopias`;
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
  const [addingSchool, setAddingSchool] = useState(false);
  const [schoolName, setSchoolName] = useState('');
  const [directorName, setDirectorName] = useState('');
  const [directorPassword, setDirectorPassword] = useState('');
  const [schoolBusy, setSchoolBusy] = useState(false);
  const [schoolError, setSchoolError] = useState('');
  const [schoolSuccess, setSchoolSuccess] = useState('');
  const [addingTeacher, setAddingTeacher] = useState(false);
  const [teacherName, setTeacherName] = useState('');
  const [teacherBusy, setTeacherBusy] = useState(false);
  const [teacherError, setTeacherError] = useState('');
  const [teacherSuccess, setTeacherSuccess] = useState('');
  const [activeTeacher, setActiveTeacher] = useState<Teacher | null>(null);
  const [month, setMonth] = useState(currentMonth);
  const [summaryMonth, setSummaryMonth] = useState(currentMonth);
  const [entries, setEntries] = useState<SheetEntry[]>([]);
  const [monthlyConsumption, setMonthlyConsumption] = useState<MonthlyConsumption[]>([]);
  const [summaryError, setSummaryError] = useState('');
  const [draftAmounts, setDraftAmounts] = useState<Record<number, string>>({});
  const [sheetError, setSheetError] = useState('');
  const [consumptionBusy, setConsumptionBusy] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [consumptionError, setConsumptionError] = useState('');
  const [sheetRefresh, setSheetRefresh] = useState(0);
  const dialog = useRef<HTMLDialogElement>(null);

  const school = schools.find((item) => item.id === schoolId) || null;
  const schoolTeachers = teachers.filter((teacher) => teacher.escuela_id === schoolId && teacher.activo !== false);
  const activeBalance = activeTeacher ? balances.find((balance) => balance.maestro_id === activeTeacher.id)?.saldo || 0 : 0;
  const formatUnit = 'fotocopias' as const;
  const entryRowCount = Math.max(22, entries.length + 1);
  const consumedRows = monthlyConsumption.filter((row) => Number(row.consumido) > 0);
  const consumedQuetzales = consumedRows.filter((row) => teachers.find((teacher) => teacher.id === row.maestro_id)?.tipo_formato !== 'fotocopias').reduce((sum, row) => sum + Number(row.consumido || 0), 0);
  const consumedCopiesQuetzales = consumedRows.filter((row) => teachers.find((teacher) => teacher.id === row.maestro_id)?.tipo_formato === 'fotocopias').reduce((sum, row) => sum + Number(row.consumido || 0), 0);
  const consumedTotalQuetzales = consumedQuetzales + consumedCopiesQuetzales;
  const schoolConsumption = Object.entries(consumedRows.reduce<Record<number, { quetzales: number; copiasQ: number; maestros: number }>>((totals, row) => {
    const current = totals[row.escuela_id] || { quetzales: 0, copiasQ: 0, maestros: 0 };
    const isCopies = teachers.find((teacher) => teacher.id === row.maestro_id)?.tipo_formato === 'fotocopias';
    totals[row.escuela_id] = {
      quetzales: current.quetzales + (isCopies ? 0 : Number(row.consumido || 0)),
      copiasQ: current.copiasQ + (isCopies ? Number(row.consumido || 0) : 0),
      maestros: current.maestros + 1,
    };
    return totals;
  }, {})).sort((a, b) => (b[1].quetzales + b[1].copiasQ) - (a[1].quetzales + a[1].copiasQ));

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

  useEffect(() => {
    let cancelled = false;
    supabase.from('saldo_mensual').select('maestro_id,escuela_id,consumido').eq('periodo', `${summaryMonth}-01`).then(({ data, error }) => {
      if (cancelled) return;
      if (error) {
        setSummaryError('No se pudo cargar el resumen mensual de consumos.');
        return;
      }
      setSummaryError('');
      setMonthlyConsumption((data || []) as MonthlyConsumption[]);
    });
    return () => { cancelled = true; };
  }, [summaryMonth, sheetRefresh, supabase]);

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
      tipo_formato: 'fotocopias',
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

  async function addSchool(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nombre = schoolName.trim();
    if (!nombre || !directorName.trim() || directorPassword.length < 8) return;
    setSchoolBusy(true);
    setSchoolError('');
    const response = await fetch('/api/escuelas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nombre, director_nombre: directorName.trim(), password: directorPassword }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      setSchoolError(result.error || 'No se pudo crear la escuela y la cuenta del director.');
      setSchoolBusy(false);
      return;
    }
    setSchoolName('');
    setDirectorName('');
    setDirectorPassword('');
    setAddingSchool(false);
    setSchoolSuccess(`Escuela y cuenta de director creadas. El acceso será con la escuela y la contraseña que definiste.`);
    await onRefresh();
    setSchoolBusy(false);
  }

  async function editTeacherBalance(teacher: Teacher, currentQuetzales: number) {
    const value = window.prompt('Nuevo saldo en fotocopias:', String(Math.max(0, Math.round(currentQuetzales * COPIES_PER_QUETZAL))));
    if (value === null) return;
    const saldo = Number(value);
    if (!Number.isInteger(saldo) || saldo < 0) {
      window.alert('El saldo debe ser un numero entero de fotocopias igual o mayor que cero.');
      return;
    }
    const motivo = window.prompt('Motivo del ajuste:');
    if (!motivo?.trim()) return;
    setSchoolBusy(true);
    const response = await fetch('/api/saldos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ maestro_id: teacher.id, saldo_fotocopias: saldo, motivo: motivo.trim() }),
    });
    const result = await response.json().catch(() => ({}));
    setSchoolBusy(false);
    if (!response.ok) {
      window.alert(result.error || 'No se pudo actualizar el saldo.');
      return;
    }
    setSheetRefresh((current) => current + 1);
    await onRefresh();
  }

  async function registerConsumption(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeTeacher) return;
    const form = event.currentTarget;
    const values = new FormData(form);
    const today = defaultEntryDate(month);
    const pending = Array.from({ length: entryRowCount - entries.length }, (_, offset) => entries.length + offset)
      .map((index) => {
        const fecha = String(values.get(`fecha-${index}`) || '');
        const catedratico = String(values.get(`catedratico-${index}`) || '').trim();
        const monto = Number(values.get(`monto-${index}`));
        return {
          fecha,
          catedratico,
          monto,
          automaticDefaults: index === entries.length && fecha === today && catedratico === activeTeacher.nombre && !(monto > 0),
        };
      })
      .filter((row) => !row.automaticDefaults && (row.fecha || row.catedratico || Number.isFinite(row.monto) && row.monto > 0));
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
      if (formatUnit === 'fotocopias' && !Number.isInteger(row.monto)) {
        setConsumptionError('La cantidad de fotocopias debe ser un numero entero.');
        return;
      }
    }
    setConsumptionBusy(true);
    setConsumptionError('');
    const { error } = await supabase.from('consumos').insert(pending.map((row) => ({
      maestro_id: activeTeacher.id,
      fecha: row.fecha,
      catedratico: row.catedratico,
      descripcion: String(row.monto),
      monto: formatUnit === 'fotocopias' ? row.monto / COPIES_PER_QUETZAL : row.monto,
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

  async function downloadFormatPdf() {
    if (!activeTeacher) return;
    setPdfBusy(true);
    setSheetError('');
    try {
      const { data, error } = await supabase
        .from('hoja_maestro_acumulada')
        .select('fecha,catedratico,descripcion,saldo')
        .eq('maestro_id', activeTeacher.id)
        .eq('periodo', `${month}-01`)
        .order('fecha');
      if (error) throw error;
      await downloadTeacherSheetPdf({
        teacherName: activeTeacher.nombre,
        month,
        unit: formatUnit,
        balance: activeBalance,
        entries: (data || []) as SheetEntry[],
      });
    } catch {
      setSheetError('No se pudo descargar el PDF. Inténtalo de nuevo.');
    } finally {
      setPdfBusy(false);
    }
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
            <div className="table-tools">
              <div className="date-pill">{new Intl.DateTimeFormat('es-GT', { day: 'numeric', month: 'long', year: 'numeric' }).format(now)}</div>
              <button className="button primary add-school-cta" type="button" onClick={() => { setAddingSchool((value) => !value); setSchoolError(''); }}>
                {addingSchool ? 'Cancelar' : '+ Agregar escuela'}
              </button>
            </div>
          </div>
          {addingSchool && (
            <form className="teacher-add-form" onSubmit={addSchool}>
              <label>Nombre de la escuela<input autoFocus required value={schoolName} onChange={(event) => setSchoolName(event.target.value)} placeholder="Escribe el nombre de la escuela" /></label>
              <label>Nombre del director<input required value={directorName} onChange={(event) => setDirectorName(event.target.value)} placeholder="Nombre completo" /></label>
              <label>Contraseña del director<input type="password" autoComplete="new-password" minLength={8} required value={directorPassword} onChange={(event) => setDirectorPassword(event.target.value)} placeholder="Mínimo 8 caracteres" /></label>
              <button className="button primary" disabled={schoolBusy}>{schoolBusy ? 'Creando escuela y usuario...' : 'Crear escuela y director'}</button>
              {schoolError && <div className="alert error teacher-add-error">{schoolError}</div>}
            </form>
          )}
          {schoolSuccess && <div className="alert success">{schoolSuccess}<button onClick={() => setSchoolSuccess('')}>×</button></div>}
          <div className="stats">
            <div className="stat-card">
              <div className="stat-top"><span>Consumo total equivalente en Q</span><span className="stat-icon green">Q</span></div>
              <strong>{money(consumedTotalQuetzales)}</strong>
              <small>Incluye fotocopias a Q 0.25 cada una · {monthLabel(summaryMonth)}</small>
            </div>
            <div className="stat-card">
              <div className="stat-top"><span>Fotocopias consumidas</span><span className="stat-icon orange">▤</span></div>
              <strong>{formatAmount(consumedCopiesQuetzales, 'fotocopias')}</strong>
              <small>Equivalente: {money(consumedCopiesQuetzales)} · {monthLabel(summaryMonth)}</small>
            </div>
            <div className="stat-card">
              <div className="stat-top"><span>Maestros con consumo</span><span className="stat-icon blue">♙</span></div>
              <strong>{consumedRows.length}</strong>
              <small>En el mes seleccionado</small>
            </div>
          </div>
          {summaryError && <div className="alert error">{summaryError}</div>}
          <div className="section-head">
            <div><h2>Consumo por escuela</h2><p>Totales separados según la unidad de cada formato · {monthLabel(summaryMonth)}</p></div>
            <label className="report-filter">Mes<input type="month" value={summaryMonth} onChange={(event) => setSummaryMonth(event.target.value)} /></label>
          </div>
          <div className="table-card">
            <table>
              <thead><tr><th>ESCUELA</th><th>EQUIVALENTE TOTAL EN Q</th><th>FOTOCOPIAS CONSUMIDAS</th><th>MAESTROS CON CONSUMO</th></tr></thead>
              <tbody>
                {schoolConsumption.map(([id, totals]) => (
                  <tr key={id}>
                    <td>{schools.find((item) => item.id === Number(id))?.nombre || 'Escuela'}</td>
                    <td>{money(totals.quetzales + totals.copiasQ)}</td>
                    <td>{formatAmount(totals.copiasQ, 'fotocopias')}</td>
                    <td>{totals.maestros}</td>
                  </tr>
                ))}
                {!schoolConsumption.length && <tr><td className="empty" colSpan={4}>No hay consumos registrados en {monthLabel(summaryMonth)}.</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="school-grid">
            {schools.map((item) => {
              const count = teachers.filter((teacher) => teacher.escuela_id === item.id).length;
              const schoolBalances = balances.filter((balance) => teachers.some((teacher) => teacher.id === balance.maestro_id && teacher.escuela_id === item.id));
              const totalCopies = schoolBalances.reduce((sum, balance) => sum + Number(balance.saldo || 0), 0);
              return (
                <button className="school-card" key={item.id} onClick={() => { setSchoolId(item.id); setTeacherSuccess(''); }}>
                  <span className="school-card-icon">⌂</span>
                  <span className="school-card-content"><b>{item.nombre}</b><small>{count} {count === 1 ? 'maestro' : 'maestros'}</small></span>
                  <span className="school-card-balance">{formatAmount(totalCopies, 'fotocopias')}</span>
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
                  <div className="teacher-sheet-info"><b>{teacher.nombre}</b><small>Saldo actual · {formatAmount(balance, 'fotocopias')}</small></div>
                  <button className="button secondary small" disabled={schoolBusy} onClick={() => editTeacherBalance(teacher, balance)}>Editar saldo</button>
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
          <button className="button primary" type="submit" form="school-consumption-form" disabled={consumptionBusy}>{consumptionBusy ? 'Guardando...' : 'Guardar formato'}</button>
          <button className="button primary" type="button" onClick={downloadFormatPdf} disabled={pdfBusy}>{pdfBusy ? 'Preparando PDF...' : 'Descargar PDF'}</button>
        </div>
        <div className="print-sheet school-print-sheet">
          <div className="school-sheet-branding"><Image src="/compusystem-logo.jpeg" alt="Logotipo de Compusystem" width={802} height={507} className="school-sheet-logo" /></div>
          <div className="school-sheet-contact"><b>Prop. Olga Marina Arrivillaga Aldana de Aquino</b><span>Barrio El Porvenir, Guastatoya, El Progreso</span><span>Tel. 7945-0482 · e-mail: compussystem@hotmail.com</span><span>NIT 48577030</span></div>
          <div className="school-sheet-rule" />
          <div className="school-sheet-meta"><span>Seño: <b>{activeTeacher?.nombre || '________________________'}</b></span><span>Mes <b>{monthLabel(month)}</b></span><b>{formatAmount(activeBalance, formatUnit)}</b></div>
          {consumptionError && <p className="sheet-entry-error no-print">{consumptionError}</p>}
          <p className="sheet-entry-hint no-print">Cada fotocopia equivale a Q 0.25. El saldo se actualiza automaticamente. Guarda todas las filas con el boton Guardar formato.</p>
          {sheetError && <p className="sheet-load-error">{sheetError}</p>}
          <form id="school-consumption-form" onSubmit={registerConsumption}>
          <table className="school-format-table">
            <thead><tr><th>Fecha</th><th>Catedr&aacute;tico Responsable</th><th>Descripci&oacute;n</th><th>Saldo fotocopias</th></tr></thead>
            <tbody>
              {Array.from({ length: entryRowCount }, (_, index) => {
                const entry = entries[index];
                const editable = Boolean(activeTeacher) && index >= entries.length;
                const amountThroughRow = Object.entries(draftAmounts).reduce((sum, [rowIndex, amount]) => Number(rowIndex) <= index ? sum + (Number(amount) || 0) : sum, 0);
                return <tr key={index} className={editable ? 'sheet-entry-row' : undefined}>
                  <td>{entry?.fecha ? new Intl.DateTimeFormat('es-GT').format(new Date(entry.fecha + 'T12:00:00')) : editable ? <input className="sheet-cell-input" type="date" name={`fecha-${index}`} aria-label="Fecha" defaultValue={index === entries.length ? defaultEntryDate(month) : undefined} disabled={consumptionBusy} /> : ''}</td>
                  <td>{entry?.catedratico || (editable ? <input className="sheet-cell-input" name={`catedratico-${index}`} aria-label="Catedratico responsable" defaultValue={index === entries.length ? activeTeacher?.nombre || '' : ''} disabled={consumptionBusy} placeholder="Escribe aqui" /> : '')}</td>
                  <td>{entry?.descripcion || (editable ? <input className="sheet-cell-input" type="number" name={`monto-${index}`} min={formatUnit === 'fotocopias' ? '1' : '0.01'} step={formatUnit === 'fotocopias' ? '1' : '0.01'} aria-label="Cantidad consumida" disabled={consumptionBusy} placeholder={formatUnit === 'fotocopias' ? 'Copias' : 'Cantidad Q'} value={draftAmounts[index] || ''} onChange={(event) => setDraftAmounts((current) => ({ ...current, [index]: event.target.value }))} /> : '')}</td>
                  <td>{entry ? formatAmount(entry.saldo, formatUnit) : editable && amountThroughRow ? formatAmount(formatUnit === 'fotocopias' ? activeBalance - amountThroughRow / COPIES_PER_QUETZAL : activeBalance - amountThroughRow, formatUnit) : ''}</td>
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
