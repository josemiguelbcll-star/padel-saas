import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  fechaAnterior,
  fechaHoy,
  fechaSiguiente,
  formatearFechaAmigable,
} from './utils/fechaUtils';

interface NavegacionFechaProps {
  fecha: string;
  onChange: (fecha: string) => void;
}

/**
 * Header de navegación de la grilla del día.
 * Permite mover día a día con flechas, saltar a una fecha puntual con
 * <input type="date"> nativo, y volver a hoy con un atajo.
 */
export function NavegacionFecha({ fecha, onChange }: NavegacionFechaProps) {
  const hoy = fechaHoy();
  const esHoy = fecha === hoy;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={() => onChange(fechaAnterior(fecha))}
          aria-label="Día anterior"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={() => onChange(fechaSiguiente(fecha))}
          aria-label="Día siguiente"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      <span className="min-w-[12rem] text-sm font-medium text-foreground">
        {formatearFechaAmigable(fecha)}
      </span>

      <Input
        type="date"
        value={fecha}
        onChange={(e) => {
          // El input puede emitir '' si el usuario lo borra; ignoramos.
          if (e.target.value) onChange(e.target.value);
        }}
        className="w-auto"
        aria-label="Elegir fecha"
      />

      {!esHoy && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => onChange(hoy)}
        >
          Hoy
        </Button>
      )}
    </div>
  );
}
