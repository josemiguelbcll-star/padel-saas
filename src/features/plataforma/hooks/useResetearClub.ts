import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export interface ResetearClubInput {
  clubId: number;
  limpiarCatalogo?: boolean;
}

export function useResetearClub() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ clubId, limpiarCatalogo = false }: ResetearClubInput) => {
      // 1. Intentar via RPC fn_resetear_datos_club si está en la BD
      try {
        const { data, error } = await supabase.rpc('fn_resetear_datos_club', {
          p_club_id: clubId,
          p_limpiar_catalogo: limpiarCatalogo,
        });

        if (!error && data) return data;
      } catch {
        // Fallback a borrado secuencial si RPC no disponible
      }

      // 2. Fallback: borrado en orden de dependencias para no violar FK constraints
      const tablasTransaccionales = [
        'reserva_consumos',
        'reserva_cobros',
        'reservas_jugadores',
        'reservas',
        'venta_items',
        'ventas',
        'movimientos_stock',
        'compra_items',
        'compras',
        'cuotas_gasto',
        'gastos',
        'gastos_recurrentes',
        'otros_ingresos',
        'clase_alumnos',
        'clase_cobros',
        'clases',
        'movimientos_caja',
        'cajas',
        'transferencias',
        'movimientos_cuenta',
        'turnos_fijos_bloqueos',
        'turnos_fijos',
      ];

      for (const tabla of tablasTransaccionales) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error: delErr } = await (supabase.from as any)(tabla)
          .delete()
          .eq('club_id', clubId);
        if (delErr && !delErr.message.includes('does not exist')) {
          console.warn(`[ResetClub] ${tabla}:`, delErr.message);
        }
      }

      if (limpiarCatalogo) {
        const tablasCatalogo = ['productos', 'proveedores', 'tarifas', 'canchas'];
        for (const tabla of tablasCatalogo) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (supabase.from as any)(tabla).delete().eq('club_id', clubId);
        }
      }

      return { ok: true, fallback: true };
    },
    onSuccess: () => {
      void queryClient.invalidateQueries();
    },
  });
}
