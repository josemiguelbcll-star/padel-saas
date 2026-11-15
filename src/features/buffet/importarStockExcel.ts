import * as XLSX from 'xlsx';
import type { CategoriaProducto } from '@/types/database';

export interface ProductoStockExcel {
  nombre: string;
  categoria: CategoriaProducto;
  precio: number;
  costo: number | null;
  stock: number;
  hoja: string;
  talla?: string | null;
  color?: string | null;
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
  const match = nombreHoja.trim().match(/(?:\s+|^)(DOMO|SIGNO)$/i);
  return match?.[1] ? match[1].toUpperCase() : null;
}

function normalizarNombre(value: unknown): string {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
}

export function normalizarCategoria(value: unknown, fallback: CategoriaProducto = 'otros'): CategoriaProducto {
  if (typeof value !== 'string') return fallback;
  const lower = value.trim().toLowerCase();
  if (lower.includes('snack')) return 'snacks';
  if (lower.includes('comida') || lower.includes('alimento') || lower.includes('sandwich') || lower.includes('empanada')) return 'comidas';
  if (lower.includes('bebida') || lower.includes('trago') || lower.includes('agua') || lower.includes('gaseosa') || lower.includes('cerveza')) return 'bebidas';
  if (lower.includes('vestimenta') || lower.includes('ropa') || lower.includes('remera') || lower.includes('pantalon') || lower.includes('short') || lower.includes('indumentaria') || lower.includes('gorra') || lower.includes('buzo')) return 'vestimenta';
  if (lower.includes('pala') || lower.includes('paleta')) return 'palas';
  if (lower.includes('pelota') || lower.includes('articulo') || lower.includes('tubo')) return 'articulos_padel';
  if (lower.includes('accesorio') || lower.includes('grip') || lower.includes('overgrip') || lower.includes('protector') || lower.includes('muñequera')) return 'accesorios';
  if (lower.includes('otro')) return 'otros';
  return fallback;
}

interface ColumnMapping {
  nombre: number;
  stock: number;
  costo: number;
  precio: number;
  categoria?: number;
  talla?: number;
  color?: number;
  categoriaDefault: CategoriaProducto;
}

function detectarColumnas(
  rows: unknown[][],
  nombreHoja: string,
): { cols: ColumnMapping; startRow: number } {
  const esCocaOSpeed = /^(COCA|SPEED)\b/i.test(nombreHoja.trim());
  const categoriaDefault: CategoriaProducto = /^SNACKS\b/i.test(nombreHoja.trim())
    ? 'snacks'
    : /^SHOP|ROPA|VESTIMENTA\b/i.test(nombreHoja.trim())
      ? 'vestimenta'
      : 'bebidas';

  // Buscar fila de encabezado en las primeras 10 filas
  for (let r = 0; r < Math.min(rows.length, 10); r++) {
    const row = rows[r];
    if (!Array.isArray(row)) continue;

    let nombreIdx = -1;
    let stockIdx = -1;
    let costoIdx = -1;
    let precioIdx = -1;
    let catIdx = -1;
    let tallaIdx = -1;
    let colorIdx = -1;

    for (let c = 0; c < row.length; c++) {
      const cellText = String(row[c] ?? '').trim().toLowerCase();
      if (!cellText) continue;

      if (nombreIdx === -1 && /^(producto|nombre|articulo|artículo|item|descripción|descripcion)$/i.test(cellText)) {
        nombreIdx = c;
      } else if (stockIdx === -1 && /^(stock|cantidad|cant|unidades)$/i.test(cellText)) {
        stockIdx = c;
      } else if (costoIdx === -1 && /^(costo|costo_unitario|p\.?\s*costo|precio_costo)$/i.test(cellText)) {
        costoIdx = c;
      } else if (precioIdx === -1 && /^(precio|p\.?\s*vta|pvta|precio_venta|p_vta|precio vta|precio\.venta)$/i.test(cellText)) {
        precioIdx = c;
      } else if (catIdx === -1 && /^(categoria|categoría|linea|línea|tipo)$/i.test(cellText)) {
        catIdx = c;
      } else if (tallaIdx === -1 && /^(talla|talle|medida|tamaño|tamano|size)$/i.test(cellText)) {
        tallaIdx = c;
      } else if (colorIdx === -1 && /^(color|tono)$/i.test(cellText)) {
        colorIdx = c;
      }
    }

    if (nombreIdx !== -1 && (stockIdx !== -1 || precioIdx !== -1)) {
      return {
        cols: {
          nombre: nombreIdx,
          stock: stockIdx !== -1 ? stockIdx : (esCocaOSpeed ? 2 : 1),
          costo: costoIdx !== -1 ? costoIdx : (esCocaOSpeed ? 3 : 2),
          precio: precioIdx !== -1 ? precioIdx : 4,
          categoria: catIdx !== -1 ? catIdx : undefined,
          talla: tallaIdx !== -1 ? tallaIdx : undefined,
          color: colorIdx !== -1 ? colorIdx : undefined,
          categoriaDefault,
        },
        startRow: r + 1,
      };
    }
  }

  // Si no hay encabezados detectables, usar posiciones por defecto
  return {
    cols: {
      nombre: esCocaOSpeed ? 1 : 0,
      stock: esCocaOSpeed ? 2 : 1,
      costo: esCocaOSpeed ? 3 : 2,
      precio: 4,
      categoriaDefault,
    },
    startRow: 0,
  };
}

export function leerStockExcel(buffer: ArrayBuffer): StockExcelLeido {
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: false });
  const productosPorSede: Record<string, ProductoStockExcel[]> = {};
  const filasOmitidasPorSede: Record<string, number> = {};

  // Primero verificar si alguna hoja termina en DOMO o SIGNO
  const tieneSedesReconocidas = workbook.SheetNames.some((h) => sedeDeHoja(h) !== null);

  for (const nombreHoja of workbook.SheetNames) {
    let sede: string | null = null;

    if (tieneSedesReconocidas) {
      sede = sedeDeHoja(nombreHoja);
    } else {
      // Fallback: usar el nombre de la hoja limpia o 'DOMO' como sede por defecto
      const clean = nombreHoja.trim();
      sede = /^(hoja|sheet)\d*$/i.test(clean) ? 'DOMO' : clean.toUpperCase();
    }

    if (!sede) continue;

    const sheet = workbook.Sheets[nombreHoja];
    if (!sheet) continue;
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      raw: true,
      defval: null,
    });

    const { cols, startRow } = detectarColumnas(rows, nombreHoja);
    const list = (productosPorSede[sede] ??= []);
    filasOmitidasPorSede[sede] ??= 0;

    for (let i = startRow; i < rows.length; i++) {
      const row = rows[i];
      if (!Array.isArray(row)) continue;

      const nombre = normalizarNombre(row[cols.nombre]);
      const stock = numero(row[cols.stock]);
      const precio = numero(row[cols.precio]);
      const costo = numero(row[cols.costo]);
      const catValor = cols.categoria !== undefined ? row[cols.categoria] : null;
      const categoria = normalizarCategoria(catValor, cols.categoriaDefault);

      const tallaRaw = cols.talla !== undefined ? row[cols.talla] : null;
      const colorRaw = cols.color !== undefined ? row[cols.color] : null;
      const talla = typeof tallaRaw === 'string' || typeof tallaRaw === 'number'
        ? String(tallaRaw).trim() || null
        : null;
      const color = typeof colorRaw === 'string'
        ? colorRaw.trim() || null
        : null;

      if (!nombre) continue;
      if (stock === null || stock < 0 || !Number.isInteger(stock) || precio === null || precio <= 0) {
        if (!/^(articulo|producto|fecha|cant|costo|p\.?\s*vta|lays|semix|notas|categoria|talla|talle|color)$/i.test(nombre)) {
          filasOmitidasPorSede[sede] = (filasOmitidasPorSede[sede] ?? 0) + 1;
        }
        continue;
      }

      list.push({
        nombre,
        categoria,
        precio,
        costo: costo !== null && costo >= 0 ? costo : null,
        stock,
        talla,
        color,
        hoja: nombreHoja,
      });
    }
  }

  for (const sede of Object.keys(productosPorSede)) {
    const unicos = new Map<string, ProductoStockExcel>();
    for (const producto of productosPorSede[sede] ?? []) {
      const claveUnica = `${producto.nombre.toLocaleLowerCase('es-AR')}_${(producto.talla || '').toLowerCase()}_${(producto.color || '').toLowerCase()}`;
      unicos.set(claveUnica, producto);
    }
    productosPorSede[sede] = [...unicos.values()].sort((a, b) =>
      a.nombre.localeCompare(b.nombre, 'es-AR'),
    );
  }

  const sedes = Object.keys(productosPorSede).filter(
    (sede) => (productosPorSede[sede]?.length ?? 0) > 0,
  );
  if (sedes.length === 0) {
    throw new Error('No encontramos filas válidas con datos de productos, stock y precio en el archivo Excel.');
  }

  return { sedes, productosPorSede, filasOmitidasPorSede };
}
