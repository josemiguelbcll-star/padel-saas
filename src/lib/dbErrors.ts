import type { PostgrestError } from '@supabase/supabase-js';

/**
 * Traduce errores de Supabase/PostgREST a mensajes en castellano aptos
 * para mostrar al usuario final. El mensaje crudo nunca se expone.
 *
 * Cubrimos los códigos SQLSTATE más frecuentes (RLS, CHECK, UNIQUE, FK,
 * NOT NULL) y combinamos la detección con regex sobre `message` para
 * identificar el CONSTRAINT específico cuando aporta valor (ej. el
 * horario incoherente del club). Pensado para evolucionar: si aparece
 * un nuevo CHECK que merezca mensaje propio, se agrega un caso.
 *
 * Referencias SQLSTATE:
 *   23502 not_null_violation
 *   23503 foreign_key_violation
 *   23505 unique_violation
 *   23514 check_violation
 *   42501 insufficient_privilege  (incluye rechazos por RLS)
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

  // Violación de CHECK constraint
  if (code === '23514') {
    if (/clubes_horario_coherente/i.test(message)) {
      return 'El horario de cierre tiene que ser posterior al de apertura.';
    }
    if (/clubes_duracion_turno_default_valida/i.test(message)) {
      return 'La duración por defecto del turno debe ser 60, 90, 120, 150, 180 o 240 minutos.';
    }
    if (/tarifas_franja_coherente/i.test(message)) {
      return 'Si configurás una franja horaria, ambas horas deben estar completas y "hasta" debe ser posterior a "desde".';
    }
    if (/tarifas_dias_semana_validos/i.test(message)) {
      return 'Los días de la semana deben estar entre lunes (1) y domingo (7).';
    }
    if (/monto/i.test(message)) {
      return 'El monto debe ser mayor o igual a 0.';
    }
    return 'Los datos no cumplen las reglas de validación. Revisá los campos e intentá de nuevo.';
  }

  // Violación de UNIQUE
  if (code === '23505') {
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
