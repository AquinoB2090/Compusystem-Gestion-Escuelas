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
  const [draftAmounts, setDraftAmounts] = useState<Record<number, string>>({});
  const [draftUnits, setDraftUnits] = useState<Record<number, 'fotocopias' | 'quetzales'>>({});
  const [sheetError, setSheetError] = useState('');
  const [consumptionBusy, setConsumptionBusy] = useState(false);
  const [autoSaveStatus, setAutoSaveStatus] = useState('');
  const autosavedRows = useRef(new Map<number, number>());
  const savingRows = useRef(new Set<number>());
  const [pdfBusy, setPdfBusy] = useState(false);
  const [consumptionError, setConsumptionError] = useState('');
  const [sheetRefresh, setSheetRefresh] = useState(0);
  const dialog = useRef<HTMLDialogElement>(null);

  const school = schools.find((item) => item.id === schoolId) || null;
  const schoolTeachers = teachers.filter((teacher) => teacher.escuela_id === schoolId && teacher.activo !== false);
  const activeBalance = activeTeacher ? balances.find((balance) => balance.maestro_id === activeTeacher.id)?.saldo || 0 : 0;
  const formatUnit = 'fotocopias' as const;
  const entryRowCount = Math.max(22, entries.length + 1);
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
    setDraftAmounts({});
    setDraftUnits({});
    setSheetError('');
    autosavedRows.current.clear();
    setAutoSaveStatus('');
    Promise.all([
      supabase.from('hoja_maestro_acumulada').select('fecha,tipo,catedratico,descripcion,importe,saldo,unidad').eq('maestro_id', activeTeacher.id).eq('periodo', `${month}-01`).order('fecha'),
      supabase.from('consumos').select('id,fecha,catedratico,descripcion,monto,unidad').eq('maestro_id', activeTeacher.id).eq('periodo', `${month}-01`).eq('anulado', false),
    ]).then(([sheet, consumptions]) => {
      if (cancelled) return;
      if (sheet.error || consumptions.error) { setSheetError('No se pudo cargar la hoja de este maestro.'); return; }
      const byKey = new Map<string, any[]>();
      for (const row of consumptions.data || []) { const key = `${row.fecha}|${row.catedratico}|${row.descripcion}|${Number(row.monto)}`; byKey.set(key, [...(byKey.get(key)||[]), row]); }
      setEntries((sheet.data || []).map((row: any) => {
        if (row.tipo !== 'consumo') return row as SheetEntry;
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

  async function autosaveRow(index: number, form: HTMLFormElement | null) {
    if (!activeTeacher || !form || savingRows.current.has(index)) return;
    const values = new FormData(form);
    const fecha = String(values.get(`fecha-${index}`) || '');
    const descripcion = String(values.get(`descripcion-${index}`) || '').trim();
    const monto = Number(values.get(`monto-${index}`));
    const unidad = String(values.get(`unidad-${index}`) || 'fotocopias') as 'fotocopias'|'quetzales';
    if (!fecha || !descripcion || !Number.isFinite(monto) || monto <= 0) return;
    if (!fecha.startsWith(`${month}-`) || (unidad === 'fotocopias' && !Number.isInteger(monto))) return;
    savingRows.current.add(index); setAutoSaveStatus('Guardando automáticamente…');
    const id = autosavedRows.current.get(index);
    let error: any = null;
    if (id) {
      const response = await fetch('/api/movimientos', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tipo:'consumo', id, cantidad:monto, unidad, fecha, descripcion }) });
      const result = await response.json().catch(()=>({})); if (!response.ok) error = new Error(result.error || 'No se pudo guardar la fila.');
    } else {
      const result = await supabase.from('consumos').insert({ maestro_id:activeTeacher.id, fecha, catedratico:descripcion, descripcion:String(monto), monto:unidad==='fotocopias'?monto/COPIES_PER_QUETZAL:monto, unidad, recibido_conforme:false, recibido_por:null }).select('id').single();
      error = result.error; if (result.data?.id) autosavedRows.current.set(index, Number(result.data.id));
    }
    savingRows.current.delete(index);
    if (error) { setAutoSaveStatus(`No se guardó automáticamente: ${error.message}`); return; }
    setAutoSaveStatus('Cambios guardados automáticamente.');
  }

  async function registerConsumption(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeTeacher) return;
    const form = event.currentTarget;
    for (let attempt = 0; attempt < 300 && savingRows.current.size; attempt += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, 100));
    }
    const values = new FormData(form);
    const today = defaultEntryDate(month);
    const pending = Array.from({ length: entryRowCount - entries.length }, (_, offset) => entries.length + offset)
      .map((index) => {
        if (autosavedRows.current.has(index)) return null;
        const fecha = String(values.get(`fecha-${index}`) || '');
        const descripcion = String(values.get(`descripcion-${index}`) || '').trim();
        const monto = Number(values.get(`monto-${index}`));
        const unidad = String(values.get(`unidad-${index}`) || 'fotocopias') as 'fotocopias' | 'quetzales';
        return {
          fecha,
          descripcion,
          monto,
          unidad,
          automaticDefaults: index === entries.length && fecha === today && !descripcion && !(monto > 0),
        };
      })
      .filter((row): row is NonNullable<typeof row> => row !== null && !row.automaticDefaults && Boolean(row.fecha || row.descripcion || Number.isFinite(row.monto) && row.monto > 0));
    if (!pending.length) {
      if (autosavedRows.current.size) { autosavedRows.current.clear(); setAutoSaveStatus('Todos los cambios están guardados.'); setSheetRefresh(value=>value+1); await onRefresh(); return; }
      setConsumptionError('Ingresa al menos un consumo antes de guardar el formato.');
      return;
    }
    for (const row of pending) {
      if (!row.fecha.startsWith(`${month}-`)) {
        setConsumptionError('Cada fecha debe pertenecer al mes seleccionado en la hoja.');
        return;
      }
      if (!row.descripcion || !Number.isFinite(row.monto) || row.monto <= 0) {
        setConsumptionError('Completa fecha, descripción y cantidad en cada fila utilizada.');
        return;
      }
      if (row.unidad === 'fotocopias' && !Number.isInteger(row.monto)) {
        setConsumptionError('La cantidad de fotocopias debe ser un numero entero.');
        return;
      }
    }
    setConsumptionBusy(true);
    setConsumptionError('');
    const { error } = await supabase.from('consumos').insert(pending.map((row) => ({
      maestro_id: activeTeacher.id,
      fecha: row.fecha,
      catedratico: row.descripcion,
      descripcion: String(row.monto),
      monto: row.unidad === 'fotocopias' ? row.monto / COPIES_PER_QUETZAL : row.monto,
      unidad: row.unidad,
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
    setDraftUnits({});
    autosavedRows.current.clear();
    setAutoSaveStatus('');
    setConsumptionError('');
    setSheetRefresh((value) => value + 1);
    await onRefresh();
    setConsumptionBusy(false);
  }

  async function editFormatEntry(entry: SheetEntry) {
    if (!entry.id) return;
    const unit = entry.unidad === 'quetzales' ? 'quetzales' : 'fotocopias';
    const quantity = unit === 'fotocopias' ? Number(entry.descripcion) : Number(entry.importe);
    const nextQuantity = window.prompt(unit === 'fotocopias' ? 'Cantidad de fotocopias:' : 'Cantidad en quetzales:', String(quantity));
    if (nextQuantity === null) return;
    const amount = Number(nextQuantity);
    if (!Number.isFinite(amount) || amount <= 0 || (unit === 'fotocopias' && !Number.isInteger(amount))) { setSheetError('La cantidad no es válida.'); return; }
    const nextDate = window.prompt('Fecha (AAAA-MM-DD):', entry.fecha); if (!nextDate) return;
    const nextDescription = window.prompt('Descripción:', entry.catedratico || ''); if (!nextDescription?.trim()) return;
    const response = await fetch('/api/movimientos', {method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({tipo:'consumo',id:entry.id,cantidad:amount,unidad:unit,fecha:nextDate,descripcion:nextDescription.trim()})});
    const result = await response.json().catch(()=>({})); if (!response.ok) { setSheetError(result.error || 'No se pudo editar la fila.'); return; }
    setSheetRefresh(value=>value+1); await onRefresh();
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
          <button className="button primary" type="submit" form="school-consumption-form" disabled={consumptionBusy}>{consumptionBusy ? 'Guardando...' : 'Guardar formato'}</button>
          <button className="button primary" type="button" onClick={downloadFormatPdf} disabled={pdfBusy}>{pdfBusy ? 'Preparando PDF...' : 'Descargar PDF'}</button>
        </div>
        <div className="print-sheet school-print-sheet">
          <div className="school-sheet-branding"><Image src="/compusystem-logo.jpeg" alt="Logotipo de Compusystem" width={802} height={507} className="school-sheet-logo" /></div>
          <div className="school-sheet-contact"><b>Prop. Olga Marina Arrivillaga Aldana de Aquino</b><span>Barrio El Porvenir, Guastatoya, El Progreso</span><span>Tel. 7945-0482 · e-mail: compussystem@hotmail.com</span><span>NIT 48577030</span></div>
          <div className="school-sheet-rule" />
          <div className="school-sheet-meta"><span>Seño: <b>{activeTeacher?.nombre || '________________________'}</b></span><span>Mes <b>{monthLabel(month)}</b></span><b>{formatAmount(activeBalance, formatUnit)}</b></div>
          {consumptionError && <p className="sheet-entry-error no-print">{consumptionError}</p>}
          {autoSaveStatus && <p className="sheet-entry-hint no-print">{autoSaveStatus}</p>}
          <p className="sheet-entry-hint no-print">En cada fila elige si la cantidad corresponde a fotocopias o quetzales. El saldo se calcula en fotocopias. Guarda todas las filas con el botón Guardar formato.</p>
          {sheetError && <p className="sheet-load-error">{sheetError}</p>}
          <form id="school-consumption-form" onSubmit={registerConsumption}>
          <table className="school-format-table">
            <thead><tr><th>Fecha</th><th>Descripci&oacute;n</th><th>Cantidad</th><th>Saldo fotocopias</th></tr></thead>
            <tbody>
              {Array.from({ length: entryRowCount }, (_, index) => {
                const entry = entries[index];
                const editable = Boolean(activeTeacher) && index >= entries.length;
                const amountThroughRow = Object.entries(draftAmounts).reduce((sum, [rowIndex, amount]) => Number(rowIndex) <= index ? sum + ((Number(amount) || 0) / (draftUnits[Number(rowIndex)] === 'quetzales' ? 1 : COPIES_PER_QUETZAL)) : sum, 0);
                return <tr key={index} className={editable ? 'sheet-entry-row' : undefined}>
                  <td>{entry?.fecha ? new Intl.DateTimeFormat('es-GT').format(new Date(entry.fecha + 'T12:00:00')) : editable ? <input className="sheet-cell-input" type="date" name={`fecha-${index}`} aria-label="Fecha" defaultValue={index === entries.length ? defaultEntryDate(month) : undefined} disabled={consumptionBusy} onBlur={event=>void autosaveRow(index,event.currentTarget.form)} /> : ''}</td>
                  <td>{entry?.catedratico || (editable ? <input className="sheet-cell-input" name={`descripcion-${index}`} aria-label="Descripción del consumo" disabled={consumptionBusy} placeholder="Describe el consumo" onBlur={event=>void autosaveRow(index,event.currentTarget.form)} /> : '')}{entry?.id && <button className="button secondary small no-print" type="button" onClick={()=>void editFormatEntry(entry)}>Editar</button>}</td>
                    <td>{entry ? entry.tipo === 'ajuste' ? formatAmount(entry.importe, formatUnit) : entry.unidad === 'quetzales' ? money(entry.importe) : `${Number(entry.descripcion || 0).toLocaleString('es-GT')} fotocopias` : editable ? <div className="sheet-cell-amount"><input className="sheet-cell-input" type="number" name={`monto-${index}`} min={draftUnits[index] === 'quetzales' ? '0.01' : '1'} step={draftUnits[index] === 'quetzales' ? '0.01' : '1'} aria-label="Cantidad consumida" disabled={consumptionBusy} placeholder="Cantidad" value={draftAmounts[index] || ''} onChange={(event) => setDraftAmounts((current) => ({ ...current, [index]: event.target.value }))} onBlur={event=>void autosaveRow(index,event.currentTarget.form)} /><select className="sheet-unit-select" name={`unidad-${index}`} aria-label="Unidad del consumo" disabled={consumptionBusy} value={draftUnits[index] || 'fotocopias'} onChange={(event) => setDraftUnits((current) => ({ ...current, [index]: event.target.value as 'fotocopias' | 'quetzales' }))} onBlur={event=>void autosaveRow(index,event.currentTarget.form)}><option value="fotocopias">Copias</option><option value="quetzales">Quetzales</option></select></div> : ''}</td>
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
