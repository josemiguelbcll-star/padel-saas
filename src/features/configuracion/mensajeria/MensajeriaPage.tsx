import { useState, useMemo } from 'react';
import { useSession } from '@/features/auth';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Send, Eye, RefreshCw } from 'lucide-react';

interface TemplateConfig {
  confirmacion: string;
  cancelacion: string;
  torneo: string;
}

const DEFAULT_TEMPLATES: TemplateConfig = {
  confirmacion: 'Hola {nombreCliente}, tu turno en {cancha} para el {fecha} a las {hora} está confirmado.',
  cancelacion: 'Hola {nombreCliente}, tu turno en {cancha} para el {fecha} a las {hora} fue cancelado.',
  torneo: 'Hola {nombreCliente}, te recordamos la invitación al torneo en {cancha} el {fecha} a las {hora}.',
};

const VARIABLES = [
  { placeholder: '{nombreCliente}', label: 'Nombre Cliente' },
  { placeholder: '{cancha}', label: 'Cancha' },
  { placeholder: '{fecha}', label: 'Fecha' },
  { placeholder: '{hora}', label: 'Hora' },
  { placeholder: '{montoTotal}', label: 'Monto Total' },
  { placeholder: '{montoSena}', label: 'Monto Seña' },
] as const;

export function MensajeriaPage() {
  const { club, updateClub } = useSession();
  const templatesCfg = (club?.config as any)?.whatsapp_templates ?? {};

  const [confirmacion, setConfirmacion] = useState<string>(
    templatesCfg.confirmacion || DEFAULT_TEMPLATES.confirmacion
  );
  const [cancelacion, setCancelacion] = useState<string>(
    templatesCfg.cancelacion || DEFAULT_TEMPLATES.cancelacion
  );
  const [torneo, setTorneo] = useState<string>(
    templatesCfg.torneo || DEFAULT_TEMPLATES.torneo
  );

  const [activeTab, setActiveTab] = useState<'confirmacion' | 'cancelacion' | 'torneo'>('confirmacion');
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Active template state mappings
  const activeText = {
    confirmacion,
    cancelacion,
    torneo,
  }[activeTab];

  const setActiveText = {
    confirmacion: setConfirmacion,
    cancelacion: setCancelacion,
    torneo: setTorneo,
  }[activeTab];

  const insertVariable = (placeholder: string) => {
    setActiveText((prev) => prev + placeholder);
  };

  const previewResolved = useMemo(() => {
    const dummy = {
      nombreCliente: 'Santiago Romero',
      cancha: 'Cancha 1 (Cristal)',
      fecha: 'jueves 25 de junio',
      hora: '19:30',
      montoTotal: '$16.000',
      montoSena: '$8.000',
    };
    let text = activeText;
    text = text.replace(/{nombreCliente}/g, dummy.nombreCliente);
    text = text.replace(/{cancha}/g, dummy.cancha);
    text = text.replace(/{fecha}/g, dummy.fecha);
    text = text.replace(/{hora}/g, dummy.hora);
    text = text.replace(/{montoTotal}/g, dummy.montoTotal);
    text = text.replace(/{montoSena}/g, dummy.montoSena);
    return text;
  }, [activeText]);

  async function handleSave() {
    if (!club) return;
    setSaving(true);
    setSuccess(false);
    setError(null);

    const updatedConfig = {
      ...(club.config ?? {}),
      whatsapp_templates: {
        confirmacion: confirmacion.trim(),
        cancelacion: cancelacion.trim(),
        torneo: torneo.trim(),
      },
    };

    try {
      const { error: err } = await supabase
        .from('clubes')
        .update({ config: updatedConfig })
        .eq('id', club.id);

      if (err) throw err;

      updateClub({ config: updatedConfig });
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al guardar las plantillas.');
    } finally {
      setSaving(false);
    }
  }

  function handleReset() {
    setConfirmacion(DEFAULT_TEMPLATES.confirmacion);
    setCancelacion(DEFAULT_TEMPLATES.cancelacion);
    setTorneo(DEFAULT_TEMPLATES.torneo);
  }

  return (
    <section className="space-y-6">
      <header className="space-y-1">
        <h2 className="text-lg font-semibold tracking-tight text-foreground">
          Plantillas de Mensajería
        </h2>
        <p className="text-sm text-muted-foreground">
          Personalizá las notificaciones automáticas y mensajes predefinidos que enviás a tus clientes a través de WhatsApp.
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left Column: Editor */}
        <div className="space-y-4 lg:col-span-2">
          {/* Tabs header */}
          <div className="flex border-b border-border">
            <button
              type="button"
              onClick={() => setActiveTab('confirmacion')}
              className={`-mb-px px-4 py-2.5 text-sm font-medium border-b-2 transition-all ${
                activeTab === 'confirmacion'
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              Confirmación de Reserva
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('cancelacion')}
              className={`-mb-px px-4 py-2.5 text-sm font-medium border-b-2 transition-all ${
                activeTab === 'cancelacion'
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              Cancelación de Turno
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('torneo')}
              className={`-mb-px px-4 py-2.5 text-sm font-medium border-b-2 transition-all ${
                activeTab === 'torneo'
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              Aviso / Torneo
            </button>
          </div>

          <div className="space-y-3">
            <Label htmlFor="template-text">Texto de la plantilla</Label>
            <textarea
              id="template-text"
              value={activeText}
              onChange={(e) => setActiveText(e.target.value)}
              rows={5}
              className="flex min-h-[120px] w-full rounded-xl border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              placeholder="Ingresá el texto de tu mensaje..."
            />
          </div>

          {/* Variables helper section */}
          <div className="space-y-2">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Variables disponibles (hacé click para insertar)
            </span>
            <div className="flex flex-wrap gap-2">
              {VARIABLES.map((v) => (
                <button
                  key={v.placeholder}
                  type="button"
                  onClick={() => insertVariable(v.placeholder)}
                  className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/55 hover:bg-muted px-2.5 py-1 text-xs font-medium text-foreground transition-colors"
                >
                  <span className="font-semibold text-primary">{v.placeholder}</span>
                  <span className="text-muted-foreground">({v.label})</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Right Column: Preview & Actions */}
        <div className="space-y-4">
          <div className="rounded-xl border border-border bg-card text-card-foreground shadow-sm overflow-hidden">
            <div className="border-b border-border bg-muted/30 px-4 py-3 flex items-center gap-2">
              <Eye className="h-4 w-4 text-muted-foreground" />
              <h3 className="text-sm font-semibold text-foreground">Vista Previa (Simulación)</h3>
            </div>
            <div className="p-4 space-y-4 bg-zinc-50 dark:bg-zinc-950 min-h-[160px] flex flex-col justify-between">
              {/* WhatsApp Balloon simulation */}
              <div className="self-start max-w-[85%] rounded-2-xl rounded-tr-2-xl bg-white dark:bg-zinc-900 border border-border/80 p-3 shadow-sm relative">
                <p className="text-xs text-foreground whitespace-pre-wrap leading-relaxed">
                  {previewResolved}
                </p>
                <span className="block mt-1 text-[10px] text-right text-muted-foreground tabular-nums">
                  18:45
                </span>
                {/* Speech bubble tail */}
                <div className="absolute top-0 -left-2 w-0 h-0 border-[8px] border-transparent border-t-white dark:border-t-zinc-900 border-r-white dark:border-r-zinc-900" />
              </div>

              <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/40 p-2.5 rounded-lg border border-border">
                <Send className="h-3.5 w-3.5 shrink-0 text-primary" />
                <span>
                  Al pulsar WhatsApp en reservas, se enviará este mensaje al número del titular.
                </span>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="w-full"
            >
              {saving ? 'Guardando...' : 'Guardar Plantillas'}
            </Button>
            
            <button
              type="button"
              onClick={handleReset}
              className="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground transition-all"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Restablecer valores predeterminados
            </button>

            {success && (
              <p className="text-center text-xs text-green-600 dark:text-green-400 font-medium">
                ¡Plantillas guardadas con éxito!
              </p>
            )}

            {error && (
              <p className="text-center text-xs text-destructive font-medium">
                {error}
              </p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
