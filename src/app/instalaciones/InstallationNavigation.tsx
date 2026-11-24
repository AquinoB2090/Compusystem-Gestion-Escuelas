import Link from 'next/link';
import type { InstallationRole } from './access';

export default function InstallationNavigation({ role, name }: { role: InstallationRole; name: string }) {
  return <>
    <aside className="installation-sidebar">
      <Link className="installation-brand-lockup" href="/instalaciones"><span className="installation-logo">C</span><span><b>Compusystem</b><small>INSTALACIONES</small></span></Link>
      <div className="installation-nav-label">ESPACIO DE TRABAJO</div>
      <nav className="installation-nav" aria-label="NavegaciÃ³n de Instalaciones">
        <Link href="/instalaciones"><span>âŒ‚</span>Resumen</Link>
        <Link href="/instalaciones/precios"><span>â‚²</span>Precios</Link>
        <Link href="/instalaciones/cotizaciones"><span>Q</span>Cotizaciones</Link>
        {role === 'admin' && <>
          <div className="installation-nav-label">ADMINISTRACIÃ“N</div>
          <Link href="/instalaciones/precios/revision"><span>âœ“</span>RevisiÃ³n</Link>
          <Link href="/instalaciones/precios/documentos"><span>â–¤</span>Documentos</Link>
          <Link href="/instalaciones/precios/proveedores"><span>â—ˆ</span>Proveedores</Link>
        </>}
      </nav>
      <div className="installation-sidebar-bottom">
        {role === 'admin' && <Link className="installation-switch" href="/"><span>â†—</span>Escuelas y clientes</Link>}
        <div className="installation-user"><span>{name.slice(0, 1).toUpperCase()}</span><div><b>{name}</b><small>{role === 'admin' ? 'AdministraciÃ³n' : 'Ventas'}</small></div></div>
        <form action="/auth/signout" method="post"><button className="installation-logout">Cerrar sesiÃ³n</button></form>
      </div>
    </aside>
    <header className="installation-mobile-header">
      <Link className="installation-brand-lockup" href="/instalaciones"><span className="installation-logo">C</span><span><b>Compusystem</b><small>INSTALACIONES</small></span></Link>
      <form action="/auth/signout" method="post"><button className="installation-logout">Salir</button></form>
    </header>
    <nav className="installation-mobile-nav" aria-label="NavegaciÃ³n de Instalaciones">
      <Link href="/instalaciones">Resumen</Link><Link href="/instalaciones/precios">Precios</Link><Link href="/instalaciones/cotizaciones">Cotizaciones</Link>
      {role === 'admin' && <><Link href="/instalaciones/precios/revision">RevisiÃ³n</Link><Link href="/instalaciones/precios/documentos">Documentos</Link><Link href="/instalaciones/precios/proveedores">Proveedores</Link></>}
    </nav>
  </>;
}
