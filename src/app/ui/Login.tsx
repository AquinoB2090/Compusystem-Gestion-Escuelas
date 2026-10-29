'use client';

import { useState } from 'react';
import { toast } from './Toaster';

export default function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setErrorState] = useState('');
  const [busy, setBusy] = useState(false);
  const setError = (message: string) => { setErrorState(message); if (message) toast.error(message); };

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    const response = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const result = await response.json().catch(() => ({ error: 'No se pudo iniciar sesión.' }));
    if (!response.ok) {
      setError(result.error || 'No se pudo iniciar sesión.');
      setBusy(false);
      return;
    }
    location.href = '/';
  }

  return <main className="login-shell">
    <div className="login-art">
      <div className="brand-mark">C</div>
      <span className="eyebrow">COMPUSYSTEM · GESTIÓN ESCOLAR</span>
      <h1>Control claro,<br />mes a mes.</h1>
      <p>Consulta y administra los saldos y consumos de cada maestro.</p>
      <div className="art-note">Administración · Escuelas · Clientes</div>
    </div>
    <section className="login-panel"><div className="login-form">
      <div className="mobile-brand">COMPUSYSTEM</div>
      <span className="eyebrow">PORTAL PRIVADO</span>
      <h2>Iniciar sesión</h2>
      <p className="muted">Ingresa tu usuario y contraseña.</p>
      <form onSubmit={submit}>
        <label>Usuario<input autoComplete="username" required autoFocus value={username} onChange={(event) => setUsername(event.target.value)} placeholder="Tu usuario" /></label>
        <label>Contraseña<input type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Tu contraseña" /></label>
        {error && <div className="alert error">{error}</div>}
        <button className="button primary full" disabled={busy}>{busy ? 'Ingresando...' : 'Iniciar sesión'}<span>→</span></button>
      </form>
      <div className="login-foot">Acceso exclusivo para personal autorizado</div>
    </div></section>
  </main>;
}
