import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { Jugador } from '@/types/database';
import { useCreateJugador, useJugadoresSearch } from './hooks/useJugadores';

/**
 * Valor seleccionado: o un jugador registrado en la DB, o un nombre
 * "libre" que se va a guardar como reserva_jugadores.nombre_libre.
 *
 * Para el TITULAR sólo se permite `kind: 'jugador'` (la prop
 * `permitirNombreLibre` controla esto). Para acompañantes ambos kinds
 * son válidos.
 */
export type JugadorSeleccionado =
  | { kind: 'jugador'; jugadorId: number; nombre: string }
  | { kind: 'libre'; nombre: string };

interface JugadorAutocompleteProps {
  value: JugadorSeleccionado | null;
  onChange: (value: JugadorSeleccionado | null) => void;
  /** Si es true, ofrece "Sumar sólo a este partido" (nombre libre). */
  permitirNombreLibre: boolean;
  autoFocus?: boolean;
  disabled?: boolean;
  placeholder?: string;
  id?: string;
  'aria-label'?: string;
}

const DEBOUNCE_MS = 200;
const MIN_QUERY_LENGTH = 2;

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}

type DropdownItem =
  | { kind: 'match'; jugador: Jugador }
  | { kind: 'crearFicha' }
  | { kind: 'nombreLibre' };

export function JugadorAutocomplete({
  value,
  onChange,
  permitirNombreLibre,
  autoFocus,
  disabled,
  placeholder,
  id,
  'aria-label': ariaLabel,
}: JugadorAutocompleteProps) {
  const [query, setQuery] = useState(value?.nombre ?? '');
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const [createError, setCreateError] = useState<string | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const debouncedQuery = useDebouncedValue(query, DEBOUNCE_MS);
  const searchQuery = useJugadoresSearch(debouncedQuery);
  const createMutation = useCreateJugador();

  const trimmed = query.trim();
  const canSearch = trimmed.length >= MIN_QUERY_LENGTH;

  const items = useMemo<DropdownItem[]>(() => {
    if (!canSearch) return [];
    const matches: DropdownItem[] = (searchQuery.data ?? []).map((j) => ({
      kind: 'match',
      jugador: j,
    }));
    const acciones: DropdownItem[] = [{ kind: 'crearFicha' }];
    if (permitirNombreLibre) acciones.push({ kind: 'nombreLibre' });
    return [...matches, ...acciones];
  }, [searchQuery.data, permitirNombreLibre, canSearch]);

  // Cerrar al clickear afuera del wrapper.
  useEffect(() => {
    if (!open) return undefined;
    function onMouseDown(e: MouseEvent) {
      if (!wrapperRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [open]);

  // Reset highlighted cuando cambia la lista (resultados nuevos).
  useEffect(() => {
    setHighlighted(0);
  }, [items.length]);

  function handleInputChange(newQuery: string): void {
    setQuery(newQuery);
    setCreateError(null);
    // Si el usuario edita por encima de un valor seleccionado, lo
    // limpia: ya no representa lo que muestra el input.
    if (value && newQuery !== value.nombre) {
      onChange(null);
    }
    setOpen(true);
  }

  async function selectItem(item: DropdownItem): Promise<void> {
    if (item.kind === 'match') {
      onChange({
        kind: 'jugador',
        jugadorId: item.jugador.id,
        nombre: item.jugador.nombre,
      });
      setQuery(item.jugador.nombre);
      setOpen(false);
      return;
    }
    if (item.kind === 'crearFicha') {
      try {
        const nuevo = await createMutation.mutateAsync({
          nombre: trimmed,
          telefono: null,
          email: null,
          // `nivel` queda en null (campo legacy, deprecado desde 0011).
          nivel: null,
          notas: null,
          // Campos nuevos de la 0011: el autocomplete crea fichas
          // "rápidas" con solo nombre — el resto se completa después
          // desde la pantalla Jugadores.
          genero: null,
          categoria: null,
          posicion: null,
          activo: true,
        });
        onChange({
          kind: 'jugador',
          jugadorId: nuevo.id,
          nombre: nuevo.nombre,
        });
        setQuery(nuevo.nombre);
        setOpen(false);
      } catch (err) {
        setCreateError(
          err instanceof Error
            ? err.message
            : 'No pudimos crear el jugador.',
        );
      }
      return;
    }
    if (item.kind === 'nombreLibre') {
      onChange({ kind: 'libre', nombre: trimmed });
      setQuery(trimmed);
      setOpen(false);
    }
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>): void {
    // Abrir el dropdown con ↓ si hay resultados disponibles y está cerrado.
    if (!open && e.key === 'ArrowDown' && canSearch && items.length > 0) {
      e.preventDefault();
      setOpen(true);
      return;
    }

    // Mientras el dropdown está cerrado, Enter cae al form (submit nativo).
    if (!open) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setHighlighted((h) => Math.min(h + 1, items.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setHighlighted((h) => Math.max(h - 1, 0));
        break;
      case 'Enter': {
        if (items.length === 0) return;
        e.preventDefault();
        const selectable = items[highlighted];
        if (selectable) void selectItem(selectable);
        break;
      }
      case 'Escape':
        e.preventDefault();
        setOpen(false);
        break;
      default:
        break;
    }
  }

  const isCreating = createMutation.isPending;

  return (
    <div ref={wrapperRef} className="relative">
      <Input
        id={id}
        type="text"
        value={query}
        onChange={(e) => handleInputChange(e.target.value)}
        onFocus={() => {
          if (canSearch && items.length > 0) setOpen(true);
        }}
        onKeyDown={handleKeyDown}
        autoFocus={autoFocus}
        disabled={disabled || isCreating}
        placeholder={placeholder}
        aria-label={ariaLabel}
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
      />

      {open && items.length > 0 && (
        <ul
          role="listbox"
          className="absolute left-0 right-0 top-full z-20 mt-1 max-h-72 overflow-y-auto rounded-md border border-border bg-popover shadow-lg"
        >
          {items.map((item, idx) => {
            const isHighlighted = idx === highlighted;
            const needsSeparator =
              idx > 0 && item.kind !== 'match' && items[idx - 1]?.kind === 'match';
            return (
              <li key={dropdownItemKey(item, idx)} role="presentation">
                {needsSeparator && (
                  <div className="border-t border-border" aria-hidden="true" />
                )}
                <DropdownItemButton
                  item={item}
                  query={trimmed}
                  highlighted={isHighlighted}
                  isCreating={isCreating && item.kind === 'crearFicha'}
                  onSelect={() => {
                    void selectItem(item);
                  }}
                  onHover={() => setHighlighted(idx)}
                />
              </li>
            );
          })}
        </ul>
      )}

      {createError && (
        <p className="mt-1 text-xs text-destructive" role="alert">
          {createError}
        </p>
      )}
    </div>
  );
}

function dropdownItemKey(item: DropdownItem, idx: number): string {
  if (item.kind === 'match') return `match-${item.jugador.id}`;
  if (item.kind === 'crearFicha') return 'crear-ficha';
  if (item.kind === 'nombreLibre') return 'nombre-libre';
  return `idx-${idx}`;
}

interface DropdownItemButtonProps {
  item: DropdownItem;
  query: string;
  highlighted: boolean;
  isCreating: boolean;
  onSelect: () => void;
  onHover: () => void;
}

function DropdownItemButton({
  item,
  query,
  highlighted,
  isCreating,
  onSelect,
  onHover,
}: DropdownItemButtonProps) {
  const baseClasses = cn(
    'block w-full px-3 py-2 text-left text-sm transition-colors',
    'focus:outline-none',
    highlighted
      ? 'bg-accent text-accent-foreground'
      : 'text-foreground hover:bg-muted',
  );

  if (item.kind === 'match') {
    return (
      <button
        type="button"
        role="option"
        aria-selected={highlighted}
        onMouseDown={(e) => {
          // Evita que el blur del input dispare cierre antes del click.
          e.preventDefault();
        }}
        onClick={onSelect}
        onMouseEnter={onHover}
        className={baseClasses}
      >
        {item.jugador.nombre}
      </button>
    );
  }

  if (item.kind === 'crearFicha') {
    return (
      <button
        type="button"
        role="option"
        aria-selected={highlighted}
        onMouseDown={(e) => e.preventDefault()}
        onClick={onSelect}
        onMouseEnter={onHover}
        disabled={isCreating}
        className={cn(baseClasses, isCreating && 'opacity-60')}
      >
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {isCreating ? 'Creando…' : 'Crear ficha'}
        </span>{' '}
        <span className="font-medium">{query}</span>
      </button>
    );
  }

  if (item.kind === 'nombreLibre') {
    return (
      <button
        type="button"
        role="option"
        aria-selected={highlighted}
        onMouseDown={(e) => e.preventDefault()}
        onClick={onSelect}
        onMouseEnter={onHover}
        className={baseClasses}
      >
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          Sólo este partido
        </span>{' '}
        <span className="font-medium">{query}</span>
      </button>
    );
  }

  return null;
}
