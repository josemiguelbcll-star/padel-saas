import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { mapPostgrestError } from '@/lib/dbErrors';
import { useSession } from '@/features/auth';
import { PRODUCTOS_CON_STOCK_QUERY_KEY } from '@/features/configuracion/hooks/useProductosConStock';
import type { MedioPago, Venta } from '@/types/database';

export interface BuffetMesaConsumo {
  id: number;
  club_id: number;
  mesa_id: number;
  producto_id: number;
  cantidad: number;
  creada_at: string;
  producto: {
    id: number;
    nombre: string;
    precio: number;
    costo: number;
  };
}

export interface BuffetMesa {
  id: number;
  club_id: number;
  nombre: string;
  abierta: boolean;
  creada_at: string;
  cerrada_at: string | null;
  venta_id: number | null;
  consumos: BuffetMesaConsumo[];
}

export function useMesas() {
  const { club } = useSession();

  return useQuery<BuffetMesa[], Error>({
    queryKey: ['buffet-mesas', club?.id],
    queryFn: async () => {
      if (!club) return [];

      const { data, error } = await supabase
        .from('buffet_mesas')
        .select(`
          *,
          consumos:buffet_mesa_consumos(
            *,
            producto:productos(*)
          )
        `)
        .eq('club_id', club.id)
        .eq('abierta', true)
        .order('creada_at', { ascending: false });

      if (error) throw new Error(mapPostgrestError(error));
      return (data ?? []) as BuffetMesa[];
    },
    enabled: !!club,
  });
}

export function useCrearMesa() {
  const { club } = useSession();
  const queryClient = useQueryClient();

  return useMutation<BuffetMesa, Error, string>({
    mutationFn: async (nombre: string) => {
      if (!club) throw new Error('No hay sesión activa.');

      const { data, error } = await supabase
        .from('buffet_mesas')
        .insert({
          club_id: club.id,
          nombre: nombre.trim(),
          abierta: true,
        })
        .select()
        .single();

      if (error) throw new Error(mapPostgrestError(error));
      return data as BuffetMesa;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['buffet-mesas'] });
    },
  });
}

export interface CargarConsumoInput {
  mesaId: number;
  productoId: number;
  cantidad: number;
}

export function useCargarConsumoMesa() {
  const queryClient = useQueryClient();

  return useMutation<BuffetMesaConsumo, Error, CargarConsumoInput>({
    mutationFn: async ({ mesaId, productoId, cantidad }) => {
      // RPC atómica: upsert del consumo + descuento de stock inmediato
      // (fuente 'mesa_consumo'). Antes era INSERT/UPDATE directo y el
      // stock recién se movía al cerrar la venta.
      const { data, error } = await supabase.rpc('fn_cargar_consumo_mesa', {
        p_mesa_id: mesaId,
        p_producto_id: productoId,
        p_cantidad: cantidad,
      });

      if (error) throw new Error(mapPostgrestError(error));
      if (!data) throw new Error('No recibimos confirmación del consumo.');
      return data as BuffetMesaConsumo;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['buffet-mesas'] });
      // El stock baja en el momento del cargo → refrescar catálogo y
      // movimientos para que el descuento se vea sin cerrar la venta.
      void queryClient.invalidateQueries({ queryKey: PRODUCTOS_CON_STOCK_QUERY_KEY });
      void queryClient.invalidateQueries({ queryKey: ['inventario'] });
    },
  });
}

export interface QuitarConsumoInput {
  mesaId: number;
  productoId: number;
  cantidad: number; // Cantidad a restar
}

export function useQuitarConsumoMesa() {
  const queryClient = useQueryClient();

  return useMutation<void, Error, QuitarConsumoInput>({
    mutationFn: async ({ mesaId, productoId, cantidad }) => {
      // RPC atómica: reduce/elimina el consumo y repone el stock
      // (fuente 'reposicion_mesa_consumo').
      const { error } = await supabase.rpc('fn_quitar_consumo_mesa', {
        p_mesa_id: mesaId,
        p_producto_id: productoId,
        p_cantidad: cantidad,
      });

      if (error) throw new Error(mapPostgrestError(error));
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['buffet-mesas'] });
      void queryClient.invalidateQueries({ queryKey: PRODUCTOS_CON_STOCK_QUERY_KEY });
      void queryClient.invalidateQueries({ queryKey: ['inventario'] });
    },
  });
}

export function useCerrarMesaVacia() {
  const queryClient = useQueryClient();

  return useMutation<void, Error, number>({
    mutationFn: async (mesaId: number) => {
      const { error } = await supabase
        .from('buffet_mesas')
        .update({
          abierta: false,
          cerrada_at: new Date().toISOString(),
          venta_id: null,
        })
        .eq('id', mesaId);

      if (error) throw new Error(mapPostgrestError(error));
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['buffet-mesas'] });
    },
  });
}

export interface CerrarMesaInput {
  mesaId: number;
  medioPago: MedioPago;
  observaciones: string;
  jugadorId: number | null;
}

export function useCerrarMesa() {
  const queryClient = useQueryClient();

  return useMutation<Venta, Error, CerrarMesaInput>({
    mutationFn: async ({ mesaId, medioPago, observaciones, jugadorId }) => {
      const { data, error } = await supabase.rpc('fn_cerrar_mesa_buffet', {
        p_mesa_id: mesaId,
        p_medio_pago: medioPago,
        p_observaciones: observaciones.trim() === '' ? null : observaciones.trim(),
        p_jugador_id: jugadorId,
      });

      if (error) throw new Error(mapPostgrestError(error));
      if (!data) throw new Error('No recibimos confirmación de la venta registrada.');

      return data as Venta;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['buffet-mesas'] });
    },
  });
}
