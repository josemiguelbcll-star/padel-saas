import type { Tarifa } from '@/types/database';

/**
 * Información agregada de una franja a partir de TODAS sus versiones
 * de precio (mismo lineage_id). La pantalla de Tarifas trabaja con
 * estos "linajes" en vez de con tarifas sueltas.
 */
export interface TarifaLinaje {
  lineage_id: number;
  /** Metadata vigente — la misma en todas las versiones del linaje. */
  nombre: string;
  desde_hora: string | null;
  hasta_hora: string | null;
  dias_semana: number[] | null;
  prioridad: number;
  activa: boolean;
  /** Versiones del linaje ordenadas por vigente_desde DESC (más reciente primero). */
  versiones: Tarifa[];
  /** La versión vigente hoy (cubre CURRENT_DATE). NULL si ninguna aplica hoy. */
  vigenteHoy: Tarifa | null;
  /** La próxima versión futura (vigente_desde > hoy). NULL si no hay aumento programado. */
  proximoAumento: Tarifa | null;
}

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Agrupa las tarifas por `lineage_id` y arma el objeto `TarifaLinaje`
 * con metadata y derivados útiles (vigente hoy, próximo aumento).
 *
 * Los linajes se devuelven ordenados por prioridad DESC y nombre ASC
 * (mismo criterio que la query base).
 */
export function agruparPorLinaje(tarifas: Tarifa[]): TarifaLinaje[] {
  const hoy = todayISO();
  const grupos = new Map<number, Tarifa[]>();

  for (const t of tarifas) {
    const arr = grupos.get(t.lineage_id);
    if (arr) arr.push(t);
    else grupos.set(t.lineage_id, [t]);
  }

  const linajes: TarifaLinaje[] = [];
  for (const [lineage_id, vs] of grupos) {
    // Ordenar versiones por vigente_desde DESC (más reciente primero).
    const versiones = [...vs].sort((a, b) =>
      b.vigente_desde.localeCompare(a.vigente_desde),
    );
    const base = versiones[0]!; // existe garantizado: el linaje tiene al menos 1

    const vigenteHoy =
      versiones.find(
        (v) =>
          v.vigente_desde <= hoy &&
          (v.vigente_hasta === null || v.vigente_hasta >= hoy),
      ) ?? null;

    // Próximo aumento: la versión con vigente_desde futuro más cercano.
    const futuras = versiones.filter((v) => v.vigente_desde > hoy);
    const proximoAumento =
      futuras.length > 0
        ? futuras.reduce((min, v) =>
            v.vigente_desde < min.vigente_desde ? v : min,
          )
        : null;

    linajes.push({
      lineage_id,
      nombre: base.nombre,
      desde_hora: base.desde_hora,
      hasta_hora: base.hasta_hora,
      dias_semana: base.dias_semana,
      prioridad: base.prioridad,
      activa: base.activa,
      versiones,
      vigenteHoy,
      proximoAumento,
    });
  }

  // Orden consistente con la query base.
  linajes.sort((a, b) => {
    if (a.prioridad !== b.prioridad) return b.prioridad - a.prioridad;
    return a.nombre.localeCompare(b.nombre);
  });

  return linajes;
}
