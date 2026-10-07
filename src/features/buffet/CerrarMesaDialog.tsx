import { useMemo } from 'react';
import type { BuffetMesa } from './hooks/useMesasBuffet';
import type { Venta } from '@/types/database';
import type { VentaItemEnriquecido } from './VentaActual';
import { useProductosConStock } from '@/features/configuracion/hooks/useProductosConStock';
import { CerrarVentaDialog } from './CerrarVentaDialog';

interface CerrarMesaDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mesa: BuffetMesa | null;
  onSuccess: (venta: Venta) => void;
}

/**
 * Adaptador para cierre de mesas que delega en CerrarVentaDialog,
 * permitiendo pago único o dividido con asignación de personas (jugadores e invitados).
 */
export function CerrarMesaDialog({
  open,
  onOpenChange,
  mesa,
  onSuccess,
}: CerrarMesaDialogProps) {
  const productosQuery = useProductosConStock();
  const productos = productosQuery.data ?? [];

  const items: VentaItemEnriquecido[] = useMemo(() => {
    if (!mesa) return [];
    return mesa.consumos.map((c) => {
      const prodConStock = productos.find((p) => p.id === c.producto.id);
      return {
        producto: prodConStock || {
          id: c.producto.id,
          nombre: c.producto.nombre,
          precio: c.producto.precio,
          costo: c.producto.costo,
          stock_actual: 0,
          club_id: mesa.club_id,
          linea: 'buffet',
          categoria: 'bebidas',
          stock_minimo: 0,
          activo: true,
          fecha_alta: new Date().toISOString(),
        },
        cantidad: c.cantidad,
        subtotal: c.producto.precio * c.cantidad,
      };
    });
  }, [mesa, productos]);

  const total = useMemo(
    () => items.reduce((sum, i) => sum + i.subtotal, 0),
    [items],
  );

  if (!mesa) return null;

  return (
    <CerrarVentaDialog
      open={open}
      onOpenChange={onOpenChange}
      items={items}
      total={total}
      mesa={mesa}
      onSuccess={onSuccess}
    />
  );
}
