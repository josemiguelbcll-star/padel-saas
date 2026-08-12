import * as XLSX from 'xlsx';
import type { CategoriaBuffet } from '@/types/database';

export interface ProductoStockExcel {
  nombre: string;
  categoria: CategoriaBuffet;
  precio: number;
  costo: number | null;
  stock: number;
  hoja: string;
}

export interface StockExcelLeido {
  sedes: string[];
  productosPorSede: Record<string, ProductoStockExcel[]>;
  filasOmitidasPorSede: Record<string, number>;
}

function numero(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return null;
  const normalized = value.trim().replace(/\s/g, '').replace(/\./g, '').replace(',', '.');
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function sedeDeHoja(nombreHoja: string): string | null {
  const match = nombreHoja.trim().match(/\s+(DOMO|SIGNO)$/i);
  return match?.[1] ? match[1].toUpperCase() : null;
}

function columnasDeHoja(nombreHoja: string): {
  nombre: number;
  stock: number;
  costo: number;
  precio: number;
  categoria: CategoriaBuffet;
} {
  const esCocaOSpeed = /^(COCA|SPEED)\b/i.test(nombreHoja.trim());
  return {
    // SheetJS recorta las columnas vacías que están antes del rango usado.
    // En este archivo la primera columna real es la B de Excel, que llega
    // al navegador como índice 0.
    nombre: esCocaOSpeed ? 1 : 0,
    stock: esCocaOSpeed ? 2 : 1,
    costo: esCocaOSpeed ? 3 : 2,
    precio: 4,
    categoria: /^SNACKS\b/i.test(nombreHoja.trim()) ? 'snacks' : 'bebidas',
  };
}

function normalizarNombre(value: unknown): string {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
}

export function leerStockExcel(buffer: ArrayBuffer): StockExcelLeido {
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: false });
  const productosPorSede: Record<string, ProductoStockExcel[]> = {};
  const filasOmitidasPorSede: Record<string, number> = {};

  for (const nombreHoja of workbook.SheetNames) {
    const sede = sedeDeHoja(nombreHoja);
    if (!sede) continue;

    const sheet = workbook.Sheets[nombreHoja];
    if (!sheet) continue;
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      raw: true,
      defval: null,
    });
    const cols = columnasDeHoja(nombreHoja);
    productosPorSede[sede] ??= [];
    filasOmitidasPorSede[sede] ??= 0;

    for (const row of rows) {
      const nombre = normalizarNombre(row[cols.nombre]);
      const stock = numero(row[cols.stock]);
      const precio = numero(row[cols.precio]);
      const costo = numero(row[cols.costo]);

      if (!nombre) continue;
      if (stock === null || stock < 0 || !Number.isInteger(stock) || precio === null || precio <= 0) {
        if (!/^(articulo|fecha|cant|costo|p\.?\s*vta|lays|semix)$/i.test(nombre)) {
          filasOmitidasPorSede[sede] += 1;
        }
        continue;
      }

      productosPorSede[sede].push({
        nombre,
        categoria: cols.categoria,
        precio,
        costo: costo !== null && costo >= 0 ? costo : null,
        stock,
        hoja: nombreHoja,
      });
    }
  }

  for (const sede of Object.keys(productosPorSede)) {
    const unicos = new Map<string, ProductoStockExcel>();
    for (const producto of productosPorSede[sede] ?? []) {
      unicos.set(producto.nombre.toLocaleLowerCase('es-AR'), producto);
    }
    productosPorSede[sede] = [...unicos.values()].sort((a, b) =>
      a.nombre.localeCompare(b.nombre, 'es-AR'),
    );
  }

  const sedes = Object.keys(productosPorSede).filter(
    (sede) => (productosPorSede[sede]?.length ?? 0) > 0,
  );
  if (sedes.length === 0) {
    throw new Error('No encontramos hojas de stock compatibles. Esperábamos hojas terminadas en DOMO o SIGNO.');
  }

  return { sedes, productosPorSede, filasOmitidasPorSede };
}
