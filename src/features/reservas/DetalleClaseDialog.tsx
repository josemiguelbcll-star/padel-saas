import { useMemo, useState, type FormEvent } from 'react';
import {
  AlertTriangle,
  BookmarkCheck,
  Check,
  CheckCircle2,
  Clock,
  Divide,
  Plus,
  Receipt,
  ShoppingBag,
  Trash2,
  User,
  Users,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { useSession } from '@/features/auth/useSession';
import { supabase } from '@/lib/supabase';
import { mapPostgrestError } from '@/lib/dbErrors';
import { useQuery } from '@tanstack/react-query';
import type {
  Cancha,
  ClaseCobro,
  ClaseOcurrenciaAlumno,
  MedioPago,
  TipoRepartoConsumo,
} from '@/types/database';
import type { ClaseConProfesor } from '@/features/configuracion/hooks/useClases';
import { useTarifasClases } from '@/features/configuracion/hooks/useTarifasClases';
import { useBorrarCobroClase } from './hooks/useBorrarCobroClase';
import { useCobrarClase } from './hooks/useCobrarClase';
import { useClaseOcurrencia } from './hooks/useClaseOcurrencia';
import {
  useClaseAlumnos,
  useAgregarAlumnoClase,
  useActualizarAlumnoClase,
  useQuitarAlumnoClase,
  useGuardarComoAlumnosFijos,
} from './hooks/useClaseAlumnos';
import {
  useClaseConsumos,
  useCargarConsumoClase,
  useQuitarConsumoClase,
} from './hooks/useClaseConsumos';
import { useCobrarAlumnoClase } from './hooks/useCobrarAlumnoClase';
import { useLiberarClase } from './hooks/useLiberarClase';
import { CLASE_COBROS_QUERY_KEY_BASE } from './hooks/useCobrosDelDia';
import { JugadorAutocomplete, type JugadorSeleccionado } from './JugadorAutocomplete';
import { ConsumosCatalogo, type PersonaDestinoConsumo } from './ConsumosCatalogo';
import { formatearFechaAmigable } from './utils/fechaUtils';
import { formatearHora, sumarMinutos } from './utils/horaUtils';
import { resolverTarifa } from './utils/resolverTarifa';

// ─────────────────────────────────────────────────────────────────────
// Constantes y helpers locales
// ─────────────────────────────────────────────────────────────────────

const MEDIOS_PAGO_LIST: readonly MedioPago[] = [
  'efectivo',
  'transferencia',
  'mp',
  'tarjeta',
  'otro',
] as const;

const MEDIO_PAGO_LABEL: Record<MedioPago, string> = {
  efectivo: 'Efectivo',
  transferencia: 'Transferencia',
  mp: 'Mercado Pago',
  tarjeta: 'Tarjeta',
  otro: 'Otro',
  cuenta_corriente: 'Cuenta Corriente',
};

const currencyFmt = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function fmtMoney(n: number): string {
  return currencyFmt.format(n);
}

function fmtFechaHoraCorta(iso: string): string {
  return new Date(iso).toLocaleString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getAlumnoNombre(a: ClaseOcurrenciaAlumno): string {
  if (a.jugador?.nombre) return a.jugador.nombre;
  if (a.nombre_libre) return a.nombre_libre;
  return 'Alumno';
}

function getAlumnoInicial(nombre: string): string {
  const trimmed = nombre.trim();
  return trimmed ? trimmed.charAt(0).toUpperCase() : 'A';
}

// ─────────────────────────────────────────────────────────────────────
// Componente principal
// ─────────────────────────────────────────────────────────────────────

interface DetalleClaseDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clase: ClaseConProfesor | null;
  cancha: Cancha | null;
  fecha: string | null;
  pagosIniciales: ClaseCobro[];
  readOnly?: boolean;
}

export function DetalleClaseDialog({
  open,
  onOpenChange,
  clase,
  cancha,
  fecha,
  pagosIniciales,
  readOnly,
}: DetalleClaseDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[92vh] max-w-3xl flex-col gap-0 overflow-hidden p-0">
        {clase && cancha && fecha && (
          <DetalleClaseBody
            key={`${clase.id}-${fecha}`}
            clase={clase}
            cancha={cancha}
            fecha={fecha}
            pagosIniciales={pagosIniciales}
            onClose={() => onOpenChange(false)}
            readOnly={readOnly}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

interface DetalleClaseBodyProps {
  clase: ClaseConProfesor;
  cancha: Cancha;
  fecha: string;
  pagosIniciales: ClaseCobro[];
  onClose: () => void;
  readOnly?: boolean;
}

type TabSeccion = 'alumnos' | 'consumos' | 'pagos';

function DetalleClaseBody({
  clase,
  cancha,
  fecha,
  pagosIniciales,
  onClose,
  readOnly,
}: DetalleClaseBodyProps) {
  const { user } = useSession();
  const isAdmin = user?.rol === 'admin' && !readOnly;

  // Pestaña activa
  const [activeTab, setActiveTab] = useState<TabSeccion>('alumnos');

  // Hooks de datos
  const ocurrenciaQuery = useClaseOcurrencia(clase.id, fecha);
  const ocurrencia = ocurrenciaQuery.data;

  const alumnosQuery = useClaseAlumnos(clase.id, fecha);
  const consumosQuery = useClaseConsumos(clase.id, fecha);

  const agregarAlumno = useAgregarAlumnoClase();
  const actualizarAlumno = useActualizarAlumnoClase();
  const quitarAlumno = useQuitarAlumnoClase();
  const guardarFijos = useGuardarComoAlumnosFijos();

  const cargarConsumo = useCargarConsumoClase();
  const quitarConsumo = useQuitarConsumoClase();

  const cobrarAlumnoMutation = useCobrarAlumnoClase();
  const cobrarGeneralMutation = useCobrarClase();
  const borrarCobroMutation = useBorrarCobroClase();

  const tarifasClasesQuery = useTarifasClases();

  // Query sincronizada de pagos (aislada por clase_id para evitar solapamientos entre clases del mismo día)
  const { data: pagos = pagosIniciales } = useQuery<ClaseCobro[]>({
    queryKey: [CLASE_COBROS_QUERY_KEY_BASE, fecha, 'clase', clase.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('clase_cobros')
        .select('*')
        .eq('clase_id', clase.id)
        .eq('fecha', fecha)
        .order('fecha_hora', { ascending: true });
      if (error) throw new Error(mapPostgrestError(error));
      return (data ?? []) as ClaseCobro[];
    },
    initialData: pagosIniciales.filter((p) => p.clase_id === clase.id),
  });

  // Alumnos y Consumos en memoria
  const alumnos = useMemo(() => alumnosQuery.data ?? [], [alumnosQuery.data]);
  const consumos = useMemo(() => consumosQuery.data ?? [], [consumosQuery.data]);

  // Tarifas resueltas
  const cantidadAlumnosCalc = Math.max(1, alumnos.length || (ocurrencia?.cantidad_alumnos ?? 1));
  const tarifaResuelta = useMemo(
    () =>
      resolverTarifa({
        fecha,
        hora: clase.hora_inicio,
        tarifas: tarifasClasesQuery.data ?? [],
        cantidad_alumnos: cantidadAlumnosCalc,
      }),
    [fecha, clase.hora_inicio, tarifasClasesQuery.data, cantidadAlumnosCalc],
  );

  // Estados locales UI
  const [showAgregarAlumno, setShowAgregarAlumno] = useState(false);
  const [montoNuevoAlumno, setMontoNuevoAlumno] = useState<string>('');
  const [alumnoCobrandoId, setAlumnoCobrandoId] = useState<number | null>(null);
  const [montoCobroAlumno, setMontoCobroAlumno] = useState<string>('');
  const [medioCobroAlumno, setMedioCobroAlumno] = useState<MedioPago>('efectivo');
  const [obsCobroAlumno, setObsCobroAlumno] = useState<string>('');
  const [cobroError, setCobroError] = useState<string | null>(null);

  // Estado para cobro general
  const [showCobroGeneral, setShowCobroGeneral] = useState(false);
  const [montoCobroGeneral, setMontoCobroGeneral] = useState<string>('');
  const [medioCobroGeneral, setMedioCobroGeneral] = useState<MedioPago>('efectivo');
  const [obsCobroGeneral, setObsCobroGeneral] = useState<string>('');

  // Liberar clase solo por hoy
  const liberarClaseMutation = useLiberarClase();
  const [confirmingLiberar, setConfirmingLiberar] = useState(false);

  // Borrar cobro
  const [borrandoCobroId, setBorrandoCobroId] = useState<number | null>(null);

  // Feedback guardado fijos
  const [fijosGuardadosSuccess, setFijosGuardadosSuccess] = useState(false);

  // Edición directa de monto de alumno
  const [editandoMontoAlumnoId, setEditandoMontoAlumnoId] = useState<number | null>(null);
  const [valorMontoAlumnoEdit, setValorMontoAlumnoEdit] = useState<string>('');

  // Catálogo consumos toggle
  const [showCatalogoConsumos, setShowCatalogoConsumos] = useState(false);

  // ─────────────────────────────────────────────────────────────────
  // Cálculos Financieros
  // ─────────────────────────────────────────────────────────────────

  // Consumos divididos entre todos (grupales: sin clase_alumno_id)
  const consumosGrupales = useMemo(
    () => consumos.filter((c) => !c.clase_alumno_id),
    [consumos],
  );
  const totalConsumosGrupales = useMemo(
    () => consumosGrupales.reduce((sum, c) => sum + c.subtotal, 0),
    [consumosGrupales],
  );
  const parteConsumoGrupalPorAlumno = useMemo(
    () => (alumnos.length > 0 ? Math.ceil(totalConsumosGrupales / alumnos.length) : 0),
    [totalConsumosGrupales, alumnos.length],
  );

  // Mapeo detallado de cuentas por alumno
  const cuentasAlumnos = useMemo(() => {
    return alumnos.map((a) => {
      const nombre = getAlumnoNombre(a);
      const inicial = getAlumnoInicial(nombre);
      const montoClase = Number(a.monto_clase) || 0;

      // Consumos individuales asignados a este alumno
      const consumosPropios = consumos.filter((c) => c.clase_alumno_id === a.id);
      const totalConsumosPropios = consumosPropios.reduce((sum, c) => sum + c.subtotal, 0);

      // Consumo total asignado = propio + cuota del grupal
      const totalConsumoAsignado = totalConsumosPropios + parteConsumoGrupalPorAlumno;
      const totalAPagar = montoClase + totalConsumoAsignado;

      // Pagos registrados a nombre de este alumno
      const pagosAlumno = pagos.filter((p) => p.clase_alumno_id === a.id);
      const totalPagado = pagosAlumno.reduce((sum, p) => sum + p.monto, 0);
      const saldo = Math.max(0, totalAPagar - totalPagado);

      const estado: 'saldado' | 'debe' | 'parcial' =
        saldo === 0 ? 'saldado' : totalPagado > 0 ? 'parcial' : 'debe';

      return {
        alumno: a,
        nombre,
        inicial,
        montoClase,
        totalConsumosPropios,
        consumosPropios,
        totalConsumoAsignado,
        totalAPagar,
        pagosAlumno,
        totalPagado,
        saldo,
        estado,
      };
    });
  }, [alumnos, consumos, parteConsumoGrupalPorAlumno, pagos]);

  // Totales globales
  const totalClaseBase = useMemo(() => {
    if (alumnos.length > 0) {
      return alumnos.reduce((sum, a) => sum + (Number(a.monto_clase) || 0), 0);
    }
    return ocurrencia?.monto_total ?? (tarifaResuelta.monto || 0);
  }, [alumnos, ocurrencia, tarifaResuelta.monto]);

  const totalConsumosTotal = useMemo(
    () => consumos.reduce((sum, c) => sum + c.subtotal, 0),
    [consumos],
  );

  const totalGeneralClase = totalClaseBase + totalConsumosTotal;
  const totalCobradoGeneral = useMemo(
    () => pagos.reduce((sum, p) => sum + p.monto, 0),
    [pagos],
  );
  const saldoPendienteGeneral = Math.max(0, totalGeneralClase - totalCobradoGeneral);

  // Destinos para el selector de consumos
  const personasDestinoConsumo = useMemo<PersonaDestinoConsumo[]>(
    () =>
      alumnos.map((a) => ({
        id: a.id,
        nombre: getAlumnoNombre(a),
        subtitulo: a.jugador ? 'Jugador registrado' : 'Alumno libre',
      })),
    [alumnos],
  );

  // ─────────────────────────────────────────────────────────────────
  // Handlers
  // ─────────────────────────────────────────────────────────────────

  async function handleAgregarAlumno(val: JugadorSeleccionado | null) {
    if (!val) return;
    const manualMonto = parseFloat(montoNuevoAlumno);
    const esManual = !isNaN(manualMonto) && montoNuevoAlumno.trim() !== '';

    // Si no es manual, dividimos la tarifa equitativamente entre todos los alumnos (existentes + nuevo)
    const nuevoTotalAlumnos = alumnos.length + 1;
    const tarifaParaN = resolverTarifa({
      fecha,
      hora: clase.hora_inicio,
      tarifas: tarifasClasesQuery.data ?? [],
      cantidad_alumnos: nuevoTotalAlumnos,
    });

    const totalTarifa =
      ocurrencia?.monto_total ??
      (tarifaParaN.monto || tarifaResuelta.monto || (clase as any).precio || (alumnos.length > 0 ? alumnos.reduce((s, a) => s + (Number(a.monto_clase) || 0), 0) : 0));

    const cuotaEquitativa = nuevoTotalAlumnos > 0 ? Math.ceil(totalTarifa / nuevoTotalAlumnos) : 0;
    const montoNuevo = esManual ? manualMonto : cuotaEquitativa;

    try {
      await agregarAlumno.mutateAsync({
        clase_id: clase.id,
        fecha,
        jugador_id: val.kind === 'jugador' ? val.jugadorId : null,
        nombre_libre: val.kind === 'libre' ? val.nombre : null,
        monto_clase: montoNuevo,
      });

      // Si no fue manual y ya había alumnos, rebalanceamos a los existentes para que paguen la misma cuota
      if (!esManual && alumnos.length > 0) {
        await Promise.all(
          alumnos.map((a) =>
            actualizarAlumno.mutateAsync({
              id: a.id,
              clase_id: clase.id,
              fecha,
              monto_clase: cuotaEquitativa,
            }),
          ),
        );
      }

      setShowAgregarAlumno(false);
      setMontoNuevoAlumno('');
    } catch (err) {
      setCobroError(err instanceof Error ? err.message : 'Error al agregar alumno.');
    }
  }

  async function handleActualizarMontoAlumno(alumnoId: number) {
    const val = parseFloat(valorMontoAlumnoEdit);
    if (isNaN(val) || val < 0) return;
    try {
      await actualizarAlumno.mutateAsync({
        id: alumnoId,
        clase_id: clase.id,
        fecha,
        monto_clase: val,
      });
      setEditandoMontoAlumnoId(null);
    } catch (err) {
      setCobroError(err instanceof Error ? err.message : 'Error al actualizar monto.');
    }
  }

  async function handleRepartirTarifaEquitativa() {
    if (alumnos.length === 0) return;
    const tarifaActual = resolverTarifa({
      fecha,
      hora: clase.hora_inicio,
      tarifas: tarifasClasesQuery.data ?? [],
      cantidad_alumnos: alumnos.length,
    });
    const total =
      ocurrencia?.monto_total ??
      (tarifaActual.monto || tarifaResuelta.monto || (clase as any).precio || totalClaseBase);
    const cuotaPorAlumno = Math.ceil(total / alumnos.length);
    try {
      await Promise.all(
        alumnos.map((a) =>
          actualizarAlumno.mutateAsync({
            id: a.id,
            clase_id: clase.id,
            fecha,
            monto_clase: cuotaPorAlumno,
          }),
        ),
      );
    } catch (err) {
      setCobroError(err instanceof Error ? err.message : 'Error al dividir la tarifa.');
    }
  }

  async function handleGuardarComoFijos() {
    if (alumnos.length === 0) return;
    try {
      await guardarFijos.mutateAsync({ clase_id: clase.id, alumnos });
      setFijosGuardadosSuccess(true);
      setTimeout(() => setFijosGuardadosSuccess(false), 3000);
    } catch (err) {
      setCobroError(err instanceof Error ? err.message : 'Error al guardar alumnos fijos.');
    }
  }

  async function handleConfirmarCobroAlumno(e: FormEvent) {
    e.preventDefault();
    if (!alumnoCobrandoId) return;
    const monto = parseFloat(montoCobroAlumno);
    if (isNaN(monto) || monto <= 0) {
      setCobroError('Ingresá un monto válido mayor a 0.');
      return;
    }
    setCobroError(null);

    const cuenta = cuentasAlumnos.find((c) => c.alumno.id === alumnoCobrandoId);
    const montoClaseParte = cuenta ? Math.min(monto, cuenta.montoClase) : monto;
    const montoConsumoParte = Math.max(0, monto - montoClaseParte);

    try {
      await cobrarAlumnoMutation.mutateAsync({
        clase_alumno_id: alumnoCobrandoId,
        clase_id: clase.id,
        fecha,
        monto,
        monto_clase: montoClaseParte,
        monto_consumo: montoConsumoParte,
        medio_pago: medioCobroAlumno,
        observaciones: obsCobroAlumno.trim() || null,
      });
      setAlumnoCobrandoId(null);
      setMontoCobroAlumno('');
      setObsCobroAlumno('');
    } catch (err) {
      setCobroError(err instanceof Error ? err.message : 'No pudimos registrar el cobro.');
    }
  }

  async function handleConfirmarCobroGeneral(e: FormEvent) {
    e.preventDefault();
    const monto = parseFloat(montoCobroGeneral);
    if (isNaN(monto) || monto <= 0) {
      setCobroError('Ingresá un monto válido mayor a 0.');
      return;
    }
    setCobroError(null);
    try {
      await cobrarGeneralMutation.mutateAsync({
        clase_id: clase.id,
        fecha,
        monto,
        medio_pago: medioCobroGeneral,
        observaciones: obsCobroGeneral.trim() || null,
      });
      setShowCobroGeneral(false);
      setMontoCobroGeneral('');
      setObsCobroGeneral('');
    } catch (err) {
      setCobroError(err instanceof Error ? err.message : 'No pudimos registrar el cobro.');
    }
  }

  async function handleAgregarConsumo(
    productoId: number,
    _tipoReparto: TipoRepartoConsumo,
    personaId?: number | null,
  ) {
    setCobroError(null);
    try {
      await cargarConsumo.mutateAsync({
        clase_id: clase.id,
        fecha,
        producto_id: productoId,
        cantidad: 1,
        clase_alumno_id: personaId ?? null,
      });
    } catch (err) {
      setCobroError(err instanceof Error ? err.message : 'No pudimos cargar el consumo.');
    }
  }

  async function handleQuitarConsumo(consumoId: number) {
    setCobroError(null);
    try {
      await quitarConsumo.mutateAsync({
        consumo_id: consumoId,
        clase_id: clase.id,
        fecha,
      });
    } catch (err) {
      setCobroError(err instanceof Error ? err.message : 'No pudimos quitar el consumo.');
    }
  }

  async function handleBorrarPago(cobroId: number) {
    setCobroError(null);
    try {
      await borrarCobroMutation.mutateAsync({ cobroId, fecha });
      setBorrandoCobroId(null);
    } catch (err) {
      setCobroError(err instanceof Error ? err.message : 'No pudimos eliminar el pago.');
    }
  }

  const puedeLiberar = pagos.length === 0 && consumos.length === 0;
  const motivoNoLiberable =
    pagos.length > 0
      ? 'La clase tiene cobros registrados. Anulá los cobros antes de liberar.'
      : consumos.length > 0
      ? 'La clase tiene consumiciones registradas. Eliminalas antes de liberar.'
      : null;

  async function handleConfirmLiberar(): Promise<void> {
    setCobroError(null);
    try {
      await liberarClaseMutation.mutateAsync({
        claseId: clase.id,
        fecha,
      });
      onClose();
    } catch (err) {
      setCobroError(
        err instanceof Error ? err.message : 'No pudimos liberar la clase.'
      );
    }
  }

  const horaInicio = formatearHora(clase.hora_inicio);
  const horaFin = formatearHora(sumarMinutos(clase.hora_inicio, clase.duracion_min));
  const profesorNombre = clase.profesor?.nombre ?? 'Sin profesor';

  return (
    <>
      {/* ── HEADER STICKY ────────────────────────────────────────── */}
      <DialogHeader className="border-b border-border bg-card px-6 py-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <DialogTitle className="text-lg font-semibold tracking-tight text-foreground">
              {clase.nombre ? `${clase.nombre} · ` : ''}Clase de Pádel
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              {cancha.nombre} · {horaInicio}–{horaFin} ({clase.duracion_min} min) · Prof: {profesorNombre} · {formatearFechaAmigable(fecha)}
            </DialogDescription>
          </div>
          <div className="flex items-center gap-1.5">
            <span
              className={cn(
                'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium',
                saldoPendienteGeneral === 0 && totalGeneralClase > 0
                  ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                  : totalCobradoGeneral > 0
                  ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                  : 'bg-muted text-muted-foreground',
              )}
            >
              {saldoPendienteGeneral === 0 && totalGeneralClase > 0 ? (
                <>
                  <CheckCircle2 className="h-3 w-3" />
                  Saldada
                </>
              ) : totalCobradoGeneral > 0 ? (
                <>
                  <Clock className="h-3 w-3" />
                  Parcial
                </>
              ) : (
                'Sin cobrar'
              )}
            </span>
          </div>
        </div>

        {/* Resumen Métricas */}
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div className="rounded-md border border-border/60 bg-muted/30 p-2 text-xs">
            <span className="text-muted-foreground">Total Clase</span>
            <div className="text-sm font-semibold tabular-nums text-foreground">
              {fmtMoney(totalClaseBase)}
            </div>
          </div>
          <div className="rounded-md border border-border/60 bg-muted/30 p-2 text-xs">
            <span className="text-muted-foreground">Consumos</span>
            <div className="text-sm font-semibold tabular-nums text-foreground">
              {fmtMoney(totalConsumosTotal)}
            </div>
          </div>
          <div className="rounded-md border border-border/60 bg-muted/30 p-2 text-xs">
            <span className="text-muted-foreground">Total Cobrado</span>
            <div className="text-sm font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
              {fmtMoney(totalCobradoGeneral)}
            </div>
          </div>
          <div className="rounded-md border border-border/60 bg-muted/30 p-2 text-xs">
            <span className="text-muted-foreground">Saldo Pendiente</span>
            <div
              className={cn(
                'text-sm font-semibold tabular-nums',
                saldoPendienteGeneral > 0
                  ? 'text-amber-600 dark:text-amber-400'
                  : 'text-foreground',
              )}
            >
              {fmtMoney(saldoPendienteGeneral)}
            </div>
          </div>
        </div>

        {/* Pestañas de navegación */}
        <div className="mt-3 flex gap-1 border-t border-border/50 pt-2">
          <button
            type="button"
            onClick={() => setActiveTab('alumnos')}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
              activeTab === 'alumnos'
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            <Users className="h-3.5 w-3.5" />
            Alumnos ({alumnos.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('consumos')}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
              activeTab === 'consumos'
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            <ShoppingBag className="h-3.5 w-3.5" />
            Buffet / Consumos ({consumos.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('pagos')}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
              activeTab === 'pagos'
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            <Receipt className="h-3.5 w-3.5" />
            Historial Pagos ({pagos.length})
          </button>
        </div>
      </DialogHeader>

      {/* ── CUERPO CON SCROLL ────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto p-6 space-y-5">
        {cobroError && (
          <div
            role="alert"
            className="flex items-center justify-between rounded-md border border-destructive/30 bg-destructive/10 p-2.5 text-xs text-destructive"
          >
            <span>{cobroError}</span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setCobroError(null)}
              className="h-6 w-6 p-0 text-destructive hover:bg-destructive/20"
            >
              <X className="h-3 w-3" />
            </Button>
          </div>
        )}

        {/* ════════════════════════════════════════════════════════════ */}
        {/* PESTAÑA: ALUMNOS                                            */}
        {/* ════════════════════════════════════════════════════════════ */}
        {activeTab === 'alumnos' && (
          <div className="space-y-4">
            {/* Toolbar de Alumnos */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Alumnos de la clase ({alumnos.length})
                </span>
                {alumnos.length > 1 && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void handleRepartirTarifaEquitativa()}
                    disabled={actualizarAlumno.isPending || readOnly}
                    title="Divide el valor total de la clase equitativamente entre los alumnos"
                    className="h-7 text-xs"
                  >
                    <Divide className="mr-1 h-3 w-3" />
                    Dividir tarifa equitativamente
                  </Button>
                )}
              </div>

              <div className="flex items-center gap-2">
                {alumnos.length > 0 && !readOnly && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void handleGuardarComoFijos()}
                    disabled={guardarFijos.isPending}
                    title="Guarda estos alumnos para que se carguen automáticamente cada semana"
                    className="h-7 text-xs text-primary hover:text-primary"
                  >
                    {fijosGuardadosSuccess ? (
                      <>
                        <Check className="mr-1 h-3 w-3 text-emerald-500" />
                        ¡Guardados como fijos!
                      </>
                    ) : (
                      <>
                        <BookmarkCheck className="mr-1 h-3 w-3" />
                        Fijar para semanas futuras
                      </>
                    )}
                  </Button>
                )}

                {!showAgregarAlumno && !readOnly && (
                  <Button
                    type="button"
                    variant="default"
                    size="sm"
                    onClick={() => {
                      setShowAgregarAlumno(true);
                      setMontoNuevoAlumno(
                        tarifaResuelta.monto
                          ? Math.ceil(tarifaResuelta.monto / (alumnos.length + 1)).toString()
                          : '',
                      );
                    }}
                    className="h-7 text-xs"
                  >
                    <Plus className="mr-1 h-3 w-3" />
                    Agregar alumno
                  </Button>
                )}
              </div>
            </div>

            {/* Formulario Agregar Alumno */}
            {showAgregarAlumno && (
              <div className="space-y-3 rounded-lg border border-primary/30 bg-primary/5 p-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-primary">
                    Asignar alumno a la clase
                  </h4>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowAgregarAlumno(false)}
                    className="h-6 w-6 p-0"
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div className="sm:col-span-2 space-y-1">
                    <Label className="text-xs">Buscar jugador o escribir nombre</Label>
                    <JugadorAutocomplete
                      value={null}
                      onChange={(v) => void handleAgregarAlumno(v)}
                      permitirNombreLibre
                      autoFocus
                      placeholder="Buscar por nombre o teléfono…"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Monto clase ($)</Label>
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      value={montoNuevoAlumno}
                      onChange={(e) => setMontoNuevoAlumno(e.target.value)}
                      placeholder="0.00"
                      className="h-9"
                    />
                  </div>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Tip: Podés seleccionar un jugador registrado para llevar su historial o tipear un nombre libre de alumno ocasional.
                </p>
              </div>
            )}

            {/* Lista de Alumnos */}
            {cuentasAlumnos.length === 0 ? (
              <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-8 text-center">
                <Users className="h-8 w-8 text-muted-foreground/50 mb-2" />
                <p className="text-sm font-medium text-foreground">
                  No hay alumnos asignados a esta clase todavía
                </p>
                <p className="text-xs text-muted-foreground max-w-sm mt-1">
                  Agregá los alumnos que asistieron hoy. Podés asignarles montos individuales de clase y sumarle consumiciones del buffet.
                </p>
                {!readOnly && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setShowAgregarAlumno(true)}
                    className="mt-3 text-xs"
                  >
                    <Plus className="mr-1 h-3 w-3" />
                    Agregar primer alumno
                  </Button>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                {cuentasAlumnos.map((item) => {
                  const isCobrando = alumnoCobrandoId === item.alumno.id;
                  const isEditingMonto = editandoMontoAlumnoId === item.alumno.id;

                  return (
                    <div
                      key={item.alumno.id}
                      className={cn(
                        'rounded-lg border transition-all p-3',
                        item.estado === 'saldado'
                          ? 'border-emerald-500/30 bg-emerald-500/[0.02]'
                          : 'border-border bg-card shadow-sm',
                      )}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        {/* Avatar & Nombre */}
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div
                            className={cn(
                              'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
                              item.estado === 'saldado'
                                ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                                : 'bg-primary/10 text-primary',
                            )}
                          >
                            {item.estado === 'saldado' ? (
                              <Check className="h-4 w-4" />
                            ) : (
                              item.inicial
                            )}
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="text-sm font-medium text-foreground truncate">
                                {item.nombre}
                              </span>
                              {item.alumno.jugador_id ? (
                                <span className="rounded bg-muted px-1.5 py-0.2 text-[10px] text-muted-foreground">
                                  Registrado
                                </span>
                              ) : (
                                <span className="rounded bg-muted px-1.5 py-0.2 text-[10px] text-muted-foreground">
                                  Libre
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                              {/* Monto de clase editable */}
                              {isEditingMonto ? (
                                <div className="flex items-center gap-1">
                                  <span>Clase: $</span>
                                  <Input
                                    type="number"
                                    value={valorMontoAlumnoEdit}
                                    onChange={(e) => setValorMontoAlumnoEdit(e.target.value)}
                                    className="h-6 w-20 px-1 text-xs"
                                    autoFocus
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') void handleActualizarMontoAlumno(item.alumno.id);
                                      if (e.key === 'Escape') setEditandoMontoAlumnoId(null);
                                    }}
                                  />
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => void handleActualizarMontoAlumno(item.alumno.id)}
                                    className="h-6 px-1.5 text-xs text-primary"
                                  >
                                    OK
                                  </Button>
                                </div>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (readOnly) return;
                                    setEditandoMontoAlumnoId(item.alumno.id);
                                    setValorMontoAlumnoEdit(item.montoClase.toString());
                                  }}
                                  className="hover:underline hover:text-foreground cursor-pointer text-left"
                                  title="Click para cambiar monto de la clase"
                                >
                                  Clase: <span className="font-semibold text-foreground">{fmtMoney(item.montoClase)}</span>
                                </button>
                              )}

                              {item.totalConsumoAsignado > 0 && (
                                <>
                                  <span>·</span>
                                  <span title={`Individual: ${fmtMoney(item.totalConsumosPropios)} + Grupal: ${fmtMoney(parteConsumoGrupalPorAlumno)}`}>
                                    Consumos: <span className="font-semibold text-foreground">{fmtMoney(item.totalConsumoAsignado)}</span>
                                  </span>
                                </>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Totales & Acciones */}
                        <div className="flex items-center gap-3">
                          <div className="text-right">
                            <div className="text-xs text-muted-foreground">
                              Total: <span className="font-semibold tabular-nums text-foreground">{fmtMoney(item.totalAPagar)}</span>
                            </div>
                            <div className="text-xs">
                              {item.estado === 'saldado' ? (
                                <span className="font-medium text-emerald-600 dark:text-emerald-400">
                                  Saldado ({fmtMoney(item.totalPagado)})
                                </span>
                              ) : (
                                <span className="font-semibold tabular-nums text-amber-600 dark:text-amber-400">
                                  Debe {fmtMoney(item.saldo)}
                                </span>
                              )}
                            </div>
                          </div>

                          {!readOnly && (
                            <div className="flex items-center gap-1">
                              {item.saldo > 0 && !isCobrando && (
                                <Button
                                  type="button"
                                  variant="default"
                                  size="sm"
                                  onClick={() => {
                                    setAlumnoCobrandoId(item.alumno.id);
                                    setMontoCobroAlumno(item.saldo.toString());
                                    setObsCobroAlumno('');
                                  }}
                                  className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
                                >
                                  Cobrar
                                </Button>
                              )}

                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  void quitarAlumno.mutateAsync({
                                    id: item.alumno.id,
                                    clase_id: clase.id,
                                    fecha,
                                  });
                                }}
                                disabled={quitarAlumno.isPending}
                                className="h-7 w-7 p-0 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                                title="Quitar alumno de esta clase"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Mini-formulario de Cobro Inline */}
                      {isCobrando && (
                        <form
                          onSubmit={handleConfirmarCobroAlumno}
                          className="mt-3 space-y-3 rounded-md border border-emerald-500/30 bg-emerald-500/[0.04] p-3"
                        >
                          <div className="flex items-center justify-between">
                            <h5 className="text-xs font-semibold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
                              Cobrar a {item.nombre}
                            </h5>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => setAlumnoCobrandoId(null)}
                              className="h-6 w-6 p-0"
                            >
                              <X className="h-3.5 w-3.5" />
                            </Button>
                          </div>

                          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                            <div className="space-y-1">
                              <Label className="text-xs">Monto a cobrar ($)</Label>
                              <Input
                                type="number"
                                step="0.01"
                                min="0.01"
                                value={montoCobroAlumno}
                                onChange={(e) => setMontoCobroAlumno(e.target.value)}
                                className="h-8 text-xs font-medium"
                                required
                              />
                            </div>
                            <div className="space-y-1">
                              <Label className="text-xs">Medio de pago</Label>
                              <div className="flex flex-wrap gap-1">
                                {MEDIOS_PAGO_LIST.map((m) => (
                                  <button
                                    key={m}
                                    type="button"
                                    onClick={() => setMedioCobroAlumno(m)}
                                    className={cn(
                                      'rounded border px-2 py-0.5 text-[11px] font-medium transition-colors',
                                      medioCobroAlumno === m
                                        ? 'border-emerald-600 bg-emerald-600 text-white'
                                        : 'border-border bg-background text-foreground hover:bg-muted',
                                    )}
                                  >
                                    {MEDIO_PAGO_LABEL[m]}
                                  </button>
                                ))}
                              </div>
                            </div>
                          </div>

                          <div className="space-y-1">
                            <Label className="text-xs">Observaciones (opcional)</Label>
                            <Input
                              type="text"
                              value={obsCobroAlumno}
                              onChange={(e) => setObsCobroAlumno(e.target.value)}
                              placeholder="Ej: Pago clase + bebidas"
                              className="h-8 text-xs"
                            />
                          </div>

                          <div className="flex justify-end gap-2 pt-1">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => setAlumnoCobrandoId(null)}
                              className="h-7 text-xs"
                            >
                              Cancelar
                            </Button>
                            <Button
                              type="submit"
                              size="sm"
                              disabled={cobrarAlumnoMutation.isPending}
                              className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
                            >
                              {cobrarAlumnoMutation.isPending ? 'Registrando…' : 'Confirmar Cobro'}
                            </Button>
                          </div>
                        </form>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ════════════════════════════════════════════════════════════ */}
        {/* PESTAÑA: CONSUMOS (BUFFET)                                  */}
        {/* ════════════════════════════════════════════════════════════ */}
        {activeTab === 'consumos' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Consumos del Buffet / Bebidas
                </h4>
                <p className="text-xs text-muted-foreground">
                  Podés asignar productos a un alumno específico o al grupo entero.
                </p>
              </div>
              {!showCatalogoConsumos && !readOnly && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setShowCatalogoConsumos(true)}
                  className="h-7 text-xs"
                >
                  <Plus className="mr-1 h-3 w-3" />
                  Agregar consumo
                </Button>
              )}
            </div>

            {/* Mini Catálogo Embebido */}
            {showCatalogoConsumos && (
              <div className="space-y-2 rounded-lg border border-primary/30 bg-background p-3 shadow-sm">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Cargar producto al buffet de la clase
                  </h4>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowCatalogoConsumos(false)}
                    className="h-6 w-6 p-0"
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <ConsumosCatalogo
                  onAdd={handleAgregarConsumo}
                  disabled={cargarConsumo.isPending}
                  personas={personasDestinoConsumo}
                />
              </div>
            )}

            {/* Lista de Consumos Registrados */}
            {consumos.length === 0 ? (
              <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-8 text-center">
                <ShoppingBag className="h-8 w-8 text-muted-foreground/50 mb-2" />
                <p className="text-sm font-medium text-foreground">
                  No hay consumos registrados en esta clase
                </p>
                <p className="text-xs text-muted-foreground max-w-sm mt-1">
                  Agregá aguas, gaseosas o accesorios consumidos durante la clase para que se sumen a la cuenta individual o compartida.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="rounded-lg border border-border bg-card overflow-hidden">
                  <ul className="divide-y divide-border text-sm">
                    {consumos.map((c) => {
                      const alumnoAsignado = c.clase_alumno_id
                        ? cuentasAlumnos.find((a) => a.alumno.id === c.clase_alumno_id)
                        : null;

                      return (
                        <li key={c.id} className="flex items-center justify-between p-3">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <span className="font-semibold tabular-nums text-foreground">
                              {c.cantidad}×
                            </span>
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5 truncate">
                                <span className="font-medium text-foreground">{c.producto_nombre}</span>
                                {alumnoAsignado ? (
                                  <span className="inline-flex items-center gap-1 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                                    <User className="h-2.5 w-2.5" />
                                    Para: {alumnoAsignado.nombre}
                                  </span>
                                ) : (
                                  <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                                    Grupal (dividido entre todos)
                                  </span>
                                )}
                              </div>
                              <span className="text-[11px] text-muted-foreground">
                                {fmtMoney(c.precio_unitario)} c/u · {fmtFechaHoraCorta(c.fecha_hora)}
                              </span>
                            </div>
                          </div>

                          <div className="flex items-center gap-3">
                            <span className="font-semibold tabular-nums text-foreground">
                              {fmtMoney(c.subtotal)}
                            </span>
                            {!readOnly && (
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => void handleQuitarConsumo(c.id)}
                                disabled={quitarConsumo.isPending}
                                className="h-7 w-7 p-0 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                                title="Quitar consumo y reponer stock"
                              >
                                <X className="h-3.5 w-3.5" />
                              </Button>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                  <div className="flex items-center justify-between border-t border-border bg-muted/30 px-3 py-2 text-xs">
                    <span className="text-muted-foreground font-medium">Total Consumos Buffet:</span>
                    <span className="font-bold tabular-nums text-foreground">
                      {fmtMoney(totalConsumosTotal)}
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ════════════════════════════════════════════════════════════ */}
        {/* PESTAÑA: HISTORIAL DE PAGOS                                 */}
        {/* ════════════════════════════════════════════════════════════ */}
        {activeTab === 'pagos' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Cobros Realizados ({pagos.length})
                </h4>
                <p className="text-xs text-muted-foreground">
                  Historial de pagos recibidos para esta fecha.
                </p>
              </div>
              {!showCobroGeneral && !readOnly && saldoPendienteGeneral > 0 && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setShowCobroGeneral(true);
                    setMontoCobroGeneral(saldoPendienteGeneral.toString());
                  }}
                  className="h-7 text-xs"
                >
                  <Plus className="mr-1 h-3 w-3" />
                  Cobro global / sin asignar
                </Button>
              )}
            </div>

            {/* Cobro global form */}
            {showCobroGeneral && (
              <form
                onSubmit={handleConfirmarCobroGeneral}
                className="space-y-3 rounded-lg border border-primary/30 bg-primary/5 p-3"
              >
                <div className="flex items-center justify-between">
                  <h5 className="text-xs font-semibold uppercase tracking-wider text-primary">
                    Registrar cobro global a la clase
                  </h5>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowCobroGeneral(false)}
                    className="h-6 w-6 p-0"
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label className="text-xs">Monto ($)</Label>
                    <Input
                      type="number"
                      step="0.01"
                      min="0.01"
                      value={montoCobroGeneral}
                      onChange={(e) => setMontoCobroGeneral(e.target.value)}
                      className="h-8 text-xs"
                      required
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Medio de pago</Label>
                    <div className="flex flex-wrap gap-1">
                      {MEDIOS_PAGO_LIST.map((m) => (
                        <button
                          key={m}
                          type="button"
                          onClick={() => setMedioCobroGeneral(m)}
                          className={cn(
                            'rounded border px-2 py-0.5 text-[11px] font-medium transition-colors',
                            medioCobroGeneral === m
                              ? 'border-primary bg-primary text-primary-foreground'
                              : 'border-border bg-background text-foreground hover:bg-muted',
                          )}
                        >
                          {MEDIO_PAGO_LABEL[m]}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Observaciones</Label>
                  <Input
                    type="text"
                    value={obsCobroGeneral}
                    onChange={(e) => setObsCobroGeneral(e.target.value)}
                    placeholder="Ej: Pago total del grupo por profesor / sponsor"
                    className="h-8 text-xs"
                  />
                </div>
                <div className="flex justify-end gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setShowCobroGeneral(false)}
                    className="h-7 text-xs"
                  >
                    Cancelar
                  </Button>
                  <Button
                    type="submit"
                    size="sm"
                    disabled={cobrarGeneralMutation.isPending}
                    className="h-7 text-xs"
                  >
                    Confirmar Cobro
                  </Button>
                </div>
              </form>
            )}

            {/* Lista de Pagos */}
            {pagos.length === 0 ? (
              <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-8 text-center">
                <Receipt className="h-8 w-8 text-muted-foreground/50 mb-2" />
                <p className="text-sm font-medium text-foreground">Sin pagos registrados</p>
                <p className="text-xs text-muted-foreground max-w-sm mt-1">
                  Cuando cobres a cada alumno en la pestaña Alumnos o registres un pago global, aparecerán detallados aquí.
                </p>
              </div>
            ) : (
              <ul className="space-y-2">
                {pagos.map((p) => {
                  const alumno = p.clase_alumno_id
                    ? cuentasAlumnos.find((a) => a.alumno.id === p.clase_alumno_id)
                    : null;
                  const isConfirmingBorrar = borrandoCobroId === p.id;

                  if (isConfirmingBorrar) {
                    return (
                      <li
                        key={p.id}
                        className="space-y-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs"
                      >
                        <div className="flex items-start gap-2">
                          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                          <div>
                            <p className="font-semibold text-foreground">¿Anular este cobro?</p>
                            <p className="text-muted-foreground">
                              {fmtMoney(p.monto)} · {MEDIO_PAGO_LABEL[p.medio_pago]} · {fmtFechaHoraCorta(p.fecha_hora)}. Se actualizará la caja y el saldo del alumno.
                            </p>
                          </div>
                        </div>
                        <div className="flex justify-end gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => setBorrandoCobroId(null)}
                            className="h-7 text-xs"
                          >
                            No, mantener
                          </Button>
                          <Button
                            type="button"
                            variant="destructive"
                            size="sm"
                            onClick={() => void handleBorrarPago(p.id)}
                            disabled={borrarCobroMutation.isPending}
                            className="h-7 text-xs"
                          >
                            {borrarCobroMutation.isPending ? 'Borrando…' : 'Sí, anular pago'}
                          </Button>
                        </div>
                      </li>
                    );
                  }

                  return (
                    <li
                      key={p.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-card p-2.5 text-xs"
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-semibold tabular-nums text-foreground">
                          {fmtMoney(p.monto)}
                        </span>
                        <span className="text-muted-foreground">·</span>
                        <span className="rounded bg-muted px-1.5 py-0.5 font-medium text-foreground">
                          {MEDIO_PAGO_LABEL[p.medio_pago]}
                        </span>
                        {alumno && (
                          <>
                            <span className="text-muted-foreground">·</span>
                            <span className="inline-flex items-center gap-1 font-medium text-primary">
                              <User className="h-3 w-3" />
                              {alumno.nombre}
                            </span>
                          </>
                        )}
                        {!alumno && (
                          <>
                            <span className="text-muted-foreground">·</span>
                            <span className="italic text-muted-foreground">Cobro general</span>
                          </>
                        )}
                        <span className="text-muted-foreground">·</span>
                        <span className="text-muted-foreground">{fmtFechaHoraCorta(p.fecha_hora)}</span>
                        {p.observaciones && (
                          <span className="italic text-muted-foreground">({p.observaciones})</span>
                        )}
                      </div>

                      {isAdmin && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => setBorrandoCobroId(p.id)}
                          className="h-6 w-6 p-0 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                          title="Anular este pago"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </div>

      {/* ── FOOTER STICKY ────────────────────────────────────────── */}
      <div className="flex flex-col gap-3 border-t border-border bg-card px-6 py-3">
        {confirmingLiberar ? (
          <div className="space-y-3 rounded-md border border-destructive/40 bg-destructive/5 p-3">
            <div className="flex items-start gap-2">
              <AlertTriangle
                className="mt-0.5 h-4 w-4 shrink-0 text-destructive"
                aria-hidden="true"
              />
              <div className="space-y-1">
                <p className="text-sm font-medium text-foreground">
                  ¿Liberar esta clase solo por hoy?
                </p>
                <p className="text-xs text-muted-foreground">
                  La cancha quedará libre para que cualquiera pueda alquilar un turno en esta fecha y horario ({formatearFechaAmigable(fecha)}). La clase semanal recurrente seguirá activa normalmente las próximas semanas.
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setConfirmingLiberar(false)}
                disabled={liberarClaseMutation.isPending}
              >
                No, mantener
              </Button>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                onClick={() => {
                  void handleConfirmLiberar();
                }}
                disabled={liberarClaseMutation.isPending}
              >
                {liberarClaseMutation.isPending ? 'Liberando…' : 'Sí, liberar clase'}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <div className="text-xs text-muted-foreground">
                {alumnos.length} {alumnos.length === 1 ? 'alumno' : 'alumnos'} · {consumos.length}{' '}
                {consumos.length === 1 ? 'consumición' : 'consumiciones'}
              </div>
              {!readOnly && (
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setCobroError(null);
                      setConfirmingLiberar(true);
                    }}
                    disabled={!puedeLiberar || liberarClaseMutation.isPending}
                    title={motivoNoLiberable ?? undefined}
                    className="h-8 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive disabled:text-muted-foreground disabled:hover:bg-transparent"
                  >
                    Liberar clase (solo por hoy)
                  </Button>
                  {!puedeLiberar && motivoNoLiberable && (
                    <span className="text-[11px] text-muted-foreground">
                      {motivoNoLiberable}
                    </span>
                  )}
                </div>
              )}
            </div>
            <Button type="button" variant="outline" size="sm" onClick={onClose}>
              Cerrar
            </Button>
          </div>
        )}
      </div>
    </>
  );
}
