'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import { createClient } from '@/lib/supabase/client';
import { downloadTeacherSheetPdf } from '@/lib/teacherSheetPdf';

type School = { id: number; nombre: string };
type Teacher = { id: number; nombre: string; escuela_id: number; tipo_formato?: 'quetzales' | 'fotocopias'; activo?: boolean };
type Balance = { maestro_id: number; saldo: number };
type MonthlyConsumption = { maestro_id: number; escuela_id: number; fecha: string; monto: number; descripcion: string; unidad: 'fotocopias' | 'quetzales' };
type SheetEntry = {
  id?: number;
  tipo: string;
  fecha: string;
  catedratico: string | null;
  descripcion: string;
  importe: number;
  saldo: number;
  unidad: 'fotocopias' | 'quetzales';
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
  const [dashboardSection, setDashboardSection] = useState<'resumen' | 'escuelas'>('resumen');
  const [addingSchool, setAddingSchool] = useState(false);
  const [schoolName, setSchoolName] = useState('');
  const [directorName, setDirectorName] = useState('');
  const [directorPassword, setDirectorPassword] = useState('');
  const [schoolBusy, setSchoolBusy] = useState(false);
  const [schoolError, setSchoolError] = useState('');
  const [schoolSuccess, setSchoolSuccess] = useState('');
  const [addingTeacher, setAddingTeacher] = useState(false);
  const [teacherSearch, setTeacherSearch] = useState('');
  const [globalTeacherSearch, setGlobalTeacherSearch] = useState('');
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
  const [sheetError, setSheetError] = useState('');
  const [consumptionBusy, setConsumptionBusy] = useState(false);
  const [editingEntry, setEditingEntry] = useState<SheetEntry | null>(null);
  const [editingValues, setEditingValues] = useState({ fecha: '', descripcion: '', cantidad: '', unidad: 'fotocopias' as 'fotocopias' | 'quetzales' });
  const [pdfBusy, setPdfBusy] = useState(false);
  const [consumptionError, setConsumptionError] = useState('');
  const [sheetRefresh, setSheetRefresh] = useState(0);
  const dialog = useRef<HTMLDialogElement>(null);

  const school = schools.find((item) => item.id === schoolId) || null;
  const schoolTeachers = teachers.filter((teacher) => teacher.escuela_id === schoolId && teacher.activo !== false);
  const activeBalance = activeTeacher ? balances.find((balance) => balance.maestro_id === activeTeacher.id)?.saldo || 0 : 0;
  const formatUnit = 'fotocopias' as const;
  const consumedRows = monthlyConsumption.filter((row) => Number(row.monto) > 0);
  const consumedQuetzales = consumedRows.filter((row) => row.unidad === 'quetzales').reduce((sum, row) => sum + Number(row.monto || 0), 0);
  const consumedCopiesQuetzales = consumedRows.filter((row) => row.unidad === 'fotocopias').reduce((sum, row) => sum + Number(row.monto || 0), 0);
  const consumedCopies = consumedRows.filter((row) => row.unidad === 'fotocopias').reduce((sum, row) => sum + Number(row.descripcion || 0), 0);
  const consumedTotalQuetzales = consumedQuetzales + consumedCopiesQuetzales;
  const schoolConsumption = Object.entries(consumedRows.reduce<Record<number, { quetzales: number; fotocopias: number; maestros: Set<number> }>>((totals, row) => {
    const current = totals[row.escuela_id] || { quetzales: 0, fotocopias: 0, maestros: new Set<number>() };
    current.quetzales += Number(row.monto || 0);
    if (row.unidad === 'fotocopias') current.fotocopias += Number(row.descripcion || 0);
    current.maestros.add(row.maestro_id);
    totals[row.escuela_id] = current;
    return totals;
  }, {})).sort((a, b) => b[1].quetzales - a[1].quetzales);

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
    setSheetError('');
    Promise.all([
      supabase.from('hoja_maestro_acumulada').select('id,fecha,tipo,catedratico,descripcion,importe,saldo,unidad').eq('maestro_id', activeTeacher.id).eq('periodo', `${month}-01`).order('fecha'),
      supabase.from('consumos').select('id,fecha,catedratico,descripcion,monto,unidad').eq('maestro_id', activeTeacher.id).eq('periodo', `${month}-01`).eq('anulado', false),
    ]).then(([sheet, consumptions]) => {
      if (cancelled) return;
      if (sheet.error || consumptions.error) { setSheetError('No se pudo cargar la hoja de este maestro.'); return; }
      const byKey = new Map<string, any[]>();
      for (const row of consumptions.data || []) { const key = `${row.fecha}|${row.catedratico}|${row.descripcion}|${Number(row.monto)}`; byKey.set(key, [...(byKey.get(key)||[]), row]); }
      setEntries((sheet.data || []).map((row: any) => {
        if (row.tipo !== 'consumo') return { ...row, id: undefined } as SheetEntry;
        const key = `${row.fecha}|${row.catedratico}|${row.descripcion}|${Number(row.importe)}`;
        const match = byKey.get(key)?.shift();
        return { ...row, id: match?.id } as SheetEntry;
      }));
    });
    return () => { cancelled = true; };
  }, [activeTeacher, month, sheetRefresh, supabase]);

  useEffect(() => {
    let cancelled = false;
    const [year, monthNumber] = summaryMonth.split('-').map(Number);
    const nextMonth = `${monthNumber === 12 ? year + 1 : year}-${String(monthNumber === 12 ? 1 : monthNumber + 1).padStart(2, '0')}-01`;
    supabase.from('consumos').select('maestro_id,fecha,monto,descripcion,unidad').eq('anulado', false).gte('fecha', `${summaryMonth}-01`).lt('fecha', nextMonth).then(({ data, error }) => {
      if (cancelled) return;
      if (error) {
        setSummaryError('No se pudo cargar el resumen mensual de consumos.');
        return;
      }
      setSummaryError('');
      setMonthlyConsumption((data || []).map((row: any) => ({
        ...row,
        escuela_id: teachers.find((teacher) => teacher.id === row.maestro_id)?.escuela_id ?? 0,
      })) as MonthlyConsumption[]);
    });
    return () => { cancelled = true; };
  }, [summaryMonth, sheetRefresh, supabase, teachers]);

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
    setSchoolSuccess(`Escuela y usuario creados. Usuario del director: ${result.username}.`);
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
    setSchoolBusy(true);
    const response = await fetch('/api/saldos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ maestro_id: teacher.id, saldo_fotocopias: saldo }),
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
    const fecha = String(values.get('fecha') || '');
    const descripcion = String(values.get('descripcion') || '').trim();
    const cantidad = Number(values.get('cantidad'));
    const unidad = String(values.get('unidad') || 'fotocopias') as 'fotocopias' | 'quetzales';
    if (!fecha.startsWith(`${month}-`) || !descripcion || !Number.isFinite(cantidad) || cantidad <= 0 || (unidad === 'fotocopias' && !Number.isInteger(cantidad))) {
      setConsumptionError('Revisa la fecha, descripción y cantidad. Las fotocopias deben ser un número entero y la fecha debe pertenecer al mes seleccionado.');
      return;
    }
    setConsumptionBusy(true);
    setConsumptionError('');
    const { error } = await supabase.from('consumos').insert({
      maestro_id: activeTeacher.id,
      fecha,
      catedratico: descripcion,
      descripcion: String(cantidad),
      monto: unidad === 'fotocopias' ? cantidad / COPIES_PER_QUETZAL : cantidad,
      unidad,
      recibido_conforme: false,
      recibido_por: null,
    });
    if (error) {
      setConsumptionError(`No se pudo guardar el consumo: ${error.message}`);
      setConsumptionBusy(false);
      return;
    }
    form.reset();
    setSheetRefresh(value => value + 1);
    await onRefresh();
    setConsumptionBusy(false);
  }

  function beginEditEntry(entry: SheetEntry) {
    setEditingEntry(entry);
    const unidad = entry.unidad === 'quetzales' ? 'quetzales' : 'fotocopias';
    setEditingValues({
      fecha: entry.fecha,
      descripcion: entry.catedratico || '',
      cantidad: String(unidad === 'fotocopias' ? Number(entry.descripcion || 0) : Number(entry.importe || 0)),
      unidad,
    });
  }

  async function saveEditedEntry(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingEntry?.id) return;
    const cantidad = Number(editingValues.cantidad);
    if (!editingValues.fecha.startsWith(`${month}-`) || !editingValues.descripcion.trim() || !Number.isFinite(cantidad) || cantidad <= 0 || (editingValues.unidad === 'fotocopias' && !Number.isInteger(cantidad))) {
      setSheetError('Revisa fecha, descripción y cantidad. La fecha debe pertenecer al mes y las fotocopias deben ser enteras.');
      return;
    }
    setConsumptionBusy(true);
    setSheetError('');
    const response = await fetch('/api/movimientos', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tipo: 'consumo', id: editingEntry.id, cantidad, unidad: editingValues.unidad, fecha: editingValues.fecha, descripcion: editingValues.descripcion.trim() }) });
    const result = await response.json().catch(() => ({}));
    setConsumptionBusy(false);
    if (!response.ok) { setSheetError(result.error || 'No se pudo actualizar el consumo.'); return; }
    setEditingEntry(null);
    setSheetRefresh(value => value + 1);
    await onRefresh();
  }

  async function editCurrentBalance() {
    if (activeTeacher) await editTeacherBalance(activeTeacher, activeBalance);
  }

  async function downloadFormatPdf() {
    if (!activeTeacher) return;
    setPdfBusy(true);
    setSheetError('');
    try {
      const { data, error } = await supabase
        .from('hoja_maestro_acumulada')
        .select('fecha,tipo,catedratico,descripcion,importe,saldo,unidad')
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
              <h1>{dashboardSection === 'resumen' ? 'Resumen' : 'Escuelas'}</h1>
              <p>{dashboardSection === 'resumen' ? 'Consulta los consumos generales del sistema.' : 'Selecciona una escuela para abrir sus formatos y administrar sus maestros.'}</p>
            </div>
            <div className="table-tools">
              <div className="date-pill">{new Intl.DateTimeFormat('es-GT', { day: 'numeric', month: 'long', year: 'numeric' }).format(now)}</div>
              {dashboardSection === 'escuelas' && <button className="button primary add-school-cta" type="button" onClick={() => { setAddingSchool((value) => !value); setSchoolError(''); }}>
                {addingSchool ? 'Cancelar' : '+ Agregar escuela'}
              </button>}
            </div>
          </div>
          {dashboardSection === 'escuelas' && <section className="global-teacher-search"><div className="section-head"><div><h2>Buscar maestro en todas las escuelas</h2><p>Busca por nombre sin abrir primero una escuela.</p></div></div><label className="search"><span>⌕</span><input aria-label="Buscar maestro en todas las escuelas" placeholder="Nombre del maestro..." value={globalTeacherSearch} onChange={event => setGlobalTeacherSearch(event.target.value)} /></label>{globalTeacherSearch.trim() && <div className="teacher-sheet-grid">{teachers.filter(t=>t.activo!==false&&t.nombre.toLocaleLowerCase().includes(globalTeacherSearch.trim().toLocaleLowerCase())).slice(0,12).map((teacher,index)=><article className="teacher-sheet-card" key={teacher.id}><span className={`teacher-avatar tone-${index%5}`}>{teacher.nombre.slice(0,1)}</span><div className="teacher-sheet-info"><b>{teacher.nombre}</b><small>{schools.find(s=>s.id===teacher.escuela_id)?.nombre||'Escuela'}</small></div><button className="button secondary small" onClick={()=>{setSchoolId(teacher.escuela_id);setActiveTeacher(teacher);setMonth(currentMonth);}}>Abrir formato</button></article>)}{!teachers.some(t=>t.activo!==false&&t.nombre.toLocaleLowerCase().includes(globalTeacherSearch.trim().toLocaleLowerCase()))&&<div className="empty school-empty">No se encontraron maestros.</div>}</div>}</section>}
          <div className="dashboard-tabs"><button className={`button ${dashboardSection === 'resumen' ? 'primary' : 'secondary'}`} onClick={() => setDashboardSection('resumen')}>Resumen</button><button className={`button ${dashboardSection === 'escuelas' ? 'primary' : 'secondary'}`} onClick={() => setDashboardSection('escuelas')}>Escuelas</button></div>
          {dashboardSection === 'escuelas' && <>
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
          </>}
          {dashboardSection === 'resumen' && <>
          <div className="stats">
            <div className="stat-card">
              <div className="stat-top"><span>Consumo total equivalente en Q</span><span className="stat-icon green">Q</span></div>
              <strong>{money(consumedTotalQuetzales)}</strong>
              <small>Incluye consumos en quetzales y copias · {monthLabel(summaryMonth)}</small>
            </div>
            <div className="stat-card">
              <div className="stat-top"><span>Fotocopias consumidas</span><span className="stat-icon orange">▤</span></div>
              <strong>{consumedCopies.toLocaleString('es-GT')} fotocopias</strong>
              <small>Equivalente de las copias: {money(consumedCopiesQuetzales)} · {monthLabel(summaryMonth)}</small>
            </div>
            <div className="stat-card">
              <div className="stat-top"><span>Maestros con consumo</span><span className="stat-icon blue">♙</span></div>
              <strong>{new Set(consumedRows.map((row) => row.maestro_id)).size}</strong>
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
                    <td>{money(totals.quetzales)}</td>
                    <td>{totals.fotocopias.toLocaleString('es-GT')} fotocopias</td>
                    <td>{totals.maestros.size}</td>
                  </tr>
                ))}
                {!schoolConsumption.length && <tr><td className="empty" colSpan={4}>No hay consumos registrados en {monthLabel(summaryMonth)}.</td></tr>}
              </tbody>
            </table>
          </div>
          </>}
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
              <div className="teacher-list-head"><h2>Maestros</h2><span>{schoolTeachers.length} registrados</span><label className="search teacher-search"><span>⌕</span><input aria-label="Buscar maestro" placeholder="Buscar maestro..." value={teacherSearch} onChange={(event) => setTeacherSearch(event.target.value)} /></label></div>
          <div className="teacher-sheet-grid">
            {schoolTeachers.filter((teacher) => teacher.nombre.toLocaleLowerCase().includes(teacherSearch.toLocaleLowerCase().trim())).map((teacher, index) => {
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
          <button className="button primary" type="button" onClick={downloadFormatPdf} disabled={pdfBusy}>{pdfBusy ? 'Preparando PDF...' : 'Descargar PDF'}</button>
        </div>
        <div className="print-sheet school-print-sheet">
          <div className="school-sheet-branding"><Image src="/compusystem-logo.jpeg" alt="Logotipo de Compusystem" width={802} height={507} className="school-sheet-logo" /></div>
          <div className="school-sheet-contact"><b>Prop. Olga Marina Arrivillaga Aldana de Aquino</b><span>Barrio El Porvenir, Guastatoya, El Progreso</span><span>Tel. 7945-0482 · e-mail: compussystem@hotmail.com</span><span>NIT 48577030</span></div>
          <div className="school-sheet-rule" />
          <div className="school-sheet-meta"><span>Seño: <b>{activeTeacher?.nombre || '________________________'}</b></span><span>Mes <b>{monthLabel(month)}</b></span><b>{formatAmount(activeBalance, formatUnit)}</b></div>
          {consumptionError && <p className="sheet-entry-error no-print">{consumptionError}</p>}
          {sheetError && <p className="sheet-load-error no-print">{sheetError}</p>}
          <div className="teacher-format-actions no-print">
            <button className="button secondary" type="button" disabled={schoolBusy} onClick={editCurrentBalance}>Editar saldo actual</button>
            <span>El saldo de cada movimiento se recalcula al editar su cantidad.</span>
          </div>
          <form key={month} id="school-consumption-form" className="client-consumption-form teacher-consumption-form no-print" onSubmit={registerConsumption}>
            <h2>Registrar consumo</h2>
            <label>Fecha<input className="teacher-dark-field" type="date" name="fecha" required defaultValue={defaultEntryDate(month)} disabled={consumptionBusy} /></label>
            <label>Descripción<input className="teacher-dark-field" name="descripcion" required placeholder="Describe el consumo" disabled={consumptionBusy} /></label>
            <label>Cantidad<input className="teacher-dark-field" type="number" name="cantidad" min="0.01" step="0.01" required placeholder="Cantidad" disabled={consumptionBusy} /></label>
            <label>Unidad<select className="teacher-dark-field" name="unidad" defaultValue="fotocopias" disabled={consumptionBusy}><option value="fotocopias">Fotocopias</option><option value="quetzales">Quetzales</option></select></label>
            <button className="button primary" type="submit" disabled={consumptionBusy}>{consumptionBusy ? 'Guardando…' : 'Guardar consumo'}</button>
          </form>
          <section className="table-card client-history teacher-format-history">
            <div className="table-title">Movimientos de {activeTeacher?.nombre || 'maestro'}</div>
            <div className="teacher-history-scroll"><table><thead><tr><th>FECHA</th><th>DETALLE</th><th>TIPO</th><th>IMPORTE</th><th>SALDO</th><th className="no-print">ACCIONES</th></tr></thead>
              <tbody>{entries.map((entry, index) => <tr key={`${entry.tipo}-${entry.id ?? index}`}>
                {editingEntry?.id === entry.id && entry.tipo === 'consumo' ? <td colSpan={6}><form className="teacher-edit-row" onSubmit={saveEditedEntry}>
                  <label>Fecha<input className="teacher-dark-field" type="date" value={editingValues.fecha} onChange={event => setEditingValues(current => ({ ...current, fecha: event.target.value }))} required /></label>
                  <label>Descripción<input className="teacher-dark-field" value={editingValues.descripcion} onChange={event => setEditingValues(current => ({ ...current, descripcion: event.target.value }))} required /></label>
                  <label>Cantidad<input className="teacher-dark-field" type="number" min="0.01" step={editingValues.unidad === 'fotocopias' ? '1' : '0.01'} value={editingValues.cantidad} onChange={event => setEditingValues(current => ({ ...current, cantidad: event.target.value }))} required /></label>
                  <label>Unidad<select className="teacher-dark-field" value={editingValues.unidad} onChange={event => setEditingValues(current => ({ ...current, unidad: event.target.value as 'fotocopias' | 'quetzales' }))}><option value="fotocopias">Fotocopias</option><option value="quetzales">Quetzales</option></select></label>
                  <div className="teacher-edit-actions"><button className="button primary small" disabled={consumptionBusy}>Guardar</button><button className="button secondary small" type="button" onClick={() => setEditingEntry(null)}>Cancelar</button></div>
                </form></td> : <><td>{entry.fecha}</td><td>{entry.tipo === 'ajuste' ? entry.descripcion : entry.catedratico}</td><td>{entry.tipo === 'ajuste' ? 'Ajuste de saldo' : 'Consumo'}</td><td>{entry.tipo === 'ajuste' ? formatAmount(entry.importe, formatUnit) : entry.unidad === 'quetzales' ? money(entry.importe) : `${Number(entry.descripcion || 0).toLocaleString('es-GT')} fotocopias`}</td><td>{formatAmount(entry.saldo, formatUnit)}</td><td className="no-print">{entry.tipo === 'consumo' && entry.id && <button className="button secondary small" type="button" onClick={() => beginEditEntry(entry)}>Editar</button>}</td></>}
              </tr>)}
              {!entries.length && <tr><td colSpan={6} className="empty">No hay movimientos registrados para este mes.</td></tr>}</tbody>
            </table></div>
          </section>
          <div className="school-sheet-footer">Venta y soporte técnico: Computadoras, cámaras de seguridad, biométrico, control de acceso electrónico, alarmas, red estructurada, desarrollo de software y aire acondicionado.</div>
        </div>
      </dialog>
    </>
  );
}
