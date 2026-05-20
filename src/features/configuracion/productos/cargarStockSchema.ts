import { z } from 'zod';

/**
 * Schema del mini-form "Cargar stock". Entrada manual de inventario:
 * cantidad entera positiva + observación opcional. La RPC
 * fn_registrar_movimiento_stock valida lo mismo en el backend.
 */
export const cargarStockSchema = z.object({
  cantidad: z.coerce
    .number({ invalid_type_error: 'Ingresá una cantidad válida.' })
    .int('La cantidad debe ser un número entero.')
    .min(1, 'La cantidad debe ser mayor a 0.'),
  observaciones: z
    .string()
    .transform((v) => v.trim())
    .transform((v) => (v === '' ? null : v)),
});

export interface CargarStockFormState {
  cantidad: string;
  observaciones: string;
}

export type CargarStockFormValues = z.output<typeof cargarStockSchema>;
