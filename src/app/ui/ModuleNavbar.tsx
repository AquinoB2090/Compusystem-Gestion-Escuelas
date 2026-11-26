export type ModuleKey = 'escuela' | 'instalaciones' | 'taller';

const MODULES: Record<ModuleKey, { label: string; href: string; icon: string }> = {
  escuela: { label: 'Escuela', href: '/', icon: '▦' },
  instalaciones: { label: 'Instalaciones', href: '/instalaciones', icon: '◈' },
  taller: { label: 'Taller', href: '/taller', icon: '⚒' },
};

export default function ModuleNavbar({ active, available = [active] }: { active: ModuleKey; available?: ModuleKey[] }) {
  const keys = (Object.keys(MODULES) as ModuleKey[]).filter((key) => key === active || available.includes(key));

  return <nav className="module-navbar" data-active={active} aria-label="Cambiar de módulo">
    <span className="module-navbar-caption">Módulo activo</span>
    <div className="module-navbar-options">
      {keys.map((key) => {
        const item = MODULES[key];
        const isActive = key === active;
        return <a
          key={key}
          href={item.href}
          className={`module-navbar-link${isActive ? ' active' : ''}`}
          aria-current={isActive ? 'page' : undefined}
        >
          <span className="module-navbar-icon" aria-hidden="true">{item.icon}</span>
          <span>{item.label}</span>
        </a>;
      })}
    </div>
  </nav>;
}
