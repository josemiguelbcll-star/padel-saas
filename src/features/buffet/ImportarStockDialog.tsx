import { useEffect, useMemo, useRef, useState } from 'react';
import { FileSpreadsheet, Loader2, Upload } from 'lucide-react';
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
            Compatible con el formato de STOCK.xlsx. Actualiza nombre, categoría, costo, precio y deja el stock igual al valor de la sede elegida.
          </DialogDescription>
        </DialogHeader>

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
