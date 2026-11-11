import type { PermisoModulo, PermisosEstructura, Usuario } from '@/types/database';

export const SECCIONES_PERMISOS = [
  { key: 'reservas', label: 'Reservas y Jugadores', descripcion: 'Grilla de turnos, turnos fijos y ficha de jugadores.' },
  { key: 'noticias', label: 'Noticias', descripcion: 'Envío de notificaciones y publicación en la app del jugador.' },
  { key: 'caja', label: 'Caja', descripcion: 'Aperturas, cierres de caja, arqueo y ver movimientos de efectivo y transferencias.' },
  { key: 'caja_arqueos', label: 'Arqueos de caja', descripcion: 'Consultar el historial de arqueos propios.' },
  { key: 'mostrador', label: 'Mostrador / Buffet', descripcion: 'Registrar ventas de mostrador y buffet.' },
  { key: 'finanzas', label: 'Finanzas', descripcion: 'Visualizar flujo de caja, cargar gastos y otros ingresos.' },
  { key: 'inventario', label: 'Inventario', descripcion: 'Gestión de stock, proveedores y órdenes de compra.' },
  { key: 'configuracion', label: 'Configuración', descripcion: 'Editar canchas, tarifas, horarios, profesores y marca.' },
] as const;

/**
 * Fallback cuando una sección no está listada en DEFAULT_PERMISOS.
 * Por defecto NO se concede nada (least-privilege).
 */
export const PERMISO_MODULO_DEFAULT: PermisoModulo = { ver: false, editar: false };

/**
 * Defaults de permisos para un VENDEDOR cuando el admin no configuró esa
 * sección. Es la ÚNICA fuente de verdad:
 *   - `getPermiso` la usa para decidir el acceso real.
 *   - El diálogo de permisos la usa para mostrar el estado inicial.
 *
 * Al agregar una sección nueva a `SECCIONES_PERMISOS`, agregala acá también
 * para que el default mostrado y el aplicado sean siempre el mismo.
 */
export const DEFAULT_PERMISOS: Record<string, PermisoModulo> = {
  reservas: { ver: true, editar: true },
  noticias: { ver: true, editar: true },
  caja: { ver: true, editar: true },
  caja_arqueos: { ver: false, editar: false },
  mostrador: { ver: true, editar: true },
  finanzas: { ver: true, editar: true },
  inventario: { ver: false, editar: false },
  configuracion: { ver: true, editar: false },
};

/**
 * Resuelve el permiso efectivo de un usuario para un módulo.
 *
 * Regla: si el admin configuró explícitamente la sección, se respeta esa
 * configuración; si no la configuró, se usa `DEFAULT_PERMISOS`. Los admin
 * siempre tienen acceso total.
 */
export function getPermiso(
  user: Usuario | null,
  moduloKey: string,
  accion: 'ver' | 'editar'
): boolean {
  if (!user) return false;
  if (user.rol === 'admin') return true;

  const permisos = user.permisos as PermisosEstructura | undefined;
  const config = permisos?.modulos?.[moduloKey];

  if (config && typeof config[accion] === 'boolean') {
    return config[accion];
  }

  return DEFAULT_PERMISOS[moduloKey]?.[accion] ?? false;
}
