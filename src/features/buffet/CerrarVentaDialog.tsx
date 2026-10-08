import { useState, useMemo, useEffect, useRef, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import type { Jugador, MedioPago, Venta } from '@/types/database';
import { useJugadores } from '@/features/reservas/hooks/useJugadores';
import { useCuentas } from '@/features/configuracion/hooks/useCuentas';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import {
  useCerrarVenta,
  type CerrarVentaItem,
  type CerrarVentaPagoItem,
} from './hooks/useCerrarVenta';
import type { BuffetMesa } from './hooks/useMesasBuffet';
import type { VentaItemEnriquecido } from './VentaActual';
import {
  CheckCircle2,
  AlertCircle,
  Trash2,
  Split,
  CreditCard,
  Sparkles,
  User,
  Ticket,
  UtensilsCrossed,
  Equal,
  Search,
  X,
} from 'lucide-react';

const currencyFmt = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const MEDIOS_PAGO_LIST: readonly MedioPago[] = [
  'efectivo',
  'transferencia',
  'mp',
  'tarjeta',
  'cuenta_corriente',
  'otro',
] as const;

const MEDIO_PAGO_LABEL: Record<MedioPago, string> = {
  efectivo: 'Efectivo',
  transferencia: 'Transferencia',
  mp: 'Mercado Pago',
  tarjeta: 'Tarjeta',
  cuenta_corriente: 'Cuenta Corriente',
  otro: 'Otro',
  mixto: 'Mixto',
};

function mapCuentaTipoToMedio(tipo: string): MedioPago {
  if (tipo === 'efectivo') return 'efectivo';
  if (tipo === 'billetera') return 'mp';
  if (tipo === 'banco') return 'transferencia';
  return 'otro';
}

function calcularPartesIguales(total: number, count: number): number[] {
  if (count <= 0) return [];
  const base = Math.floor((total / count) * 100) / 100;
  const resto = Number((total - base * count).toFixed(2));
  const centavosRestantes = Math.round(resto * 100);

  return Array.from({ length: count }, (_, i) => {
    const extra = i < centavosRestantes ? 0.01 : 0;
    return Number((base + extra).toFixed(2));
  });
}

export type TipoPersonaPago = 'general' | 'jugador' | 'invitado';
export type ModalidadPagoPersona = 'productos' | 'monto';

export interface PersonaCobro {
  id: string;
  tipo: TipoPersonaPago;
  jugador: Jugador | null;
  nombreInvitado: string;
  modalidad: ModalidadPagoPersona;
  productosAsignados: Record<number, number>; // productoId -> cantidad asignada
  montoManual: string;
  medioPago: MedioPago;
  cuentaId: number | null;
}

export interface CerrarVentaDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: VentaItemEnriquecido[];
  total: number;
  mesa?: BuffetMesa | null;
  onSuccess: (venta: Venta) => void;
}

/**
 * Componente interactivo para buscar y escribir el nombre de un jugador
 * en tiempo real sin usar un selector estático HTML.
 */
function JugadorSearchInput({
  jugador,
  onSelect,
  jugadores,
  disabled,
}: {
  jugador: Jugador | null;
  onSelect: (j: Jugador | null) => void;
  jugadores: Jugador[];
  disabled?: boolean;
}) {
  const [query, setQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return jugadores
      .filter((j) => {
        const nom = j.nombre.toLowerCase();
        const tel = j.telefono?.toLowerCase() ?? '';
        return nom.includes(q) || tel.includes(q);
      })
      .slice(0, 8);
  }, [query, jugadores]);

  if (jugador) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-md border border-primary/30 bg-primary/5 px-2.5 py-1.5 text-xs">
        <div className="flex items-center gap-1.5 truncate">
          <User className="h-3.5 w-3.5 text-primary shrink-0" />
          <span className="font-semibold text-foreground truncate">{jugador.nombre}</span>
          {jugador.telefono && (
            <span className="text-muted-foreground text-[11px] shrink-0">({jugador.telefono})</span>
          )}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            onSelect(null);
            setQuery('');
            setIsOpen(true);
          }}
          disabled={disabled}
          className="h-6 px-1.5 text-[11px] text-muted-foreground hover:text-foreground"
        >
          Cambiar
        </Button>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
        <Input
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setIsOpen(true);
          }}
          onFocus={() => setIsOpen(true)}
          disabled={disabled}
          placeholder="Escribí para buscar jugador por nombre o tel…"
          className="h-8 pl-8 pr-7 text-xs"
        />
        {query && (
          <button
            type="button"
            onClick={() => {
              setQuery('');
              setIsOpen(false);
            }}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-0.5"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>

      {isOpen && query.trim().length > 0 && (
        <div className="absolute z-50 mt-1 max-h-48 w-full overflow-y-auto rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md">
          {matches.length > 0 ? (
            matches.map((j) => (
              <button
                key={j.id}
                type="button"
                onClick={() => {
                  onSelect(j);
                  setQuery('');
                  setIsOpen(false);
                }}
                className="flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-xs hover:bg-muted focus:bg-muted focus:outline-none transition-colors"
              >
                <span className="font-medium truncate">{j.nombre}</span>
                {j.telefono && (
                  <span className="text-[10px] text-muted-foreground shrink-0">{j.telefono}</span>
                )}
              </button>
            ))
          ) : (
            <div className="p-2 text-center text-[11px] text-muted-foreground">
              No se encontraron jugadores con "{query}"
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function CerrarVentaDialog({
  open,
  onOpenChange,
  items,
  total,
  mesa,
  onSuccess,
}: CerrarVentaDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-1.5rem)] sm:w-full max-w-md sm:max-w-2xl max-h-[92vh] overflow-y-auto overflow-x-hidden p-3.5 sm:p-6">
        <CerrarVentaBody
          key={open ? (mesa ? `mesa-${mesa.id}` : 'venta-open') : 'closed'}
          items={items}
          total={total}
          mesa={mesa}
          onSuccess={onSuccess}
          onCancel={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

interface CerrarVentaBodyProps {
  items: VentaItemEnriquecido[];
  total: number;
  mesa?: BuffetMesa | null;
  onSuccess: (venta: Venta) => void;
  onCancel: () => void;
}

function CerrarVentaBody({
  items,
  total,
  mesa,
  onSuccess,
  onCancel,
}: CerrarVentaBodyProps) {
  const queryClient = useQueryClient();

  // Siempre se puede dividir entre personas (1 o más) o usar pago único
  const [esPagoMixto, setEsPagoMixto] = useState<boolean>(() => {
    return !!mesa || items.length > 1;
  });

  const [medio, setMedio] = useState<MedioPago>('efectivo');
  const [selectedCuentaId, setSelectedCuentaId] = useState<number | null>(null);
  const [obs, setObs] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Estado para asignación de persona en Pago Único
  const [singlePersonaTipo, setSinglePersonaTipo] = useState<TipoPersonaPago>('general');
  const [singleJugador, setSingleJugador] = useState<Jugador | null>(null);
  const [singleNombreInvitado, setSingleNombreInvitado] = useState('');

  const cuentasQuery = useCuentas();
  // Ordenar cuentas priorizando Caja Física / Efectivo al tope
  const cuentasActivas = useMemo(() => {
    const list = (cuentasQuery.data ?? []).filter((c) => c.activa);
    return [...list].sort((a, b) => {
      if (a.es_caja_fisica || a.tipo === 'efectivo') return -1;
      if (b.es_caja_fisica || b.tipo === 'efectivo') return 1;
      return a.nombre.localeCompare(b.nombre);
    });
  }, [cuentasQuery.data]);

  const cuentaEfectivo = useMemo(() => {
    return (
      cuentasActivas.find((c) => c.es_caja_fisica || c.tipo === 'efectivo') ??
      cuentasActivas[0] ??
      null
    );
  }, [cuentasActivas]);

  const jugadoresQuery = useJugadores();
  const jugadores = jugadoresQuery.data ?? [];

  // Pre-vincular el nombre de la mesa si coincide con un jugador registrado
  const mesaJugadorMatch = useMemo(() => {
    if (!mesa?.nombre) return null;
    const clean = mesa.nombre.trim().toLowerCase();
    return jugadores.find((j) => j.nombre.trim().toLowerCase() === clean) ?? null;
  }, [mesa?.nombre, jugadores]);

  // Lista de Personas / Pagadores en modo dividido (arranca en Efectivo)
  const [personas, setPersonas] = useState<PersonaCobro[]>(() => {
    const halves = calcularPartesIguales(total, 2);

    const p1Jugador = mesaJugadorMatch;
    const p1Tipo: TipoPersonaPago = p1Jugador ? 'jugador' : mesa?.nombre ? 'invitado' : 'general';
    const p1NombreInvitado = p1Jugador ? '' : mesa?.nombre ? mesa.nombre : 'Invitado 1';

    return [
      {
        id: '1',
        tipo: p1Tipo,
        jugador: p1Jugador,
        nombreInvitado: p1NombreInvitado,
        modalidad: items.length > 1 ? 'productos' : 'monto',
        productosAsignados: {},
        montoManual: (halves[0] ?? 0) > 0 ? String(halves[0]) : '',
        medioPago: 'efectivo',
        cuentaId: null,
      },
      {
        id: '2',
        tipo: 'invitado',
        jugador: null,
        nombreInvitado: 'Invitado 2',
        modalidad: items.length > 1 ? 'productos' : 'monto',
        productosAsignados: {},
        montoManual: (halves[1] ?? 0) > 0 ? String(halves[1]) : '',
        medioPago: 'efectivo',
        cuentaId: null,
      },
    ];
  });

  // Vincular con cuentas activas cuando carguen, asegurando que el default sea EFECTIVO
  useEffect(() => {
    if (cuentasActivas.length > 0) {
      const defCaja = cuentaEfectivo ?? cuentasActivas[0];
      if (selectedCuentaId === null && defCaja) {
        setSelectedCuentaId(defCaja.id);
        setMedio(mapCuentaTipoToMedio(defCaja.tipo));
      }

      setPersonas((prev) => {
        return prev.map((p) => {
          if (p.cuentaId) return p;
          return {
            ...p,
            medioPago: defCaja ? mapCuentaTipoToMedio(defCaja.tipo) : 'efectivo',
            cuentaId: defCaja ? defCaja.id : null,
          };
        });
      });
    }
  }, [cuentasActivas, cuentaEfectivo, selectedCuentaId]);

  // Si mesaJugadorMatch aparece luego de cargar jugadores, actualizar Persona 1 si estaba vacía
  useEffect(() => {
    if (mesaJugadorMatch) {
      setPersonas((prev) => {
        const p0 = prev[0];
        if (p0 && p0.tipo !== 'jugador' && !p0.jugador) {
          return prev.map((p, i) => (i === 0 ? { ...p, tipo: 'jugador', jugador: mesaJugadorMatch } : p));
        }
        return prev;
      });
    }
  }, [mesaJugadorMatch]);

  const cerrarMutation = useCerrarVenta();
  const isPending = cerrarMutation.isPending;

  // ── Cálculo del monto de cada persona según su modalidad ────────────
  function getMontoPersona(p: PersonaCobro): number {
    if (p.modalidad === 'productos') {
      return items.reduce((sum, item) => {
        const cant = p.productosAsignados[item.producto.id] || 0;
        return sum + cant * item.producto.precio;
      }, 0);
    }
    const val = parseFloat(p.montoManual.replace(',', '.'));
    return isNaN(val) ? 0 : val;
  }

  const sumaPartes = useMemo(() => {
    return personas.reduce((acc, p) => acc + getMontoPersona(p), 0);
  }, [personas, items]);

  const diferencia = Number((total - sumaPartes).toFixed(2));
  const totalExacto = Math.abs(diferencia) < 0.01;

  // Conteo de productos asignados entre todos
  const productosAsignadosTotal = useMemo(() => {
    const mapa: Record<number, number> = {};
    for (const p of personas) {
      if (p.modalidad === 'productos') {
        for (const [prodIdStr, cant] of Object.entries(p.productosAsignados)) {
          const id = Number(prodIdStr);
          mapa[id] = (mapa[id] || 0) + cant;
        }
      }
    }
    return mapa;
  }, [personas]);

  // ── Handlers de división y autocompletar ─────────────────────────────

  function handleAutoCompletarResto(personaId: string) {
    const sumaOtras = personas
      .filter((p) => p.id !== personaId)
      .reduce((acc, p) => acc + getMontoPersona(p), 0);

    const restante = Math.max(0, Number((total - sumaOtras).toFixed(2)));
    setPersonas((prev) =>
      prev.map((p) =>
        p.id === personaId
          ? { ...p, modalidad: 'monto', montoManual: restante.toString() }
          : p,
      ),
    );
  }

  function handleDividirEnPartes(n: number) {
    if (n < 1) return;
    const montos = calcularPartesIguales(total, n);
    const defCaja = cuentaEfectivo ?? cuentasActivas[0];

    setPersonas((prev) => {
      const nuevas: PersonaCobro[] = [];
      for (let i = 0; i < n; i++) {
        const existente = prev[i];
        if (existente) {
          nuevas.push({
            ...existente,
            modalidad: 'monto',
            montoManual: montos[i]?.toString() ?? '0',
          });
        } else {
          nuevas.push({
            id: String(Date.now() + i),
            tipo: 'invitado',
            jugador: null,
            nombreInvitado: `Invitado ${i + 1}`,
            modalidad: 'monto',
            productosAsignados: {},
            montoManual: montos[i]?.toString() ?? '0',
            medioPago: defCaja ? mapCuentaTipoToMedio(defCaja.tipo) : 'efectivo',
            cuentaId: defCaja ? defCaja.id : null,
          });
        }
      }
      return nuevas;
    });
  }

  function handleDividirPartesIguales() {
    if (personas.length === 0) return;
    const montos = calcularPartesIguales(total, personas.length);
    setPersonas((prev) =>
      prev.map((p, idx) => ({
        ...p,
        modalidad: 'monto',
        montoManual: montos[idx]?.toString() ?? '0',
      })),
    );
  }

  function handleAgregarPersona(tipo: TipoPersonaPago) {
    const defCaja = cuentaEfectivo ?? cuentasActivas[0];
    const restante = Math.max(0, diferencia);
    const countInvitados = personas.filter((p) => p.tipo === 'invitado').length;

    setPersonas((prev) => [
      ...prev,
      {
        id: String(Date.now()),
        tipo,
        jugador: null,
        nombreInvitado: tipo === 'invitado' ? `Invitado ${countInvitados + 1}` : '',
        modalidad: items.length > 1 ? 'productos' : 'monto',
        productosAsignados: {},
        montoManual: restante > 0 ? restante.toString() : '',
        medioPago: defCaja ? mapCuentaTipoToMedio(defCaja.tipo) : 'efectivo',
        cuentaId: defCaja ? defCaja.id : null,
      },
    ]);
  }

  function handleEliminarPersona(id: string) {
    // Permitir eliminar hasta que quede 1 persona (no limitar a 2)
    if (personas.length <= 1) return;
    setPersonas((prev) => prev.filter((p) => p.id !== id));
  }

  function handleUpdatePersona(id: string, updates: Partial<PersonaCobro>) {
    setPersonas((prev) =>
      prev.map((p) => (p.id === id ? { ...p, ...updates } : p)),
    );
  }

  // ── Envío del formulario ────────────────────────────────────────────

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);

    if (items.length === 0) {
      setError('No hay productos cargados para cobrar.');
      return;
    }

    const rpcItems: CerrarVentaItem[] = items.map((i) => ({
      producto_id: i.producto.id,
      cantidad: i.cantidad,
    }));

    if (esPagoMixto) {
      // Permitir 1 o más personas sin forzar a mínimo 2
      if (personas.length === 0) {
        setError('Debes ingresar al menos 1 persona o pago para registrar la venta.');
        return;
      }

      for (let i = 0; i < personas.length; i++) {
        const p = personas[i];
        if (!p) continue;
        const montoNum = getMontoPersona(p);

        if (montoNum <= 0) {
          const nombreLabel =
            p.tipo === 'jugador'
              ? p.jugador?.nombre ?? `Jugador #${i + 1}`
              : p.tipo === 'invitado'
                ? p.nombreInvitado.trim() || `Invitado #${i + 1}`
                : `Persona #${i + 1}`;
          setError(`El importe de ${nombreLabel} debe ser mayor a 0. Elegí productos o ingresá un monto.`);
          return;
        }

        if (p.medioPago === 'cuenta_corriente') {
          if (p.tipo !== 'jugador' || !p.jugador) {
            setError(`El cobro #${i + 1} con Cuenta Corriente requiere seleccionar un jugador registrado.`);
            return;
          }
        }
      }

      if (!totalExacto) {
        if (diferencia > 0) {
          setError(`Faltan asignar ${currencyFmt.format(diferencia)} para cubrir el total de la mesa.`);
        } else {
          setError(`La suma de los cobros supera el total por ${currencyFmt.format(Math.abs(diferencia))}.`);
        }
        return;
      }

      const rpcPagos: CerrarVentaPagoItem[] = personas.map((p) => ({
        medio_pago: p.medioPago,
        monto: Number(getMontoPersona(p).toFixed(2)),
        cuenta_id: p.cuentaId ?? null,
        jugador_id: p.tipo === 'jugador' ? p.jugador?.id ?? null : null,
      }));

      // Resumen descriptivo de los pagadores en las observaciones para comprobantes/auditoría
      const desglosePersonas = personas
        .map((p, idx) => {
          let nombre = 'General';
          if (p.tipo === 'jugador') {
            nombre = p.jugador?.nombre ?? 'Jugador';
          } else if (p.tipo === 'invitado') {
            nombre = p.nombreInvitado?.trim() || `Invitado ${idx + 1}`;
          }

          let detalle = '';
          if (p.modalidad === 'productos') {
            const prods = items
              .filter((it) => (p.productosAsignados[it.producto.id] || 0) > 0)
              .map((it) => `${p.productosAsignados[it.producto.id]}× ${it.producto.nombre}`)
              .join(', ');
            detalle = prods ? ` [${prods}]` : '';
          }

          const mLabel = p.cuentaId
            ? cuentasActivas.find((c) => c.id === p.cuentaId)?.nombre ?? MEDIO_PAGO_LABEL[p.medioPago]
            : MEDIO_PAGO_LABEL[p.medioPago];

          return `${nombre}${detalle}: $${getMontoPersona(p)} (${mLabel})`;
        })
        .join(' | ');

      const obsFinal = [
        obs.trim() || null,
        `[Desglose: ${desglosePersonas}]`,
      ].filter(Boolean).join('\n');

      const primerJugadorId = personas.find((p) => p.tipo === 'jugador')?.jugador?.id ?? null;

      try {
        const venta = await cerrarMutation.mutateAsync({
          items: rpcItems,
          medio_pago: 'mixto',
          observaciones: obsFinal,
          jugador_id: primerJugadorId,
          pagos: rpcPagos,
        });

        if (mesa) {
          const { error: mesaErr } = await supabase
            .from('buffet_mesas')
            .update({
              abierta: false,
              cerrada_at: new Date().toISOString(),
              venta_id: venta.id,
            })
            .eq('id', mesa.id);

          if (mesaErr) {
            console.error('Error cerrando mesa:', mesaErr);
          }
          void queryClient.invalidateQueries({ queryKey: ['buffet-mesas'] });
        }

        // Invalidar inmediatamente consultas de caja para reflejar los cobros
        void queryClient.invalidateQueries({ queryKey: ['caja'] });
        void queryClient.invalidateQueries({ queryKey: ['caja-movimientos'] });
        void queryClient.invalidateQueries({ queryKey: ['caja-abierta-resumen'] });

        onSuccess(venta);
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : 'No pudimos registrar la venta.',
        );
      }
    } else {
      // Modo pago único (1 persona paga el total)
      if (!medio) {
        setError('Elegí un medio de pago.');
        return;
      }
      if (medio === 'cuenta_corriente' && !singleJugador) {
        setError('Elegí un jugador registrado para debitar de su Cuenta Corriente.');
        return;
      }

      let personaNota: string | null = null;
      if (singlePersonaTipo === 'invitado' && singleNombreInvitado.trim()) {
        personaNota = `[Cliente: Invitado (${singleNombreInvitado.trim()})]`;
      } else if (singlePersonaTipo === 'jugador' && singleJugador) {
        personaNota = `[Cliente: ${singleJugador.nombre}]`;
      }

      const obsFinal = [obs.trim() || null, personaNota].filter(Boolean).join('\n');

      try {
        const venta = await cerrarMutation.mutateAsync({
          items: rpcItems,
          medio_pago: medio,
          cuenta_id: selectedCuentaId ?? null,
          observaciones: obsFinal.trim() === '' ? null : obsFinal,
          jugador_id: singlePersonaTipo === 'jugador' ? singleJugador?.id ?? null : null,
          pagos: null,
        });

        if (mesa) {
          const { error: mesaErr } = await supabase
            .from('buffet_mesas')
            .update({
              abierta: false,
              cerrada_at: new Date().toISOString(),
              venta_id: venta.id,
            })
            .eq('id', mesa.id);

          if (mesaErr) {
            console.error('Error cerrando mesa:', mesaErr);
          }
          void queryClient.invalidateQueries({ queryKey: ['buffet-mesas'] });
        }

        // Invalidar inmediatamente consultas de caja para reflejar los cobros
        void queryClient.invalidateQueries({ queryKey: ['caja'] });
        void queryClient.invalidateQueries({ queryKey: ['caja-movimientos'] });
        void queryClient.invalidateQueries({ queryKey: ['caja-abierta-resumen'] });

        onSuccess(venta);
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : 'No pudimos registrar la venta.',
        );
      }
    }
  }

  return (
    <>
      <DialogHeader className="pr-7 sm:pr-8">
        <div className="flex flex-col sm:flex-row sm:items-baseline justify-between gap-1 sm:gap-4">
          <DialogTitle className="flex items-center gap-2 min-w-0 text-base sm:text-lg">
            {mesa ? (
              <>
                <UtensilsCrossed className="h-4.5 w-4.5 sm:h-5 sm:w-5 text-primary shrink-0" />
                <span className="truncate">Cerrar mesa: {mesa.nombre}</span>
              </>
            ) : (
              <span>Cerrar venta</span>
            )}
          </DialogTitle>
          <div className="flex items-center gap-1.5 shrink-0">
            <span className="text-xs text-muted-foreground sm:hidden">Total:</span>
            <span className="text-lg sm:text-xl font-bold text-primary tabular-nums">
              {currencyFmt.format(total)}
            </span>
          </div>
        </div>
        <DialogDescription className="text-xs sm:text-sm">
          {mesa
            ? 'Asigná productos o montos entre jugadores e invitados para cerrar la mesa.'
            : 'Elegí la modalidad de cobro para confirmar la transacción.'}
        </DialogDescription>
      </DialogHeader>

      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        {/* Resumen de items de la mesa / venta */}
        <div className="space-y-1.5 rounded-md border border-border bg-muted/20 p-2 sm:p-2.5 text-xs max-h-32 overflow-y-auto">
          <span className="text-[11px] font-semibold text-muted-foreground block">
            Productos cargados ({items.length}):
          </span>
          {items.map((item) => (
            <div
              key={item.producto.id}
              className="flex items-baseline justify-between gap-2 min-w-0"
            >
              <span className="truncate text-muted-foreground min-w-0">
                <span className="font-semibold text-foreground">{item.cantidad}×</span> {item.producto.nombre}
              </span>
              <span className="shrink-0 tabular-nums text-foreground font-medium">
                {currencyFmt.format(item.subtotal)}
              </span>
            </div>
          ))}
        </div>

        {/* Selector de modo principal */}
        <div className="grid grid-cols-2 rounded-lg bg-muted p-1 text-xs gap-1">
          <button
            type="button"
            onClick={() => setEsPagoMixto(true)}
            disabled={isPending}
            className={cn(
              'flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-md font-medium transition-all text-center min-w-0',
              esPagoMixto
                ? 'bg-background text-foreground shadow-sm font-semibold'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Split className="h-3.5 w-3.5 text-primary shrink-0" />
            <span className="truncate sm:hidden">Por personas</span>
            <span className="hidden sm:inline">Por personas (Productos o Montos)</span>
          </button>
          <button
            type="button"
            onClick={() => setEsPagoMixto(false)}
            disabled={isPending}
            className={cn(
              'flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-md font-medium transition-all text-center min-w-0',
              !esPagoMixto
                ? 'bg-background text-foreground shadow-sm font-semibold'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <CreditCard className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate sm:hidden">Cobro rápido</span>
            <span className="hidden sm:inline">Cobro rápido (1 medio para todo)</span>
          </button>
        </div>

        {/* ── MODO DIVIDIDO POR PERSONAS / PRODUCTOS ─────────────────── */}
        {esPagoMixto && (
          <div className="space-y-3">
            {/* Barra de atajos para división rápida */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-1.5 border-b border-border/50">
              <div className="flex items-center gap-1 flex-wrap">
                <span className="text-[11px] font-semibold text-muted-foreground mr-0.5 shrink-0">
                  Atajos:
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => handleDividirEnPartes(1)}
                  disabled={isPending}
                  className="h-6 px-1.5 sm:px-2 text-[10px] sm:text-[11px]"
                  title="Una sola persona paga el total"
                >
                  1 pers.
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => handleDividirEnPartes(2)}
                  disabled={isPending}
                  className="h-6 px-1.5 sm:px-2 text-[10px] sm:text-[11px]"
                >
                  2 pers.
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => handleDividirEnPartes(3)}
                  disabled={isPending}
                  className="h-6 px-1.5 sm:px-2 text-[10px] sm:text-[11px]"
                >
                  3 pers.
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => handleDividirEnPartes(4)}
                  disabled={isPending}
                  className="h-6 px-1.5 sm:px-2 text-[10px] sm:text-[11px]"
                >
                  4 pers.
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={handleDividirPartesIguales}
                  disabled={isPending}
                  className="h-6 px-1.5 sm:px-2 text-[10px] sm:text-[11px] text-muted-foreground hover:text-foreground gap-1"
                  title="Repartir el total en partes iguales entre las filas actuales"
                >
                  <Equal className="h-3 w-3" />
                  Iguales
                </Button>
              </div>

              <div className="flex items-center gap-1 self-start sm:self-auto shrink-0">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => handleAgregarPersona('jugador')}
                  disabled={isPending}
                  className="h-6 px-1.5 sm:px-2 text-[11px] text-primary hover:bg-primary/10 gap-1"
                >
                  <User className="h-3 w-3" />
                  + Jugador
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => handleAgregarPersona('invitado')}
                  disabled={isPending}
                  className="h-6 px-1.5 sm:px-2 text-[11px] text-primary hover:bg-primary/10 gap-1"
                >
                  <Ticket className="h-3 w-3" />
                  + Invitado
                </Button>
              </div>
            </div>

            {/* Listado de tarjetas de personas */}
            <div className="space-y-3">
              {personas.map((p, index) => {
                const montoPersona = getMontoPersona(p);
                const subtotalProds = items.reduce((sum, item) => {
                  const cant = p.productosAsignados[item.producto.id] || 0;
                  return sum + cant * item.producto.precio;
                }, 0);

                const selectValue =
                  p.medioPago === 'cuenta_corriente'
                    ? 'cc'
                    : p.cuentaId
                      ? `cuenta_${p.cuentaId}`
                      : `medio_${p.medioPago}`;

                const sumaOtras = personas
                  .filter((x) => x.id !== p.id)
                  .reduce((acc, x) => acc + getMontoPersona(x), 0);
                const faltaParaEsta = Math.max(0, Number((total - sumaOtras).toFixed(2)));
                const puedeCompletar =
                  p.modalidad === 'monto' &&
                  faltaParaEsta > 0 &&
                  Math.abs(montoPersona - faltaParaEsta) > 0.01;

                return (
                  <div
                    key={p.id}
                    className="p-2.5 sm:p-3 rounded-xl border border-border bg-card/70 space-y-2.5 shadow-xs transition-all min-w-0"
                  >
                    {/* Encabezado: Número, Tipo de persona y Botón Eliminar */}
                    <div className="flex flex-wrap items-center justify-between gap-1.5 border-b border-border/40 pb-2">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary shrink-0">
                          #{index + 1}
                        </span>

                        <div className="flex rounded-md bg-muted p-0.5 text-[10px]">
                          <button
                            type="button"
                            onClick={() =>
                              handleUpdatePersona(p.id, {
                                tipo: 'general',
                                jugador: null,
                                ...(p.medioPago === 'cuenta_corriente'
                                  ? { medioPago: 'efectivo', cuentaId: cuentaEfectivo?.id ?? null }
                                  : {}),
                              })
                            }
                            className={cn(
                              'px-1.5 sm:px-2 py-0.5 rounded font-medium transition-all',
                              p.tipo === 'general'
                                ? 'bg-background text-foreground shadow-xs font-semibold'
                                : 'text-muted-foreground hover:text-foreground',
                            )}
                          >
                            General
                          </button>
                          <button
                            type="button"
                            onClick={() => handleUpdatePersona(p.id, { tipo: 'jugador' })}
                            className={cn(
                              'flex items-center gap-1 px-1.5 sm:px-2 py-0.5 rounded font-medium transition-all',
                              p.tipo === 'jugador'
                                ? 'bg-background text-foreground shadow-xs font-semibold'
                                : 'text-muted-foreground hover:text-foreground',
                            )}
                          >
                            <User className="h-3 w-3 shrink-0" />
                            Jugador
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              const defName = p.nombreInvitado || `Invitado ${index + 1}`;
                              handleUpdatePersona(p.id, {
                                tipo: 'invitado',
                                nombreInvitado: defName,
                                jugador: null,
                                ...(p.medioPago === 'cuenta_corriente'
                                  ? { medioPago: 'efectivo', cuentaId: cuentaEfectivo?.id ?? null }
                                  : {}),
                              });
                            }}
                            className={cn(
                              'flex items-center gap-1 px-1.5 sm:px-2 py-0.5 rounded font-medium transition-all',
                              p.tipo === 'invitado'
                                ? 'bg-background text-foreground shadow-xs font-semibold'
                                : 'text-muted-foreground hover:text-foreground',
                            )}
                          >
                            <Ticket className="h-3 w-3 shrink-0" />
                            Invitado
                          </button>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0 ml-auto">
                        <span className="text-xs sm:text-sm font-bold tabular-nums text-primary">
                          {currencyFmt.format(montoPersona)}
                        </span>
                        {personas.length > 1 && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => handleEliminarPersona(p.id)}
                            disabled={isPending}
                            className="h-6 w-6 text-muted-foreground hover:text-destructive shrink-0"
                            title="Eliminar este pagador"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    </div>

                    {/* Identificación de la Persona (Input de texto / Búsqueda en vivo) */}
                    {p.tipo === 'jugador' && (
                      <div className="space-y-1">
                        <Label className="text-[11px] text-muted-foreground font-medium">
                          Jugador (escribí el nombre):
                        </Label>
                        <JugadorSearchInput
                          jugador={p.jugador}
                          onSelect={(j) => handleUpdatePersona(p.id, { jugador: j })}
                          jugadores={jugadores}
                          disabled={isPending}
                        />
                      </div>
                    )}

                    {p.tipo === 'invitado' && (
                      <div className="space-y-1">
                        <Label className="text-[11px] text-muted-foreground font-medium">
                          Nombre del invitado:
                        </Label>
                        <Input
                          type="text"
                          value={p.nombreInvitado}
                          onChange={(e) => handleUpdatePersona(p.id, { nombreInvitado: e.target.value })}
                          disabled={isPending}
                          placeholder={`Invitado ${index + 1} (ej. Carlos, Amigo de Juan)`}
                          className="h-8 text-xs"
                        />
                      </div>
                    )}

                    {/* Selector de Modalidad: ¿Paga por productos o por monto? */}
                    <div className="space-y-2 rounded-lg border border-border/50 bg-muted/15 p-2 min-w-0">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5">
                        <span className="text-[11px] font-semibold text-muted-foreground shrink-0">
                          ¿Qué paga esta persona?
                        </span>
                        <div className="flex rounded-md bg-muted p-0.5 text-[10px] w-full sm:w-auto">
                          <button
                            type="button"
                            onClick={() => handleUpdatePersona(p.id, { modalidad: 'productos' })}
                            className={cn(
                              'flex flex-1 sm:flex-none items-center justify-center gap-1 px-2 py-0.5 rounded font-medium transition-all',
                              p.modalidad === 'productos'
                                ? 'bg-background text-foreground shadow-xs font-semibold'
                                : 'text-muted-foreground hover:text-foreground',
                            )}
                          >
                            <UtensilsCrossed className="h-3 w-3 shrink-0" />
                            <span>Por productos</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              handleUpdatePersona(p.id, {
                                modalidad: 'monto',
                                montoManual: subtotalProds > 0 ? subtotalProds.toString() : p.montoManual,
                              });
                            }}
                            className={cn(
                              'flex flex-1 sm:flex-none items-center justify-center gap-1 px-2 py-0.5 rounded font-medium transition-all',
                              p.modalidad === 'monto'
                                ? 'bg-background text-foreground shadow-xs font-semibold'
                                : 'text-muted-foreground hover:text-foreground',
                            )}
                          >
                            <CreditCard className="h-3 w-3 shrink-0" />
                            <span>Por monto fijo</span>
                          </button>
                        </div>
                      </div>

                      {/* Asignación de Productos */}
                      {p.modalidad === 'productos' ? (
                        <div className="space-y-1.5 pt-1 min-w-0">
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                            {items.map((item) => {
                              const cantAsignada = p.productosAsignados[item.producto.id] || 0;
                              const isSelected = cantAsignada > 0;
                              const asignadoOtros =
                                (productosAsignadosTotal[item.producto.id] || 0) - cantAsignada;

                              return (
                                <button
                                  key={item.producto.id}
                                  type="button"
                                  onClick={() => {
                                    const nuevaCant = isSelected ? 0 : item.cantidad;
                                    const updated = {
                                      ...p.productosAsignados,
                                      [item.producto.id]: nuevaCant,
                                    };
                                    handleUpdatePersona(p.id, { productosAsignados: updated });
                                  }}
                                  disabled={isPending}
                                  className={cn(
                                    'flex items-center justify-between gap-1.5 rounded-md border p-2 text-xs text-left transition-all min-w-0 w-full',
                                    isSelected
                                      ? 'border-primary bg-primary/10 text-foreground font-semibold shadow-2xs'
                                      : 'border-border/60 bg-background text-muted-foreground hover:bg-muted/50 hover:text-foreground',
                                  )}
                                >
                                  <div className="flex items-center gap-1.5 truncate min-w-0 flex-1">
                                    <span
                                      className={cn(
                                        'h-4 w-4 rounded border flex items-center justify-center shrink-0 text-[10px]',
                                        isSelected
                                          ? 'border-primary bg-primary text-primary-foreground font-bold'
                                          : 'border-muted-foreground/40 bg-background',
                                      )}
                                    >
                                      {isSelected ? '✓' : ''}
                                    </span>
                                    <span className="truncate min-w-0">
                                      {item.cantidad}× {item.producto.nombre}
                                    </span>
                                  </div>
                                  <div className="flex flex-col items-end shrink-0 pl-1">
                                    <span className="tabular-nums font-semibold text-foreground text-[11px]">
                                      {currencyFmt.format(item.subtotal)}
                                    </span>
                                    {asignadoOtros > 0 && !isSelected && (
                                      <span className="text-[9px] text-amber-600 dark:text-amber-400">
                                        (otro asignó)
                                      </span>
                                    )}
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      ) : (
                        /* Asignación por Monto libre */
                        <div className="flex items-center gap-2 pt-1 min-w-0">
                          <div className="relative flex-1 min-w-0">
                            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground font-semibold">
                              $
                            </span>
                            <Input
                              type="number"
                              step="any"
                              min="0"
                              value={p.montoManual}
                              onChange={(e) =>
                                handleUpdatePersona(p.id, { montoManual: e.target.value })
                              }
                              disabled={isPending}
                              placeholder="0.00"
                              className="h-8 pl-6 pr-2 text-xs tabular-nums text-right font-semibold w-full"
                            />
                          </div>
                          {puedeCompletar && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => handleAutoCompletarResto(p.id)}
                              disabled={isPending}
                              className="h-8 px-2 text-[10px] sm:text-[11px] text-primary hover:bg-primary/10 gap-1 shrink-0"
                            >
                              <Sparkles className="h-3 w-3 shrink-0" />
                              <span className="truncate">Resto ({currencyFmt.format(faltaParaEsta)})</span>
                            </Button>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Medio / Cuenta de cobro para esta persona */}
                    <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2 pt-1 min-w-0">
                      <Label className="text-[11px] text-muted-foreground shrink-0">
                        Cobrar con:
                      </Label>
                      <select
                        value={selectValue}
                        onChange={(e) => {
                          const val = e.target.value;
                          if (val === 'cc') {
                            handleUpdatePersona(p.id, {
                              medioPago: 'cuenta_corriente',
                              cuentaId: null,
                              tipo: 'jugador',
                            });
                          } else if (val.startsWith('cuenta_')) {
                            const cid = Number(val.replace('cuenta_', ''));
                            const c = cuentasActivas.find((acc) => acc.id === cid);
                            handleUpdatePersona(p.id, {
                              medioPago: c ? mapCuentaTipoToMedio(c.tipo) : 'otro',
                              cuentaId: cid,
                            });
                          } else {
                            const m = val.replace('medio_', '') as MedioPago;
                            handleUpdatePersona(p.id, {
                              medioPago: m,
                              cuentaId: null,
                            });
                          }
                        }}
                        disabled={isPending}
                        className="h-8 rounded-md border border-input bg-background px-2 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring w-full sm:flex-1 min-w-0 truncate"
                      >
                        {cuentasActivas.length > 0 && (
                          <optgroup label="Cuentas del club">
                            {cuentasActivas.map((c) => (
                              <option key={c.id} value={`cuenta_${c.id}`}>
                                {c.tipo === 'efectivo' || c.es_caja_fisica ? '💵 ' : c.tipo === 'billetera' ? '📱 ' : '🏦 '}
                                {c.nombre} ({c.tipo === 'billetera' ? 'MP / Digital' : c.tipo === 'banco' ? 'Banco' : c.tipo === 'efectivo' || c.es_caja_fisica ? 'Caja física' : 'Otro'})
                              </option>
                            ))}
                          </optgroup>
                        )}
                        <optgroup label="Otros medios">
                          <option value="cc">👤 Cuenta Corriente (Cliente)</option>
                          {MEDIOS_PAGO_LIST.filter((m) => m !== 'cuenta_corriente').map((m) => (
                            <option key={m} value={`medio_${m}`}>
                              {MEDIO_PAGO_LABEL[m]} (General)
                            </option>
                          ))}
                        </optgroup>
                      </select>
                    </div>

                    {p.medioPago === 'cuenta_corriente' && (!p.jugador || p.tipo !== 'jugador') && (
                      <p className="text-[10px] text-amber-600 dark:text-amber-400 font-medium">
                        * Seleccioná un jugador registrado arriba para debitar en Cuenta Corriente.
                      </p>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Panel de balance / Estado de cobertura */}
            <div className="rounded-lg border p-2.5 text-xs space-y-1.5 bg-muted/30 min-w-0">
              <div className="flex justify-between items-center text-muted-foreground min-w-0">
                <span>Total asignado:</span>
                <span className="font-semibold text-foreground tabular-nums shrink-0">
                  {currencyFmt.format(sumaPartes)} / {currencyFmt.format(total)}
                </span>
              </div>

              {totalExacto ? (
                <div className="flex items-center gap-1.5 font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-1 rounded min-w-0">
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">Total de la mesa cubierto exactamente</span>
                </div>
              ) : diferencia > 0 ? (
                <div className="flex items-center justify-between text-amber-700 dark:text-amber-300 bg-amber-500/10 border border-amber-500/20 px-2 py-1 rounded min-w-0">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">Falta asignar: <strong>{currencyFmt.format(diferencia)}</strong></span>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-1.5 text-destructive bg-destructive/10 border border-destructive/20 px-2 py-1 rounded min-w-0">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">La suma supera el total por {currencyFmt.format(Math.abs(diferencia))}</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── MODO PAGO ÚNICO (1 PERSONA PAGA TODO) ──────────────────── */}
        {!esPagoMixto && (
          <div className="space-y-3">
            <div className="space-y-1.5 min-w-0">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-semibold">Cuenta / Medio de cobro</Label>
                {selectedCuentaId && (
                  <span className="text-[11px] text-muted-foreground truncate ml-2">
                    Destino:{' '}
                    <strong className="text-foreground">
                      {cuentasActivas.find((c) => c.id === selectedCuentaId)?.nombre}
                    </strong>
                  </span>
                )}
              </div>

              {cuentasActivas.length > 0 ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                  {cuentasActivas.map((c) => {
                    const isSelected = selectedCuentaId === c.id && medio !== 'cuenta_corriente';
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => {
                          setSelectedCuentaId(c.id);
                          setMedio(mapCuentaTipoToMedio(c.tipo));
                        }}
                        disabled={isPending}
                        aria-pressed={isSelected}
                        className={cn(
                          'rounded-md border p-2 text-xs font-medium transition-all flex flex-col items-start gap-1 text-left min-w-0',
                          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
                          'disabled:cursor-not-allowed disabled:opacity-50',
                          isSelected
                            ? 'border-primary bg-primary text-primary-foreground font-semibold shadow-xs'
                            : 'border-border bg-background text-foreground hover:bg-muted',
                        )}
                      >
                        <span className="truncate w-full font-medium">{c.nombre}</span>
                        <span
                          className={cn(
                            'text-[9px] px-1 py-0.5 rounded font-normal uppercase tracking-wider',
                            isSelected
                              ? 'bg-primary-foreground/20 text-primary-foreground'
                              : 'bg-muted text-muted-foreground',
                          )}
                        >
                          {c.tipo === 'billetera' ? 'MP / Digital' : c.tipo === 'banco' ? 'Banco' : c.tipo === 'efectivo' || c.es_caja_fisica ? 'Caja física' : 'Otro'}
                        </span>
                      </button>
                    );
                  })}

                  <button
                    type="button"
                    onClick={() => {
                      setSelectedCuentaId(null);
                      setMedio('cuenta_corriente');
                      setSinglePersonaTipo('jugador');
                    }}
                    disabled={isPending}
                    aria-pressed={medio === 'cuenta_corriente'}
                    className={cn(
                      'rounded-md border p-2 text-xs font-medium transition-all flex flex-col items-start gap-1 text-left min-w-0',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
                      'disabled:cursor-not-allowed disabled:opacity-50',
                      medio === 'cuenta_corriente'
                        ? 'border-primary bg-primary text-primary-foreground font-semibold shadow-xs'
                        : 'border-border bg-background text-foreground hover:bg-muted',
                    )}
                  >
                    <span className="truncate w-full font-medium">Cuenta Corriente</span>
                    <span
                      className={cn(
                        'text-[9px] px-1 py-0.5 rounded font-normal uppercase tracking-wider',
                        medio === 'cuenta_corriente'
                          ? 'bg-primary-foreground/20 text-primary-foreground'
                          : 'bg-muted text-muted-foreground',
                      )}
                    >
                      Cliente
                    </span>
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                  {MEDIOS_PAGO_LIST.map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => {
                        setMedio(m);
                        if (m === 'cuenta_corriente') setSinglePersonaTipo('jugador');
                      }}
                      disabled={isPending}
                      aria-pressed={medio === m}
                      className={cn(
                        'rounded-md border px-2.5 py-2 text-xs font-medium transition-colors text-center truncate min-w-0',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
                        'disabled:cursor-not-allowed disabled:opacity-50',
                        medio === m
                          ? 'border-primary bg-primary text-primary-foreground font-semibold shadow-sm'
                          : 'border-border bg-background text-foreground hover:bg-muted',
                      )}
                    >
                      {MEDIO_PAGO_LABEL[m]}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Asignación de Cliente / Pagador para Pago Único */}
            <div className="rounded-lg border border-border/70 bg-card/40 p-2.5 space-y-2 min-w-0">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5">
                <Label className="text-xs font-semibold">Cliente / Pagador</Label>
                <div className="flex rounded-md bg-muted p-0.5 text-[11px] w-full sm:w-auto">
                  <button
                    type="button"
                    onClick={() => {
                      if (medio !== 'cuenta_corriente') {
                        setSinglePersonaTipo('general');
                        setSingleJugador(null);
                      }
                    }}
                    disabled={isPending || medio === 'cuenta_corriente'}
                    className={cn(
                      'flex-1 sm:flex-none px-2 py-0.5 rounded font-medium transition-all text-center',
                      singlePersonaTipo === 'general'
                        ? 'bg-background text-foreground shadow-xs font-semibold'
                        : 'text-muted-foreground hover:text-foreground',
                      medio === 'cuenta_corriente' && 'opacity-50 cursor-not-allowed',
                    )}
                  >
                    General
                  </button>
                  <button
                    type="button"
                    onClick={() => setSinglePersonaTipo('jugador')}
                    disabled={isPending}
                    className={cn(
                      'flex-1 sm:flex-none flex items-center justify-center gap-1 px-2 py-0.5 rounded font-medium transition-all',
                      singlePersonaTipo === 'jugador'
                        ? 'bg-background text-foreground shadow-xs font-semibold'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    <User className="h-3 w-3 shrink-0" />
                    Jugador
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (medio !== 'cuenta_corriente') {
                        setSinglePersonaTipo('invitado');
                        setSingleJugador(null);
                      }
                    }}
                    disabled={isPending || medio === 'cuenta_corriente'}
                    className={cn(
                      'flex-1 sm:flex-none flex items-center justify-center gap-1 px-2 py-0.5 rounded font-medium transition-all',
                      singlePersonaTipo === 'invitado'
                        ? 'bg-background text-foreground shadow-xs font-semibold'
                        : 'text-muted-foreground hover:text-foreground',
                      medio === 'cuenta_corriente' && 'opacity-50 cursor-not-allowed',
                    )}
                  >
                    <Ticket className="h-3 w-3 shrink-0" />
                    Invitado
                  </button>
                </div>
              </div>

              {singlePersonaTipo === 'jugador' && (
                <div className="space-y-1">
                  <JugadorSearchInput
                    jugador={singleJugador}
                    onSelect={(j) => setSingleJugador(j)}
                    jugadores={jugadores}
                    disabled={isPending}
                  />
                  {medio === 'cuenta_corriente' && !singleJugador && (
                    <p className="text-[10px] text-amber-600 dark:text-amber-400 font-medium">
                      * Cuenta Corriente requiere buscar y seleccionar un jugador registrado.
                    </p>
                  )}
                </div>
              )}

              {singlePersonaTipo === 'invitado' && (
                <div className="space-y-1">
                  <Input
                    type="text"
                    value={singleNombreInvitado}
                    onChange={(e) => setSingleNombreInvitado(e.target.value)}
                    disabled={isPending}
                    placeholder="Nombre del invitado (ej: Carlos, Amigo de Juan)…"
                    className="h-8 text-xs"
                  />
                </div>
              )}
            </div>
          </div>
        )}

        {/* Observaciones (opcional) */}
        <div className="space-y-1.5">
          <Label htmlFor="cerrar-venta-obs" className="text-xs">Observaciones (opcional)</Label>
          <Input
            id="cerrar-venta-obs"
            type="text"
            value={obs}
            onChange={(e) => setObs(e.target.value)}
            disabled={isPending}
            maxLength={500}
            placeholder="Notas internas de esta venta…"
            className="h-8 text-xs"
          />
        </div>

        {error && (
          <div
            role="alert"
            className="rounded-md border border-destructive/30 bg-destructive/10 p-2.5 text-xs text-destructive flex items-start gap-1.5"
          >
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        <DialogFooter className="flex-col-reverse sm:flex-row gap-2 pt-2">
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
            disabled={isPending}
            size="sm"
            className="w-full sm:w-auto"
          >
            Cancelar
          </Button>
          <Button
            type="submit"
            disabled={isPending || (esPagoMixto && !totalExacto)}
            size="sm"
            className="w-full sm:w-auto gap-1.5"
          >
            {isPending
              ? 'Procesando…'
              : mesa
                ? `Cobrar y cerrar ${mesa.nombre}`
                : `Cobrar ${currencyFmt.format(total)}`}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}
