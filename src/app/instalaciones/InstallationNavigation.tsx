import type { InstallationRole } from './access';

export default function InstallationNavigation({ role, name }: { role: InstallationRole; name: string }) {
  return <>
    <aside className="installation-sidebar">
      <a className="installation-brand-lockup" href="/instalaciones"><span className="installation-logo">C</span><span><b>Compusystem</b><small>INSTALACIONES</small></span></a>
      <div className="installation-nav-label">ESPACIO DE TRABAJO</div>
      <nav className="installation-nav" aria-label="Navegación de Instalaciones">
        <a href="/instalaciones"><span>⌂</span>Resumen</a>
        <a href="/instalaciones/precios"><span>₲</span>Precios</a>
        <a href="/instalaciones/cotizaciones"><span>Q</span>Cotizaciones</a>
        {role === 'admin' && <>
          <div className="installation-nav-label">ADMINISTRACIÓN</div>
          <a href="/instalaciones/precios/revision"><span>✓</span>Revisión</a>
          <a href="/instalaciones/precios/documentos"><span>▤</span>Documentos</a>
          <a href="/instalaciones/precios/proveedores"><span>◈</span>Proveedores</a>
        </>}
      </nav>
      <div className="installation-sidebar-bottom">
        <div className="installation-user"><span>{name.slice(0, 1).toUpperCase()}</span><div><b>{name}</b><small>{role === 'admin' ? 'Administración' : 'Ventas'}</small></div></div>
        <form action="/auth/signout" method="post"><button className="installation-logout">Cerrar sesión</button></form>
      </div>
    </aside>
    <header className="installation-mobile-header">
      <a className="installation-brand-lockup" href="/instalaciones"><span className="installation-logo">C</span><span><b>Compusystem</b><small>INSTALACIONES</small></span></a>
      <form action="/auth/signout" method="post"><button className="installation-logout">Salir</button></form>
    </header>
    <nav className="installation-mobile-nav" aria-label="Navegación de Instalaciones">
      <a href="/instalaciones">Resumen</a><a href="/instalaciones/precios">Precios</a><a href="/instalaciones/cotizaciones">Cotizaciones</a>
      {role === 'admin' && <><a href="/instalaciones/precios/revision">Revisión</a><a href="/instalaciones/precios/documentos">Documentos</a><a href="/instalaciones/precios/proveedores">Proveedores</a></>}
    </nav>
  </>;
}
