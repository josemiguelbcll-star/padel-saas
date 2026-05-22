import { NavLink, Outlet } from 'react-router-dom';
import { cn } from '@/lib/utils';

interface ConfigTab {
  label: string;
  to: string;
}

const tabs: ConfigTab[] = [
  // Marca primero: identidad del club, lo más alto-nivel de la
  // configuración y lo primero que un admin nuevo quiere tocar (0016).
  { label: 'Marca', to: '/configuracion/marca' },
  // Usuarios después de Marca: gestión de personas con acceso al
  // sistema (admin/vendedor). Alta jerarquía — afecta quién puede
  // tocar el resto de la config (0018).
  { label: 'Usuarios', to: '/configuracion/usuarios' },
  { label: 'Canchas', to: '/configuracion/canchas' },
  { label: 'Horarios', to: '/configuracion/horarios' },
  { label: 'Tarifas', to: '/configuracion/tarifas' },
  { label: 'Profesores', to: '/configuracion/profesores' },
  { label: 'Clases', to: '/configuracion/clases' },
  { label: 'Productos', to: '/configuracion/productos' },
];

/**
 * Layout de la sección Configuración. Provee header común (título +
 * descripción) y una barra de tabs horizontales. La página activa se
 * renderiza en <Outlet />.
 *
 * El gating por rol (qué puede mutar el vendedor vs. el admin) vive en
 * cada página hija, no acá: la sección entera es legible por cualquier
 * authenticated del club.
 */
export function ConfiguracionLayout() {
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Configuración
        </h1>
        <p className="text-sm text-muted-foreground">
          Configurá las canchas, horarios, tarifas, profesores, clases y
          productos del buffet del club.
        </p>
      </div>

      <nav className="border-b border-border" aria-label="Secciones de configuración">
        <ul className="flex flex-wrap gap-1">
          {tabs.map((tab) => (
            <li key={tab.to}>
              <NavLink
                to={tab.to}
                end
                className={({ isActive }) =>
                  cn(
                    '-mb-px inline-flex items-center border-b-2 px-3 py-2 text-sm transition-colors',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                    isActive
                      ? 'border-primary font-medium text-foreground'
                      : 'border-transparent text-muted-foreground hover:border-border hover:text-foreground',
                  )
                }
              >
                {tab.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      <Outlet />
    </div>
  );
}
