import { QueryClient } from '@tanstack/react-query';

/**
 * Constantes de Políticas de Memoria (Multi-Tier In-Memory Caching)
 */
export const CACHE_TIEMPO_ESTATICO = 10 * 60 * 1000;  // 10 min: canchas, tarifas, categorías, unidades
export const CACHE_TIEMPO_OPERATIVO = 30 * 1000;       // 30 seg: reservas del día, caja abierta
export const CACHE_TIEMPO_REPORTES = 5 * 60 * 1000;    // 5 min: EERR, balances, flujo de caja
export const CACHE_GC_EXTENDIDO = 30 * 60 * 1000;      // 30 min: retención en memoria RAM

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      gcTime: CACHE_GC_EXTENDIDO,
      retry: 1,
      refetchOnWindowFocus: false,
      refetchOnMount: false,
      refetchOnReconnect: 'always',
    },
  },
});
