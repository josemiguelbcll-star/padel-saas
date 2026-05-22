import type { PostgrestError } from '@supabase/supabase-js';

/**
 * Traduce errores de Supabase/PostgREST a mensajes en castellano aptos
 * para mostrar al usuario final. El mensaje crudo nunca se expone.
 *
 * Cubrimos los códigos SQLSTATE más frecuentes (RLS, CHECK, UNIQUE, FK,
 * NOT NULL, EXCLUSION, raise_exception) y combinamos la detección con
 * regex sobre `message` para identificar el CONSTRAINT específico
 * cuando aporta valor (ej. el horario incoherente del club, o la
 * superposición de reservas). Pensado para evolucionar: si aparece
 * un nuevo CHECK que merezca mensaje propio, se agrega un caso.
 *
 * Referencias SQLSTATE:
 *   23502 not_null_violation
 *   23503 foreign_key_violation
 *   23505 unique_violation
 *   23514 check_violation
 *   23P01 exclusion_violation  (usado por EXCLUDE constraints como no_overlap_reservas)
 *   42501 insufficient_privilege  (incluye rechazos por RLS)
 *   P0001 raise_exception      (RAISE EXCEPTION desde nuestras RPCs)
 */
export function mapPostgrestError(error: PostgrestError): string {
  const code = error.code ?? '';
  const message = error.message ?? '';

  // RLS rejection o falta de privilegio
  if (
    code === '42501' ||
    /row-level security|permission denied/i.test(message)
  ) {
    return 'No tenés permisos para realizar esta acción. Si pensás que es un error, contactá al administrador del club.';
  }

  // Violación de EXCLUDE constraint (sobre todo no_overlap_reservas)
  if (code === '23P01' || /exclusion constraint/i.test(message)) {
    if (/no_overlap_reservas/i.test(message)) {
      return 'Ese horario ya está ocupado en esa cancha. Elegí otra hora o cancha.';
    }
    return 'La operación choca con otra existente. Verificá los datos.';
  }

  // Violación de CHECK constraint
  if (code === '23514') {
    if (/clubes_horario_coherente/i.test(message)) {
      return 'El horario de cierre tiene que ser posterior al de apertura.';
    }
    if (/clubes_duracion_turno_default_valida/i.test(message)) {
      return 'La duración por defecto del turno debe ser 60, 90, 120, 150, 180 o 240 minutos.';
    }
    if (/tarifas_franja_coherente|franjas_duracion_franja_coherente/i.test(message)) {
      return 'Si configurás una franja horaria, ambas horas deben estar completas y "hasta" debe ser posterior a "desde".';
    }
    if (/tarifas_dias_semana_validos|franjas_duracion_dias_semana_validos/i.test(message)) {
      return 'Los días de la semana deben estar entre lunes (1) y domingo (7).';
    }
    if (/monto_pagado.*monto_total|monto_pagado <= monto_total/i.test(message)) {
      return 'El monto pagado no puede ser mayor al total de la reserva.';
    }
    if (/hora_fin.*hora_inicio|hora_fin > hora_inicio/i.test(message)) {
      return 'La hora de fin tiene que ser posterior a la de inicio.';
    }
    if (/duracion_min/i.test(message)) {
      return 'La duración del turno debe ser 60, 90, 120, 150, 180 o 240 minutos.';
    }
    if (/monto/i.test(message)) {
      return 'El monto debe ser mayor o igual a 0.';
    }
    return 'Los datos no cumplen las reglas de validación. Revisá los campos e intentá de nuevo.';
  }

  // Violación de UNIQUE
  if (code === '23505') {
    if (/turnos_fijos_no_overlap_activos/i.test(message)) {
      return 'Ya hay otro turno fijo activo en esa cancha en ese día y hora. Desactivá el existente o elegí otro slot.';
    }
    if (/reservas_turno_fijo_fecha_unico/i.test(message)) {
      return 'Esa fecha ya fue materializada para este turno fijo. Refrescá la grilla.';
    }
    return 'Ya existe un registro con esos datos.';
  }

  // Violación de FK
  if (code === '23503') {
    return 'No se puede completar la operación porque hay registros vinculados.';
  }

  // NOT NULL violation
  if (code === '23502') {
    return 'Hay un campo obligatorio sin completar.';
  }

  // RAISE EXCEPTION desde nuestras RPCs. Por convención todas hablan
  // castellano (fn_crear_reserva, etc.), así que pasamos el mensaje
  // directo al usuario.
  if (code === 'P0001') {
    return message;
  }

  // Errores de red / fetch caídos
  if (/network|failed to fetch|fetch failed/i.test(message)) {
    return 'Error de conexión. Verificá tu internet e intentá nuevamente.';
  }

  return 'No pudimos completar la operación. Si el problema persiste, contactá al administrador.';
}

/**
 * Helper para usar dentro de los hooks: si el response de Supabase trae
 * `error`, lo convierte en un Error con mensaje en castellano. Si no,
 * devuelve `data` haciendo cast al tipo esperado.
 *
 * Uso típico:
 *   const { data, error } = await supabase.from('canchas').select('*');
 *   return unwrap<Cancha[]>(data, error);
 */
export function unwrap<T>(data: unknown, error: PostgrestError | null): T {
  if (error) {
    throw new Error(mapPostgrestError(error));
  }
  return (data ?? null) as T;
}
