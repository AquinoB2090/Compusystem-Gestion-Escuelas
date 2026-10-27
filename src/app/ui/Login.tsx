'use client';
import { useEffect, useState } from 'react';
type Mode='admin'|'director';
type School={id:number;nombre:string};
export default function Login() {
  const [mode,setMode]=useState<Mode|null>(null);
  const [password,setPassword]=useState('');
  const [schoolId,setSchoolId]=useState('');
  const [schools,setSchools]=useState<School[]>([]);
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const [loadingSchools,setLoadingSchools]=useState(false);

  useEffect(()=>{if(mode!=='director')return;setLoadingSchools(true);fetch('/api/login').then(async response=>{const result=await response.json();if(!response.ok)throw new Error(result.error);setSchools(result.schools||[]);}).catch(e=>setError(e.message||'No se pudieron cargar las escuelas.')).finally(()=>setLoadingSchools(false));},[mode]);

  async function submit(e:React.FormEvent){
    e.preventDefault();if(!mode)return;setBusy(true);setError('');
    const response=await fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({role:mode,password,school_id:mode==='director'?schoolId:undefined})});
    const result=await response.json().catch(()=>({error:'No se pudo iniciar sesión.'}));
    if(!response.ok){setError(result.error||'No se pudo iniciar sesión.');setBusy(false);return;}
    location.href='/';
  }

  function choose(next:Mode){setError('');setPassword('');setSchoolId('');setMode(next);}
  return <main className="login-shell"><div className="login-art"><div className="brand-mark">C</div><span className="eyebrow">COMPUSYSTEM · GESTIÓN ESCOLAR</span><h1>Control claro,<br/>mes a mes.</h1><p>Consulta y administra los saldos de fotocopias de cada maestro.</p><div className="art-note">Administración · Escuelas · Saldos</div></div><section className="login-panel"><div className="login-form"><div className="mobile-brand">COMPUSYSTEM</div><span className="eyebrow">PORTAL PRIVADO</span>{!mode?<><h2>¿Cómo deseas ingresar?</h2><p className="muted">Selecciona el apartado que corresponde a tu cuenta.</p><div className="login-options"><button className="login-option" onClick={()=>choose('admin')}><span className="option-mark admin-mark">C</span><span><b>Compusystem</b><small>Acceso de administración</small></span><strong>→</strong></button><button className="login-option" onClick={()=>choose('director')}><span className="option-mark director-mark">D</span><span><b>Director</b><small>Consulta de saldos escolares</small></span><strong>→</strong></button></div></>:<><button className="back-link" onClick={()=>setMode(null)}>← Cambiar apartado</button><h2>{mode==='admin'?'Compusystem':'Directory'}</h2><p className="muted">Ingresa la contraseña de tu cuenta.</p><form onSubmit={submit}>{mode==='director'&&<label>Escuela<select required value={schoolId} onChange={e=>setSchoolId(e.target.value)} disabled={loadingSchools}><option value="">{loadingSchools?'Cargando escuelas…':'Selecciona tu escuela'}</option>{schools.map(s=><option value={s.id} key={s.id}>{s.nombre}</option>)}</select></label>}<label>Contraseña<input type="password" autoComplete="current-password" required autoFocus value={password} onChange={e=>setPassword(e.target.value)} placeholder="Tu contraseña"/></label>{error&&<div className="alert error">{error}</div>}<button className="button primary full" disabled={busy||loadingSchools}>{busy?'Ingresando…':'Iniciar sesión'}<span>→</span></button></form></>}<div className="login-foot">Acceso exclusivo para personal autorizado</div></div></section></main>
}
