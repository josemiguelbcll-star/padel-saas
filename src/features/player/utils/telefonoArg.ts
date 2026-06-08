/**
 * Utilidades para números de teléfono argentinos.
 *
 * Argentina usa exactamente 10 dígitos significativos:
 *   código de área (sin el 0 inicial) + número abonado
 *
 *   Buenos Aires (área 11, 2 dígitos):  011-XXXX-XXXX → 10 dígitos
 *   Interior     (área 3 dígitos):      0387-XXX-XXXX → 10 dígitos
 *   Zonas chicas (área 4 dígitos):      02901-XX-XXXX → 10 dígitos
 *
 * Formato normalizado de salida: '+54XXXXXXXXXX' (E.164-like Argentina).
 * Equivalente al fn_normalizar_telefono() de Supabase (0078).
 */

/**
 * Normaliza un teléfono argentino a '+54XXXXXXXXXX'.
 * Devuelve null si el formato no corresponde a un número AR válido.
 */
export function normalizarTelefono(tel: string): string | null {
  const digits = tel.replace(/\D/g, '');

  // Internacional: empieza con 54
  if (digits.startsWith('54')) {
    let rest = digits.slice(2);
    // Prefijo móvil 9: +54 9 XXXXXXXXXX → quitar el 9 (11 → 10 dígitos)
    if (rest.startsWith('9') && rest.length === 11) {
      rest = rest.slice(1);
    }
    return rest.length === 10 ? '+54' + rest : null;
  }

  // Local con código de área: empieza con 0 (ej: 03874211234 = 11 dígitos)
  if (digits.startsWith('0')) {
    const rest = digits.slice(1);
    return rest.length === 10 ? '+54' + rest : null;
  }

  // 10 dígitos directos: código de área sin 0 + número abonado
  if (digits.length === 10) return '+54' + digits;

  return null;
}

/** true si el string puede normalizarse a un número argentino válido. */
export function esTelefonoValido(tel: string): boolean {
  if (!tel.trim()) return false;
  return normalizarTelefono(tel) !== null;
}

/**
 * Mensaje de error para mostrar debajo del campo, o null si es válido.
 * No muestra error cuando el campo está vacío (eso se valida por separado
 * como "campo obligatorio").
 */
export function errorTelefono(tel: string): string | null {
  if (!tel.trim()) return null;
  if (normalizarTelefono(tel) !== null) return null;
  return 'Ingresá el número completo con código de área. Ej: 3874211234 (Salta) · 01141234567 (Buenos Aires)';
}

/**
 * Formatea el número normalizado para mostrar en la UI.
 *   +5411XXXXXXXX → 011 XXXX-XXXX   (Buenos Aires, área 2 dígitos)
 *   +54387XXXXXXX → 0387 XXX-XXXX   (Interior, área 3 dígitos)
 *   +542901XXXXXX → 02901 XX-XXXX   (área 4 dígitos)
 */
export function formatearTelefono(normalizado: string): string {
  if (!normalizado.startsWith('+54')) return normalizado;
  const rest = normalizado.slice(3); // 10 dígitos sin el +54
  // Área 2 dígitos (Buenos Aires: 11)
  if (rest.startsWith('11') || (rest.length >= 2 && Number(rest.slice(0, 2)) < 20)) {
    return `011 ${rest.slice(2, 6)}-${rest.slice(6)}`;
  }
  // Área 4 dígitos
  if (rest.slice(0, 4).match(/^(2[89]\d\d|3[89]\d\d)/)) {
    return `0${rest.slice(0, 4)} ${rest.slice(4, 6)}-${rest.slice(6)}`;
  }
  // Área 3 dígitos (caso más común del interior)
  return `0${rest.slice(0, 3)} ${rest.slice(3, 6)}-${rest.slice(6)}`;
}
