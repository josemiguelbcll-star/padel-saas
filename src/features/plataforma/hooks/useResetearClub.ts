import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export interface ResetearClubInput {
  clubId: number;
  reservas?: boolean;
  buffet?: boolean;
  clases?: boolean;
  jugadores?: boolean;
  finanzas?: boolean;
  productos?: boolean;
  canchas?: boolean;
  // Compatibilidad hacia atrás
  limpiarCatalogo?: boolean;
}

export function useResetearClub() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: ResetearClubInput) => {
      const {
        clubId,
        reservas = false,
        buffet = false,
        clases = false,
        jugadores = false,
        finanzas = false,
        productos = false,
        canchas = false,
        limpiarCatalogo = false,
      } = input;

      const resetProductos = productos || limpiarCatalogo;
      const resetCanchas = canchas || limpiarCatalogo;

      // 1. Intentar via RPC modular fn_resetear_datos_club_modular
      try {
        const { data, error } = await supabase.rpc('fn_resetear_datos_club_modular', {
          p_club_id: clubId,
          p_reset_reservas: reservas,
          p_reset_buffet: buffet,
          p_reset_clases: clases,
          p_reset_jugadores: jugadores,
          p_reset_finanzas: finanzas,
          p_reset_productos: resetProductos,
          p_reset_canchas: resetCanchas,
        });

        if (!error && data) return data;
        if (error) console.warn('[useResetearClub] RPC modular falló:', error.message);
      } catch (e) {
        console.warn('[useResetearClub] Fallback a borrado secuencial:', e);
      }

      // 2. Fallback secuencial según los módulos seleccionados
      if (reservas) {
        const tablas = ['reserva_consumos', 'reserva_pagos', 'reserva_jugadores', 'reservas', 'turnos_fijos_bloqueos', 'turnos_fijos'];
        for (const t of tablas) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (supabase.from as any)(t).delete().eq('club_id', clubId);
        }
      }

      if (buffet) {
        const tablas = ['venta_items', 'ventas', 'compra_items', 'compras', 'movimientos_stock', 'reserva_consumos', 'clase_consumos'];
        for (const t of tablas) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (supabase.from as any)(t).delete().eq('club_id', clubId);
        }
        if (resetProductos) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (supabase.from as any)('productos').delete().eq('club_id', clubId);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (supabase.from as any)('proveedores').delete().eq('club_id', clubId);
        }
      }

      if (clases) {
        const tablas = ['clase_cobros', 'clase_consumos', 'clase_ocurrencia_alumnos', 'clase_alumnos_fijos', 'clase_ocurrencias', 'clases'];
        for (const t of tablas) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (supabase.from as any)(t).delete().eq('club_id', clubId);
        }
      }

      if (finanzas) {
        const tablas = ['gasto_cuotas', 'gastos', 'gastos_recurrentes', 'otros_ingresos', 'transferencias', 'movimientos_caja', 'movimientos_cuenta', 'turnos_caja', 'cajas'];
        for (const t of tablas) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (supabase.from as any)(t).delete().eq('club_id', clubId);
        }
      }

      if (jugadores) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (supabase.from as any)('jugadores').delete().eq('club_id', clubId);
      }

      if (resetCanchas) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (supabase.from as any)('franjas_turno').delete().eq('club_id', clubId);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (supabase.from as any)('tarifas').delete().eq('club_id', clubId);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (supabase.from as any)('canchas').delete().eq('club_id', clubId);
      }

      return { ok: true, fallback: true };
    },
    onSuccess: () => {
      void queryClient.invalidateQueries();
    },
  });
}
