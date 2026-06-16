/**
 * useMyReservas — carga las reservas del jugador autenticado via teléfono.
 *
 * Llama a fn_mis_reservas_app() (migración 0078), que hace el matching
 * cross-club por teléfono normalizado (+54XXXXXXXXXX).
 *
 * Devuelve:
 *   proximas  — reservas futuras (fecha >= hoy, no canceladas), orden ascendente
 *   historial — últimas 10 reservas pasadas o canceladas, orden descendente
 *   sinTelefono — true cuando la RPC devolvió vacío porque no hay teléfono
 */

import { useState, useCallback, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { withTimeout } from '@/lib/network';

export interface MiReservaReal {
  id:            number;
  club_id:       number;
  club_nombre:   string;
  cancha_nombre: string;
  fecha:         string;   // 'YYYY-MM-DD'
  hora_inicio:   string;   // 'HH:MM:SS'
  hora_fin:      string;   // 'HH:MM:SS'
  duracion_min:  number;
  estado:        string;   // 'pendiente' | 'senada' | 'pagada' | 'jugada' | 'cancelada'
  monto_total:   number;
  monto_pagado:  number;
  es_futura:     boolean;
}

// ── Helpers de formato ────────────────────────────────────────────────────────

const DIAS   = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const MESES  = ['ene', 'feb', 'mar', 'abr', 'may', 'jun',
                'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/** 'YYYY-MM-DD' → 'Sáb 13 jun' (sin problemas de zona horaria) */
export function formatFechaReserva(isoDate: string): string {
  const parts = isoDate.split('-').map(Number);
  const y = parts[0] ?? 2000;
  const m = parts[1] ?? 1;
  const d = parts[2] ?? 1;
  const date = new Date(y, m - 1, d); // constructor local, sin UTC
  return `${DIAS[date.getDay()]} ${d} ${MESES[m - 1]}`;
}

/** 'HH:MM:SS' o 'HH:MM' → 'HH:MM' */
export function formatHoraReserva(timeStr: string): string {
  return timeStr.slice(0, 5);
}

/** Label legible del estado de la reserva */
export function labelEstado(estado: string): string {
  switch (estado) {
    case 'pendiente':  return 'Pendiente de seña';
    case 'senada':     return 'Señada';
    case 'pagada':     return 'Pagada';
    case 'jugada':     return 'Jugada';
    case 'cancelada':  return 'Cancelada';
    default:           return estado;
  }
}

/** Color del badge de estado */
export function colorEstado(estado: string): { text: string; bg: string; border: string } {
  switch (estado) {
    case 'pagada':
    case 'jugada':
      return { text: '#16A34A', bg: '#F0FDF4', border: '#BBF7D0' };
    case 'senada':
      return { text: '#D97706', bg: '#FFFBEB', border: '#FDE68A' };
    case 'cancelada':
      return { text: '#DC2626', bg: '#FEF2F2', border: '#FECACA' };
    default: // pendiente
      return { text: '#64748B', bg: '#F8FAFC', border: '#E2E8F0' };
  }
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useMyReservas() {
  const [reservas,     setReservas]     = useState<MiReservaReal[]>([]);
  const [isLoading,    setIsLoading]    = useState(true);
  const [error,        setError]        = useState<string | null>(null);
  const [sinTelefono,  setSinTelefono]  = useState(false);
  const [userId,       setUserId]       = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    setSinTelefono(false);
    try {
      // Llamada RPC con timeout para evitar bloqueos aleatorios
      const rpcPromise = supabase.rpc('fn_mis_reservas_app') as any;
      const { data, error: rpcError } = await (withTimeout(rpcPromise, 8000, 'fn_mis_reservas_app') as any);
      if (rpcError) throw rpcError;
      const rows = (data as MiReservaReal[]) ?? [];
      setReservas(rows);
    } catch (err) {
      console.error('[useMyReservas] error:', err);
      setError('No se pudieron cargar tus reservas');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    // Escuchar cambios en el estado de autenticación (el primer disparo entrega el estado inicial)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUserId(session?.user?.id ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (userId) {
      load();
    } else {
      setReservas([]);
      setIsLoading(false);
    }
  }, [userId, load]);

  const proximas  = reservas.filter(r =>  r.es_futura);
  const historial = reservas.filter(r => !r.es_futura);

  return { proximas, historial, isLoading, error, sinTelefono, reload: load };
}
