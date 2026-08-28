import { useEffect, useMemo, useRef, useState } from 'react';
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
import { leerStockExcel, type StockExcelLeido } from './importarStockExcel';
import { useImportarStockExcel, type ResultadoImportacionStock } from './hooks/useImportarStockExcel';

interface ImportarStockDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: (result: ResultadoImportacionStock, sede: string) => void;
}

export function ImportarStockDialog({ open, onOpenChange, onSuccess }: ImportarStockDialogProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [archivo, setArchivo] = useState<string>('');
  const [lectura, setLectura] = useState<StockExcelLeido | null>(null);
  const [sede, setSede] = useState('');
  const [errorLectura, setErrorLectura] = useState<string | null>(null);
  const importar = useImportarStockExcel();

  useEffect(() => {
    if (open) return;
    setArchivo('');
    setLectura(null);
    setSede('');
    setErrorLectura(null);
    importar.reset();
  }, [open]);

  const productos = useMemo(
    () => (lectura && sede ? lectura.productosPorSede[sede] ?? [] : []),
    [lectura, sede],
  );

  function handleDescargarPlantilla(e: React.MouseEvent): void {
    e.preventDefault();

    // Headers y datos de ejemplo genéricos
    const headers = ['Producto', 'Stock', 'Costo', 'Precio', 'Categoria'];
    const dummyRows = [
      ['Coca Cola 350ml', 50, 800, 1200, 'bebidas'],
      ['Agua Mineral 500ml', 30, 600, 900, 'bebidas'],
      ['Papas Fritas 150g', 20, 1000, 1600, 'snacks'],
      ['Alfajor Triple', 40, 500, 850, 'snacks'],
      ['Barra de Cereal', 15, 300, 500, 'snacks'],
    ];

    const data = [headers, ...dummyRows];

    // Crear worksheets para los locales DOMO y SIGNO (asociados al parser del SaaS)
    const worksheetDomo = XLSX.utils.aoa_to_sheet(data);
    const worksheetSigno = XLSX.utils.aoa_to_sheet(data);

    // Crear el libro de trabajo (workbook)
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheetDomo, 'DOMO');
    XLSX.utils.book_append_sheet(workbook, worksheetSigno, 'SIGNO');

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
      setSede(parsed.sedes[0] ?? '');
    } catch (error) {
      setArchivo(file.name);
      setLectura(null);
      setSede('');
      setErrorLectura(error instanceof Error ? error.message : 'No pudimos leer el archivo.');
    }
  }

  async function confirmar(): Promise<void> {
    if (!sede || productos.length === 0) return;
    const result = await importar.mutateAsync(productos);
    onSuccess(result, sede);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Importar stock desde Excel</DialogTitle>
          <DialogDescription>
            Cargá masivamente tus productos, costos, precios y stock. Podés usar tu propio Excel o descargar nuestra plantilla predefinida.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/30 p-3 text-xs">
          <div className="flex items-center gap-2 text-muted-foreground">
            <FileSpreadsheet className="h-4 w-4 text-primary shrink-0" />
            <span>¿No tenés una plantilla armada?</span>
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
            <div className="space-y-2">
              <p className="text-sm font-medium text-foreground">¿Qué sede querés importar?</p>
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

            <div className="rounded-xl border border-border">
              <div className="grid grid-cols-[1fr_auto_auto] gap-3 border-b border-border bg-muted/40 px-3 py-2 text-xs font-semibold text-muted-foreground">
                <span>Producto</span><span>Stock</span><span>Precio</span>
              </div>
              <div className="max-h-56 overflow-y-auto">
                {productos.slice(0, 100).map((producto) => (
                  <div key={producto.nombre} className="grid grid-cols-[1fr_auto_auto] gap-3 border-b border-border/60 px-3 py-2 text-xs last:border-0">
                    <span className="min-w-0 truncate text-foreground">{producto.nombre}</span>
                    <span className="tabular-nums text-muted-foreground">{producto.stock}</span>
                    <span className="w-24 text-right tabular-nums text-foreground">$ {producto.precio.toLocaleString('es-AR')}</span>
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
          <Button type="button" onClick={() => void confirmar()} disabled={productos.length === 0 || importar.isPending}>
            {importar.isPending ? <Loader2 className="animate-spin" /> : <Upload />}
            {importar.isPending ? 'Importando…' : `Importar ${productos.length || ''} productos`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
