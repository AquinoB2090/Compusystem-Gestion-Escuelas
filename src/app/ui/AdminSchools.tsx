'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import { createClient } from '@/lib/supabase/client';

type School = { id: number; nombre: string };
type Teacher = { id: number; nombre: string; escuela_id: number };
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
  const [sheetError, setSheetError] = useState('');
  const [addingConsumption, setAddingConsumption] = useState(false);
  const [consumptionBusy, setConsumptionBusy] = useState(false);
  const [consumptionError, setConsumptionError] = useState('');
  const [consumptionNotice, setConsumptionNotice] = useState('');
  const [sheetRefresh, setSheetRefresh] = useState(0);
  const dialog = useRef<HTMLDialogElement>(null);

  const school = schools.find((item) => item.id === schoolId) || null;
  const schoolTeachers = teachers.filter((teacher) => teacher.escuela_id === schoolId);
  const schoolBalances = balances.filter((balance) => schoolTeachers.some((teacher) => teacher.id === balance.maestro_id));
  const activeBalance = activeTeacher ? balances.find((balance) => balance.maestro_id === activeTeacher.id)?.saldo || 0 : 0;

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
    supabase
      .from('hoja_maestro')
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

  async function registerConsumption(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeTeacher) return;
    const form = event.currentTarget;
    const values = new FormData(form);
    const fecha = String(values.get('fecha') || '');
    const monto = Number(values.get('monto'));
    if (!Number.isFinite(monto) || monto <= 0) {
      setConsumptionError('Ingresa un monto mayor que cero.');
      return;
    }
    setConsumptionBusy(true);
    setConsumptionError('');
    setConsumptionNotice('');
    const { error } = await supabase.from('consumos').insert({
      maestro_id: activeTeacher.id,
      fecha,
      periodo: `${fecha.slice(0, 7)}-01`,
      catedratico: String(values.get('catedratico') || '').trim(),
      descripcion: String(values.get('descripcion') || '').trim(),
      monto,
      recibido_conforme: values.get('recibido_conforme') === 'on',
      recibido_por: String(values.get('recibido_por') || '').trim() || null,
    });
    if (error) {
      setConsumptionError('No se pudo registrar el consumo. Revisa los datos e inténtalo de nuevo.');
      setConsumptionBusy(false);
      return;
    }
    form.reset();
    setConsumptionNotice('Consumo registrado; la hoja y el saldo se actualizaron.');
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
              const total = balances.filter((balance) => teachers.some((teacher) => teacher.id === balance.maestro_id && teacher.escuela_id === item.id)).reduce((sum, balance) => sum + Number(balance.saldo || 0), 0);
              return (
                <button className="school-card" key={item.id} onClick={() => { setSchoolId(item.id); setTeacherSuccess(''); }}>
                  <span className="school-card-icon">⌂</span>
                  <span className="school-card-content"><b>{item.nombre}</b><small>{count} {count === 1 ? 'maestro' : 'maestros'}</small></span>
                  <span className="school-card-balance">{money(total)}</span>
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
                  <div className="teacher-sheet-info"><b>{teacher.nombre}</b><small>Saldo actual · {money(balance)}</small></div>
                  <button className="button secondary small" onClick={() => { setActiveTeacher(teacher); setMonth(currentMonth); setAddingConsumption(false); setConsumptionError(''); setConsumptionNotice(''); }}>Abrir formato</button>
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
          <label className="sheet-month">Mes<select value={month} onChange={(event) => setMonth(event.target.value)}>
            {Array.from({ length: 36 }, (_, index) => {
              const date = new Date(now.getFullYear(), now.getMonth() - index, 1);
              const value = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
              return <option value={value} key={value}>{monthLabel(value)}</option>;
            })}
          </select></label>
          <button className="button secondary" onClick={() => { setAddingConsumption((value) => !value); setConsumptionError(''); }}>{addingConsumption ? 'Cerrar captura' : '+ Registrar consumo'}</button>
          <button className="button primary" onClick={() => window.print()}>Imprimir formato</button>
        </div>
        {consumptionNotice && <div className="alert success no-print">{consumptionNotice}<button onClick={() => setConsumptionNotice('')}>×</button></div>}
        {addingConsumption && <form className="sheet-consumption-form no-print" onSubmit={registerConsumption}>
          <div className="form-heading"><span className="form-icon orange">＋</span><div><h2>Registrar consumo</h2><p>Se agregará a la hoja de {activeTeacher?.nombre}.</p></div></div>
          <div className="sheet-consumption-grid">
            <label>Fecha<input type="date" name="fecha" required defaultValue={new Date().toISOString().slice(0, 10)} /></label>
            <label>Catedrático responsable<input name="catedratico" required placeholder="Nombre de quien solicita" /></label>
            <label className="consumption-description">Descripción<input name="descripcion" required placeholder="Detalle de las fotocopias" /></label>
            <label>Monto Q<input type="number" name="monto" min="0.01" step="0.01" required placeholder="0.00" /></label>
            <label>Recibido por<input name="recibido_por" placeholder="Opcional" /></label>
            <label className="check-row consumption-confirm"><input type="checkbox" name="recibido_conforme" /> Recibido conforme</label>
          </div>
          {consumptionError && <div className="alert error">{consumptionError}</div>}
          <div className="form-actions"><button type="button" className="button secondary" onClick={() => setAddingConsumption(false)}>Cancelar</button><button className="button primary" disabled={consumptionBusy}>{consumptionBusy ? 'Guardando…' : 'Guardar consumo'}</button></div>
        </form>}
        <div className="print-sheet school-print-sheet">
          <div className="school-sheet-branding"><Image src="/compusystem-logo.jpeg" alt="Logotipo de Compusystem" width={802} height={507} className="school-sheet-logo" /></div>
          <div className="school-sheet-contact"><b>Prop. Olga Marina Arrivillaga Aldana de Aquino</b><span>Barrio El Porvenir, Guastatoya, El Progreso</span><span>Tel. 7945-0482 · e-mail: compussystem@hotmail.com</span><span>NIT 48577030</span></div>
          <div className="school-sheet-rule" />
          <div className="school-sheet-meta"><span>Seño: <b>{activeTeacher?.nombre || '________________________'}</b></span><span>Mes <b>{monthLabel(month)}</b></span><span>{new Date(`${month}-01T12:00:00`).getFullYear()}</span><b>{money(activeBalance)}</b></div>
          {sheetError && <p className="sheet-load-error">{sheetError}</p>}
          <table className="school-format-table">
            <thead><tr><th>Fecha</th><th>Catedrático Responsable</th><th>Descripción</th><th>Saldo Q</th></tr></thead>
            <tbody>
              {Array.from({ length: Math.max(22, entries.length) }, (_, index) => {
                const entry = entries[index];
                return <tr key={index}>
                  <td>{entry?.fecha ? new Intl.DateTimeFormat('es-GT').format(new Date(`${entry.fecha}T12:00:00`)) : ''}</td>
                  <td>{entry?.catedratico || ''}</td>
                  <td>{entry?.descripcion || ''}</td>
                  <td>{entry ? money(entry.saldo) : ''}</td>
                </tr>;
              })}
            </tbody>
          </table>
          <div className="school-sheet-footer">Venta y soporte técnico: Computadoras, cámaras de seguridad, biométrico, control de acceso electrónico, alarmas, red estructurada, desarrollo de software y aire acondicionado.</div>
        </div>
      </dialog>
    </>
  );
}
