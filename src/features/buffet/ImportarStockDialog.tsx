import { useEffect, useRef, useState } from 'react';
import { Download, FileSpreadsheet, Loader2, Upload } from 'lucide-react';
import * as XLSX from 'xlsx';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { CATEGORIA_LABEL } from '@/features/configuracion/productos/productoSchema';
import type { CategoriaProducto } from '@/types/database';
import { leerStockExcel, type ProductoStockExcel, type StockExcelLeido } from './importarStockExcel';
import { useImportarStockExcel, type ResultadoImportacionStock } from './hooks/useImportarStockExcel';

interface ImportarStockDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: (result: ResultadoImportacionStock, sede: string) => void;
}

const OPCIONES_CATEGORIA: Array<{ value: CategoriaProducto; label: string }> = [
  { value: 'bebidas', label: 'Bebidas (Buffet)' },
  { value: 'snacks', label: 'Snacks (Buffet)' },
  { value: 'comidas', label: 'Comidas (Buffet)' },
  { value: 'otros', label: 'Otros (Buffet)' },
  { value: 'vestimenta', label: 'Vestimenta / Ropa (Shop)' },
  { value: 'palas', label: 'Palas / Paletas (Shop)' },
  { value: 'articulos_padel', label: 'Pelotas / Artículos (Shop)' },
  { value: 'accesorios', label: 'Accesorios (Shop)' },
];

export function ImportarStockDialog({ open, onOpenChange, onSuccess }: ImportarStockDialogProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [archivo, setArchivo] = useState<string>('');
  const [lectura, setLectura] = useState<StockExcelLeido | null>(null);
  const [sede, setSede] = useState('');
  const [productosEditables, setProductosEditables] = useState<ProductoStockExcel[]>([]);
  const [errorLectura, setErrorLectura] = useState<string | null>(null);
  const importar = useImportarStockExcel();

  useEffect(() => {
    if (open) return;
    setArchivo('');
    setLectura(null);
    setSede('');
    setProductosEditables([]);
    setErrorLectura(null);
    importar.reset();
  }, [open]);

  useEffect(() => {
    if (lectura && sede) {
      setProductosEditables(lectura.productosPorSede[sede] ?? []);
    } else {
      setProductosEditables([]);
    }
  }, [lectura, sede]);

  function handleDescargarPlantilla(e: React.MouseEvent): void {
    e.preventDefault();

    // Headers de la plantilla vacía: Producto, Codigo, Talle, Color,
    // Stock, Costo, Precio, Categoria
    const headers = ['Producto', 'Codigo', 'Talle', 'Color', 'Stock', 'Costo', 'Precio', 'Categoria'];
    const data = [
      headers,
      ['Ejemplo Remera Bullpadel', 'REM-001', 'M', 'Negro', 10, 15000, 25000, 'vestimenta'],
      ['Ejemplo Bebida Isotónica', '', '', '', 24, 800, 1500, 'bebidas'],
    ];

    // Crear worksheet con ancho de columnas configurado
    const worksheet = XLSX.utils.aoa_to_sheet(data);
    worksheet['!cols'] = [
      { wch: 32 }, // Producto
      { wch: 14 }, // Codigo
      { wch: 10 }, // Talle
      { wch: 12 }, // Color
      { wch: 10 }, // Stock
      { wch: 12 }, // Costo
      { wch: 12 }, // Precio
      { wch: 16 }, // Categoria
    ];

    // Crear el libro de trabajo (workbook)
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Productos');

    // Generar buffer en array y descargar como Blob de Excel (.xlsx)
    const excelBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
    const blob = new Blob([excelBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });

    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'plantilla_importacion_stock.xlsx';
    link.click();
    window.URL.revokeObjectURL(url);
  }

  async function handleFile(file: File | undefined): Promise<void> {
    if (!file) return;
    setErrorLectura(null);
    importar.reset();
    try {
      const parsed = leerStockExcel(await file.arrayBuffer());
      setArchivo(file.name);
      setLectura(parsed);
      const primeraSede = parsed.sedes[0] ?? '';
      setSede(primeraSede);
      setProductosEditables(parsed.productosPorSede[primeraSede] ?? []);
    } catch (error) {
      setArchivo(file.name);
      setLectura(null);
      setSede('');
      setProductosEditables([]);
      setErrorLectura(error instanceof Error ? error.message : 'No pudimos leer el archivo.');
    }
  }

  function handleCambiarCategoria(index: number, cat: CategoriaProducto) {
    setProductosEditables((prev) => {
      const copy = [...prev];
      if (copy[index]) {
        copy[index] = { ...copy[index], categoria: cat };
      }
      return copy;
    });
  }

  function handleCambiarTodasCategorias(cat: CategoriaProducto) {
    setProductosEditables((prev) => prev.map((p) => ({ ...p, categoria: cat })));
  }

  async function confirmar(): Promise<void> {
    if (!sede || productosEditables.length === 0) return;
    const result = await importar.mutateAsync(productosEditables);
    onSuccess(result, sede);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Importar stock desde Excel</DialogTitle>
          <DialogDescription>
            Cargá masivamente productos, indumentaria con talla y color, costos, precios y stock.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/30 p-3 text-xs">
          <div className="flex items-center gap-2 text-muted-foreground">
            <FileSpreadsheet className="h-4 w-4 text-primary shrink-0" />
            <span>Plantilla con campos para buffet y ropa (talla, color, categoría):</span>
          </div>
          <button
            type="button"
            onClick={handleDescargarPlantilla}
            className="inline-flex items-center gap-1.5 font-medium text-primary hover:underline bg-transparent border-0 cursor-pointer"
          >
            <Download className="h-3.5 w-3.5" />
            Descargar plantilla Excel
          </button>
        </div>

        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.xls"
          className="sr-only"
          onChange={(event) => void handleFile(event.target.files?.[0])}
        />

        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={importar.isPending}
          className="flex w-full items-center gap-3 rounded-xl border border-dashed border-border p-4 text-left transition-colors hover:bg-muted/40 disabled:opacity-60"
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <FileSpreadsheet className="h-5 w-5" />
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-medium text-foreground">
              {archivo || 'Seleccionar archivo Excel'}
            </span>
            <span className="block text-xs text-muted-foreground">Archivos .xlsx o .xls</span>
          </span>
        </button>

        {errorLectura && <p role="alert" className="text-sm text-destructive">{errorLectura}</p>}

        {lectura && (
          <div className="space-y-4">
            {lectura.sedes.length > 1 && (
              <div className="space-y-2">
                <p className="text-sm font-medium text-foreground">¿Qué sede o sección querés importar?</p>
                <div className="flex flex-wrap gap-2">
                  {lectura.sedes.map((item) => (
                    <Button
                      key={item}
                      type="button"
                      size="sm"
                      variant={sede === item ? 'default' : 'outline'}
                      onClick={() => setSede(item)}
                    >
                      {item} · {lectura.productosPorSede[item]?.length ?? 0} productos
                    </Button>
                  ))}
                </div>
              </div>
            )}

            {/* Asignación masiva rápida de categoría */}
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-muted/20 px-3 py-2 text-xs">
              <span className="text-muted-foreground">Asignar categoría a todos los ítems:</span>
              <div className="flex items-center gap-1.5">
                <select
                  defaultValue=""
                  onChange={(e) => {
                    if (e.target.value) {
                      handleCambiarTodasCategorias(e.target.value as CategoriaProducto);
                      e.target.value = '';
                    }
                  }}
                  className="h-7 rounded border border-border bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  <option value="" disabled>Seleccionar categoría…</option>
                  {OPCIONES_CATEGORIA.map((opc) => (
                    <option key={opc.value} value={opc.value}>{opc.label}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="rounded-xl border border-border overflow-hidden">
              <div className="grid grid-cols-[1.5fr_1.3fr_1fr_auto_auto] gap-2 border-b border-border bg-muted/40 px-3 py-2 text-xs font-semibold text-muted-foreground">
                <span>Producto</span>
                <span>Categoría</span>
                <span>Talla / Color</span>
                <span>Stock</span>
                <span className="text-right">Precio</span>
              </div>
              <div className="max-h-60 overflow-y-auto divide-y divide-border/60">
                {productosEditables.slice(0, 100).map((producto, index) => (
                  <div key={`${producto.nombre}-${producto.talla}-${producto.color}-${index}`} className="grid grid-cols-[1.5fr_1.3fr_1fr_auto_auto] items-center gap-2 px-3 py-1.5 text-xs">
                    <span className="min-w-0 truncate font-medium text-foreground" title={producto.nombre}>
                      {producto.nombre}
                    </span>
                    <div>
                      <select
                        value={producto.categoria}
                        onChange={(e) => handleCambiarCategoria(index, e.target.value as CategoriaProducto)}
                        className="h-7 w-full rounded border border-border bg-background px-1.5 text-[11px] text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                      >
                        {OPCIONES_CATEGORIA.map((opc) => (
                          <option key={opc.value} value={opc.value}>{CATEGORIA_LABEL[opc.value] || opc.label}</option>
                        ))}
                      </select>
                    </div>
                    <span className="truncate text-muted-foreground text-[11px]" title={`${producto.talla || '—'} / ${producto.color || '—'}`}>
                      {producto.talla || producto.color ? `${producto.talla ?? '—'} / ${producto.color ?? '—'}` : '—'}
                    </span>
                    <span className="tabular-nums font-mono text-muted-foreground text-center">{producto.stock}</span>
                    <span className="w-20 text-right tabular-nums text-foreground font-medium">$ {producto.precio.toLocaleString('es-AR')}</span>
                  </div>
                ))}
              </div>
            </div>

            {(lectura.filasOmitidasPorSede[sede] ?? 0) > 0 && (
              <p className="text-xs text-muted-foreground">
                Se omitirán {lectura.filasOmitidasPorSede[sede]} filas sin precio o con datos incompletos.
              </p>
            )}
          </div>
        )}

        {importar.error && <p role="alert" className="text-sm text-destructive">{importar.error.message}</p>}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={importar.isPending}>
            Cancelar
          </Button>
          <Button type="button" onClick={() => void confirmar()} disabled={productosEditables.length === 0 || importar.isPending}>
            {importar.isPending ? <Loader2 className="animate-spin" /> : <Upload />}
            {importar.isPending ? 'Importando…' : `Importar ${productosEditables.length || ''} productos`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
