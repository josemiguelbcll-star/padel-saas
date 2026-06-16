import type { Usuario } from '@/types/database';

export interface PermisoModulo {
  ver: boolean;
  editar: boolean;
}

export interface PermisosEstructura {
  modulos?: {
    [moduloKey: string]: PermisoModulo;
  };
}

export const SECCIONES_PERMISOS = [
  { key: 'reservas', label: 'Reservas y Jugadores', descripcion: 'Grilla de turnos, turnos fijos y ficha de jugadores.' },
  { key: 'noticias', label: 'Noticias', descripcion: 'Envío de notificaciones y publicación en la app del jugador.' },
  { key: 'caja', label: 'Caja', descripcion: 'Aperturas, cierres de caja, arqueo y ver movimientos de efectivo y transferencias.' },
  { key: 'mostrador', label: 'Mostrador / Buffet', descripcion: 'Registrar ventas de mostrador y buffet.' },
  { key: 'finanzas', label: 'Finanzas', descripcion: 'Visualizar flujo de caja, cargar gastos y otros ingresos.' },
  { key: 'inventario', label: 'Inventario', descripcion: 'Gestión de stock, proveedores y órdenes de compra.' },
  { key: 'configuracion', label: 'Configuración', descripcion: 'Editar canchas, tarifas, horarios, profesores y marca.' },
] as const;

export function getPermiso(
  user: Usuario | null,
  moduloKey: string,
  accion: 'ver' | 'editar'
): boolean {
  if (!user) return false;
  if (user.rol === 'admin') return true;

  const permisos = user.permisos as PermisosEstructura | undefined;
  const config = permisos?.modulos?.[moduloKey];

  // Defaults para Vendedores
  const defaults: Record<string, PermisoModulo> = {
    reservas: { ver: true, editar: true },
    noticias: { ver: true, editar: true },
    caja: { ver: true, editar: true },
    mostrador: { ver: true, editar: true },
    finanzas: { ver: true, editar: true },
    inventario: { ver: false, editar: false },
    configuracion: { ver: true, editar: false },
  };

  if (!config) {
    return defaults[moduloKey]?.[accion] ?? false;
  }

  // Devolver el permiso configurado explícitamente (o si falta ver/editar, false)
  return config[accion] ?? false;
}
