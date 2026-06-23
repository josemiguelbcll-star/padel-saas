import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { mapPostgrestError } from '@/lib/dbErrors';
import { useSession } from '@/features/auth';
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
  const { club } = useSession();
  const queryClient = useQueryClient();

  return useMutation<void, Error, CargarConsumoInput>({
    mutationFn: async ({ mesaId, productoId, cantidad }) => {
      if (!club) throw new Error('No hay sesión activa.');

      // Verificar si ya existe el producto cargado en la mesa
      const { data: existing, error: checkError } = await supabase
        .from('buffet_mesa_consumos')
        .select('*')
        .eq('mesa_id', mesaId)
        .eq('producto_id', productoId)
        .maybeSingle();

      if (checkError) throw new Error(mapPostgrestError(checkError));

      if (existing) {
        // Incrementar cantidad
        const { error: updateError } = await supabase
          .from('buffet_mesa_consumos')
          .update({ cantidad: existing.cantidad + cantidad })
          .eq('id', existing.id);

        if (updateError) throw new Error(mapPostgrestError(updateError));
      } else {
        // Insertar consumo
        const { error: insertError } = await supabase
          .from('buffet_mesa_consumos')
          .insert({
            club_id: club.id,
            mesa_id: mesaId,
            producto_id: productoId,
            cantidad,
          });

        if (insertError) throw new Error(mapPostgrestError(insertError));
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['buffet-mesas'] });
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
      const { data: existing, error: fetchError } = await supabase
        .from('buffet_mesa_consumos')
        .select('*')
        .eq('mesa_id', mesaId)
        .eq('producto_id', productoId)
        .maybeSingle();

      if (fetchError) throw new Error(mapPostgrestError(fetchError));
      if (!existing) return;

      const nuevaCantidad = existing.cantidad - cantidad;

      if (nuevaCantidad <= 0) {
        // Eliminar fila
        const { error: deleteError } = await supabase
          .from('buffet_mesa_consumos')
          .delete()
          .eq('id', existing.id);

        if (deleteError) throw new Error(mapPostgrestError(deleteError));
      } else {
        // Actualizar con menor cantidad
        const { error: updateError } = await supabase
          .from('buffet_mesa_consumos')
          .update({ cantidad: nuevaCantidad })
          .eq('id', existing.id);

        if (updateError) throw new Error(mapPostgrestError(updateError));
      }
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
