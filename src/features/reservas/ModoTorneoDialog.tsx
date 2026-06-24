import { useState, useEffect } from 'react';
import { 
  Dialog, 
  DialogContent, 
  DialogDescription, 
  DialogHeader, 
  DialogTitle 
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { supabase } from '@/lib/supabase';
import { useCanchas } from '@/features/configuracion/hooks/useCanchas';
import { useAplicarModoTorneo, type ReservaAfectadaTorneo } from './hooks/useAplicarModoTorneo';
import { 
  AlertTriangle, 
  Check, 
  ExternalLink, 
  MessageCircle, 
  Calendar, 
  Clock, 
  Sparkles, 
  Building2, 
  ChevronRight, 
  Loader2 
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatearFechaAmigable } from './utils/fechaUtils';

interface ModoTorneoDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fechaActiva: string; // YYYY-MM-DD
}

interface ReservaAfectadaPreview {
  id: number;
  cancha_id: number;
  jugador_id: number | null;
  turno_fijo_id: number | null;
  hora_inicio: string;
  hora_fin: string;
  monto_pagado: number;
  jugador: { nombre: string; telefono: string | null } | null;
}

export function ModoTorneoDialog({ open, onOpenChange, fechaActiva }: ModoTorneoDialogProps) {
  const { data: canchas = [] } = useCanchas();
  const canchasActivas = canchas.filter((c) => c.activa);
  const aplicarModoTorneo = useAplicarModoTorneo();

  // Paso actual (1: Configuración, 2: Vista previa, 3: Notificaciones)
  const [step, setStep] = useState<1 | 2 | 3>(1);

  // Formulario
  const [nombreTorneo, setNombreTorneo] = useState('');
  const [fecha, setFecha] = useState(fechaActiva);
  const [horaInicio, setHoraInicio] = useState('14:00');
  const [horaFin, setHoraFin] = useState('20:00');
  const [selectedCanchas, setSelectedCanchas] = useState<number[]>([]);

  // Estados de carga e información de reservas afectadas
  const [previewReservas, setPreviewReservas] = useState<ReservaAfectadaPreview[]>([]);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Resultados tras ejecutar la cancelación bulk
  const [canceladasResult, setCanceladasResult] = useState<ReservaAfectadaTorneo[]>([]);
  const [notificadosIds, setNotificadosIds] = useState<Set<number>>(new Set());

  // Reset del diálogo al abrirse
  useEffect(() => {
    if (open) {
      setStep(1);
      setNombreTorneo('');
      setFecha(fechaActiva);
      setHoraInicio('14:00');
      setHoraFin('20:00');
      setSelectedCanchas(canchasActivas.map((c) => Number(c.id)));
      setPreviewReservas([]);
      setCanceladasResult([]);
      setNotificadosIds(new Set());
      setErrorMsg(null);
    }
  }, [open, fechaActiva, canchas]);

  // Selección/deselección de canchas
  const toggleCancha = (id: number) => {
    setSelectedCanchas((prev) =>
      prev.includes(id) ? prev.filter((cid) => cid !== id) : [...prev, id]
    );
  };

  const selectTodasCanchas = () => {
    setSelectedCanchas(canchasActivas.map((c) => Number(c.id)));
  };

  const deselectTodasCanchas = () => {
    setSelectedCanchas([]);
  };

  // Validar Paso 1 e ir a Paso 2 (Vista previa)
  const handleIrAPrevisualizacion = async () => {
    setErrorMsg(null);
    if (!nombreTorneo.trim()) {
      setErrorMsg('Ingresá el nombre del torneo.');
      return;
    }
    if (!fecha) {
      setErrorMsg('Seleccioná la fecha.');
      return;
    }
    if (!horaInicio || !horaFin) {
      setErrorMsg('Ingresá el rango de horarios.');
      return;
    }
    if (horaInicio >= horaFin) {
      setErrorMsg('La hora de inicio debe ser menor a la hora de fin.');
      return;
    }
    if (selectedCanchas.length === 0) {
      setErrorMsg('Seleccioná al menos una cancha.');
      return;
    }

    setIsLoadingPreview(true);
    try {
      // Buscar reservas que solapan en ese rango
      const { data, error } = await supabase
        .from('reservas')
        .select('*, jugador:jugador_id(nombre, telefono)')
        .eq('fecha', fecha)
        .in('cancha_id', selectedCanchas)
        .neq('estado', 'cancelada');

      if (error) throw error;

      // Filtrar solapamientos de horario en memoria
      const solapadas = (data ?? []).filter((r: any) => {
        const rInicio = r.hora_inicio.substring(0, 5);
        const rFin = r.hora_fin.substring(0, 5);
        return rInicio < horaFin && rFin > horaInicio;
      }) as unknown as ReservaAfectadaPreview[];

      setPreviewReservas(solapadas);
      setStep(2);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Error al buscar reservas afectadas.');
    } finally {
      setIsLoadingPreview(false);
    }
  };

  // Confirmar y aplicar Modo Torneo (Paso 2 -> Paso 3)
  const handleAplicarTorneo = async () => {
    setErrorMsg(null);
    try {
      const result = await aplicarModoTorneo.mutateAsync({
        fecha,
        hora_inicio: `${horaInicio}:00`,
        hora_fin: `${horaFin}:00`,
        cancha_ids: selectedCanchas,
        nombre_torneo: nombreTorneo,
      });

      setCanceladasResult(result);
      setStep(3);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Error al aplicar el modo torneo.');
    }
  };

  // Notificar por WhatsApp
  const handleNotificarWhatsApp = (r: ReservaAfectadaTorneo) => {
    const original = previewReservas.find((x) => x.id === Number(r.reserva_id));
    const cancha = canchas.find((c) => c.id === original?.cancha_id);
    const canchaNombre = cancha ? cancha.nombre : 'Cancha';
    const horarioStr = original ? `${original.hora_inicio.substring(0, 5)} a ${original.hora_fin.substring(0, 5)}` : '';

    const telefonoNormalizado = r.telefono ? r.telefono.replace(/[^0-9]/g, '') : '';
    
    const baseMsg = `Hola ${r.jugador_nombre}, lamentamos informarte que tu turno de pádel el día ${formatearFechaAmigable(fecha)} en la cancha *${canchaNombre}* (${horarioStr}) ha sido cancelado debido a la realización del *Torneo: ${nombreTorneo}*.\n\n`;
    
    const saldoMsg = r.monto_reembolsado > 0 
      ? `El importe señado de $${r.monto_reembolsado} fue devuelto como saldo a favor en tu cuenta corriente.\n\n`
      : '';

    const finMsg = `Disculpas por los inconvenientes. ¡Te esperamos para la próxima!`;

    const fullMsg = encodeURIComponent(baseMsg + saldoMsg + finMsg);
    
    // Abrir WhatsApp en nueva pestaña
    window.open(`https://wa.me/${telefonoNormalizado}?text=${fullMsg}`, '_blank');

    // Registrar como notificado localmente
    setNotificadosIds((prev) => {
      const next = new Set(prev);
      next.add(Number(r.reserva_id));
      return next;
    });
  };

  const handleCerrarClick = () => {
    const totalNotificables = canceladasResult.filter((r) => r.telefono).length;
    const totalNotificados = notificadosIds.size;

    if (totalNotificados < totalNotificables) {
      const confirmar = window.confirm(
        'Quedan jugadores con teléfono sin notificar. ¿Estás seguro de que querés cerrar el panel?'
      );
      if (!confirmar) return;
    }
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(val) => {
      // Evitar cerrar accidentalmente en el paso 3 si hay notificaciones pendientes
      if (step === 3) {
        handleCerrarClick();
      } else {
        onOpenChange(val);
      }
    }}>
      <DialogContent className={cn(
        "transition-all duration-300 bg-background border border-border shadow-xl rounded-lg",
        step === 1 ? "max-w-md" : "max-w-2xl"
      )}>
        <DialogHeader>
          <div className="flex items-center gap-2 mb-1">
            <div className="p-1 rounded-md bg-amber-500/10 text-amber-500">
              <Sparkles className="h-5 w-5 animate-pulse" />
            </div>
            <DialogTitle className="text-xl font-bold">Modo Torneo</DialogTitle>
          </div>
          <DialogDescription>
            Bloqueá la grilla de reservas y cancelá de forma masiva los turnos coincidentes.
          </DialogDescription>
        </DialogHeader>

        {/* Barra de progreso de Pasos */}
        <div className="flex items-center justify-between border-b border-border/60 pb-3 mb-4 text-xs font-semibold text-muted-foreground">
          <div className={cn("flex items-center gap-1.5", step === 1 && "text-amber-500")}>
            <span className={cn(
              "flex h-5 w-5 items-center justify-center rounded-full border text-[10px]",
              step === 1 ? "border-amber-500 bg-amber-500/10 text-amber-500" : "border-muted text-muted-foreground"
            )}>1</span>
            Configurar
          </div>
          <ChevronRight className="h-3 w-3 opacity-40" />
          <div className={cn("flex items-center gap-1.5", step === 2 && "text-amber-500")}>
            <span className={cn(
              "flex h-5 w-5 items-center justify-center rounded-full border text-[10px]",
              step === 2 ? "border-amber-500 bg-amber-500/10 text-amber-500" : "border-muted text-muted-foreground"
            )}>2</span>
            Afectados ({previewReservas.length})
          </div>
          <ChevronRight className="h-3 w-3 opacity-40" />
          <div className={cn("flex items-center gap-1.5", step === 3 && "text-amber-500")}>
            <span className={cn(
              "flex h-5 w-5 items-center justify-center rounded-full border text-[10px]",
              step === 3 ? "border-amber-500 bg-amber-500/10 text-amber-500" : "border-muted text-muted-foreground"
            )}>3</span>
            Notificaciones
          </div>
        </div>

        {/* Mensaje de error general */}
        {errorMsg && (
          <div className="flex items-start gap-2 rounded-md bg-destructive/10 border border-destructive/20 p-3 text-xs text-destructive">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* PASO 1: CONFIGURACIÓN */}
        {step === 1 && (
          <div className="space-y-4">
            {/* Nombre del torneo */}
            <div className="space-y-1.5">
              <Label htmlFor="torneo-nombre" className="text-sm font-semibold">Nombre del Torneo</Label>
              <Input
                id="torneo-nombre"
                placeholder="Ej. Torneo de Invierno Primera división"
                value={nombreTorneo}
                onChange={(e) => setNombreTorneo(e.target.value)}
                className="bg-muted/30 focus-visible:ring-amber-500"
              />
            </div>

            {/* Fecha y horarios */}
            <div className="grid grid-cols-3 gap-2.5">
              <div className="space-y-1.5 col-span-1">
                <Label htmlFor="torneo-fecha" className="text-xs font-semibold flex items-center gap-1">
                  <Calendar className="h-3 w-3" /> Fecha
                </Label>
                <Input
                  id="torneo-fecha"
                  type="date"
                  value={fecha}
                  onChange={(e) => setFecha(e.target.value)}
                  className="bg-muted/30 p-2 text-xs focus-visible:ring-amber-500"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="torneo-inicio" className="text-xs font-semibold flex items-center gap-1">
                  <Clock className="h-3 w-3" /> Inicio
                </Label>
                <Input
                  id="torneo-inicio"
                  type="time"
                  value={horaInicio}
                  onChange={(e) => setHoraInicio(e.target.value)}
                  className="bg-muted/30 p-2 text-xs focus-visible:ring-amber-500"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="torneo-fin" className="text-xs font-semibold flex items-center gap-1">
                  <Clock className="h-3 w-3" /> Fin
                </Label>
                <Input
                  id="torneo-fin"
                  type="time"
                  value={horaFin}
                  onChange={(e) => setHoraFin(e.target.value)}
                  className="bg-muted/30 p-2 text-xs focus-visible:ring-amber-500"
                />
              </div>
            </div>

            {/* Canchas */}
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <Label className="text-sm font-semibold flex items-center gap-1">
                  <Building2 className="h-4 w-4 text-muted-foreground" /> Canchas a Bloquear
                </Label>
                <div className="flex gap-2 text-[10px] text-amber-500 font-semibold cursor-pointer">
                  <span onClick={selectTodasCanchas} className="hover:underline">Todas</span>
                  <span className="text-muted-foreground/30">|</span>
                  <span onClick={deselectTodasCanchas} className="hover:underline">Ninguna</span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 bg-muted/20 border border-border/40 rounded-lg p-3 max-h-36 overflow-y-auto">
                {canchasActivas.map((c) => {
                  const isChecked = selectedCanchas.includes(Number(c.id));
                  return (
                    <label 
                      key={c.id} 
                      className={cn(
                        "flex items-center gap-2 p-2 rounded-md border text-xs cursor-pointer select-none transition-all",
                        isChecked 
                          ? "border-amber-500/30 bg-amber-500/5 font-semibold text-amber-600 dark:text-amber-400" 
                          : "border-border/50 bg-background/50 hover:bg-muted/40 text-muted-foreground"
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => toggleCancha(Number(c.id))}
                        className="rounded border-border text-amber-500 focus:ring-amber-500 h-3.5 w-3.5 cursor-pointer accent-amber-500"
                      />
                      {c.nombre}
                    </label>
                  );
                })}
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
              <Button 
                type="button" 
                onClick={handleIrAPrevisualizacion}
                disabled={isLoadingPreview}
                className="bg-amber-500 hover:bg-amber-600 text-white"
              >
                {isLoadingPreview ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Buscando...
                  </>
                ) : (
                  'Buscar reservas'
                )}
              </Button>
            </div>
          </div>
        )}

        {/* PASO 2: VISTA PREVIA Y CONFIRMACIÓN */}
        {step === 2 && (
          <div className="space-y-4">
            <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 p-3 text-xs text-amber-600 dark:text-amber-400">
              <div className="flex items-center gap-1.5 font-bold mb-1">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                Atención: Se aplicará la suspensión de reservas
              </div>
              Los horarios de las canchas seleccionadas se reservarán de forma exclusiva para el torneo <strong>{nombreTorneo}</strong>. Ningún jugador podrá registrar turnos sueltos en este período.
            </div>

            {/* Lista de reservas que se cancelarán */}
            <div className="space-y-2">
              <h3 className="text-sm font-semibold flex items-center justify-between">
                <span>Reservas a cancelar ({previewReservas.length})</span>
                <span className="text-xs text-muted-foreground font-normal">
                  Se generarán devoluciones en cuenta corriente si corresponde.
                </span>
              </h3>

              <div className="border border-border/80 rounded-lg overflow-hidden max-h-60 overflow-y-auto">
                {previewReservas.length === 0 ? (
                  <div className="p-8 text-center text-xs text-muted-foreground bg-muted/10">
                    No hay reservas activas en el rango seleccionado. Las canchas se bloquearán directamente.
                  </div>
                ) : (
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-muted border-b border-border/80 font-semibold text-muted-foreground">
                        <th className="p-2.5">Cancha</th>
                        <th className="p-2.5">Horario</th>
                        <th className="p-2.5">Titular</th>
                        <th className="p-2.5">Tipo</th>
                        <th className="p-2.5 text-right">Seña / Pago</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/60">
                      {previewReservas.map((r) => {
                        const c = canchas.find((c) => c.id === r.cancha_id);
                        const isFijo = !!r.turno_fijo_id;
                        return (
                          <tr key={r.id} className="hover:bg-muted/20">
                            <td className="p-2.5 font-medium">{c ? c.nombre : 'Cancha'}</td>
                            <td className="p-2.5 tabular-nums">
                              {r.hora_inicio.substring(0, 5)} a {r.hora_fin.substring(0, 5)}
                            </td>
                            <td className="p-2.5 font-medium">{r.jugador?.nombre ?? 'Invitado'}</td>
                            <td className="p-2.5">
                              {isFijo ? (
                                <span className="inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400">
                                  Fijo
                                </span>
                              ) : (
                                <span className="inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400">
                                  Suelto
                                </span>
                              )}
                            </td>
                            <td className="p-2.5 text-right font-semibold tabular-nums text-muted-foreground">
                              {isFijo ? (
                                <span className="text-muted-foreground/60 italic">No aplica</span>
                              ) : Number(r.monto_pagado) > 0 ? (
                                <span className="text-destructive font-medium">
                                  Reembolsar ${r.monto_pagado}
                                </span>
                              ) : (
                                '$0'
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </div>

            <div className="flex justify-between items-center pt-2">
              <Button type="button" variant="ghost" onClick={() => setStep(1)} disabled={aplicarModoTorneo.isPending}>
                Atrás
              </Button>
              <div className="flex gap-2">
                <Button 
                  type="button" 
                  variant="outline" 
                  onClick={() => onOpenChange(false)}
                  disabled={aplicarModoTorneo.isPending}
                >
                  Cancelar
                </Button>
                <Button 
                  type="button" 
                  onClick={handleAplicarTorneo}
                  disabled={aplicarModoTorneo.isPending}
                  className="bg-amber-500 hover:bg-amber-600 text-white font-semibold"
                >
                  {aplicarModoTorneo.isPending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Aplicando...
                    </>
                  ) : (
                    'Confirmar y bloquear'
                  )}
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* PASO 3: NOTIFICACIÓN DE JUGADORES */}
        {step === 3 && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 p-3 text-xs text-emerald-600 dark:text-emerald-400">
              <Check className="h-5 w-5 shrink-0" />
              <div>
                <p className="font-bold">¡Modo Torneo activado con éxito! ✅</p>
                <p>Las canchas seleccionadas fueron bloqueadas. Por favor, enviá los avisos de cancelación a los jugadores afectados.</p>
              </div>
            </div>

            {/* Listado de control de notificaciones */}
            <div className="space-y-2">
              <h3 className="text-sm font-semibold flex items-center justify-between">
                <span>Cola de Avisos por WhatsApp</span>
                <span className="text-xs text-muted-foreground font-normal">
                  {notificadosIds.size} de {canceladasResult.filter((r) => r.telefono).length} notificados
                </span>
              </h3>

              <div className="border border-border/80 rounded-lg divide-y divide-border/60 max-h-60 overflow-y-auto bg-muted/5">
                {canceladasResult.length === 0 ? (
                  <div className="p-8 text-center text-xs text-muted-foreground bg-muted/10">
                    No hubo reservas canceladas que requieran notificaciones. ¡Todo listo!
                  </div>
                ) : (
                  canceladasResult.map((r) => {
                    const original = previewReservas.find((x) => x.id === Number(r.reserva_id));
                    const cancha = canchas.find((c) => c.id === original?.cancha_id);
                    const isNotificado = notificadosIds.has(Number(r.reserva_id));
                    const hasPhone = !!r.telefono;

                    return (
                      <div key={r.reserva_id} className="flex items-center justify-between p-3 gap-4 text-xs hover:bg-muted/10">
                        <div className="space-y-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-foreground truncate">{r.jugador_nombre}</span>
                            {r.tipo_turno === 'fijo' ? (
                              <span className="inline-flex items-center rounded-full px-1 py-0.2 text-[9px] font-medium bg-blue-100 text-blue-800 dark:bg-blue-900/20 dark:text-blue-400">
                                Fijo
                              </span>
                            ) : (
                              <span className="inline-flex items-center rounded-full px-1 py-0.2 text-[9px] font-medium bg-emerald-100 text-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-400">
                                Suelto
                              </span>
                            )}
                          </div>
                          <p className="text-muted-foreground text-[11px]">
                            {cancha ? cancha.nombre : 'Cancha'} ·{' '}
                            {original ? `${original.hora_inicio.substring(0, 5)} - ${original.hora_fin.substring(0, 5)}` : ''}
                          </p>
                          {r.monto_reembolsado > 0 && (
                            <p className="text-emerald-600 dark:text-emerald-400 font-medium text-[10px]">
                              Reembolsado: ${r.monto_reembolsado} a Cuenta Corriente
                            </p>
                          )}
                        </div>

                        <div className="flex items-center gap-3 shrink-0">
                          {/* Estado Notificado */}
                          {!hasPhone ? (
                            <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium bg-amber-100 text-amber-800 dark:bg-amber-900/20 dark:text-amber-400">
                              Sin Teléfono
                            </span>
                          ) : isNotificado ? (
                            <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-400">
                              <Check className="h-3 w-3" /> Notificado
                            </span>
                          ) : (
                            <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium bg-red-100 text-red-800 dark:bg-red-900/20 dark:text-red-400 animate-pulse">
                              Pendiente
                            </span>
                          )}

                          {/* Acción WhatsApp */}
                          {hasPhone && (
                            <Button
                              size="sm"
                              variant={isNotificado ? "outline" : "default"}
                              onClick={() => handleNotificarWhatsApp(r)}
                              className={cn(
                                "h-8 px-2 text-xs font-semibold flex items-center gap-1",
                                !isNotificado && "bg-green-600 hover:bg-green-700 text-white"
                              )}
                            >
                              <MessageCircle className="h-3.5 w-3.5" />
                              WhatsApp
                              <ExternalLink className="h-3 w-3 opacity-60" />
                            </Button>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-border/40">
              <Button 
                type="button" 
                onClick={handleCerrarClick}
                className="bg-foreground hover:bg-foreground/95 text-background font-semibold px-6"
              >
                Cerrar Panel
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
