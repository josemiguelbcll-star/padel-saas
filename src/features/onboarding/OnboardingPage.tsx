import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useSession } from '@/features/auth';
import { useCanchas } from '@/features/configuracion/hooks/useCanchas';
import { useHorariosClub } from '@/features/configuracion/hooks/useHorariosClub';
import { useTarifas } from '@/features/configuracion/hooks/useTarifas';
import { StepProgress, type WizardStep } from './StepProgress';
import { StepCanchas } from './StepCanchas';
import { StepHorarios } from './StepHorarios';
import { StepTarifas } from './StepTarifas';

type StepNumber = 1 | 2 | 3;

function clampStep(n: number): StepNumber {
  if (n <= 1) return 1;
  if (n >= 3) return 3;
  return 2;
}

/**
 * Wizard de configuración inicial del club.
 *
 * - Sólo accesible para usuarios con rol 'admin'. Un vendedor que llegue
 *   por URL es redirigido a /.
 * - El estado de paso es local (useState); un refresh vuelve al paso 1
 *   pero los datos persisten en la DB.
 * - Los datos se guardan dentro de cada paso (los formularios embebidos
 *   son los mismos de Configuración). Los botones del footer sólo
 *   navegan entre pasos, no "submitean" nada.
 */
export function OnboardingPage() {
  const { user } = useSession();
  const navigate = useNavigate();
  const [step, setStep] = useState<StepNumber>(1);

  const canchasQuery = useCanchas();
  const horariosQuery = useHorariosClub();
  const tarifasQuery = useTarifas();

  // Vendedores no entran al wizard. Lo gateamos acá además de en el item
  // del sidebar para defender la URL directa.
  if (user && user.rol !== 'admin') {
    return <Navigate to="/app" replace />;
  }

  const canchasDone = (canchasQuery.data?.length ?? 0) > 0;
  const horariosDone =
    (horariosQuery.data?.hora_apertura ?? null) !== null &&
    (horariosQuery.data?.hora_cierre ?? null) !== null;
  const tarifasDone = (tarifasQuery.data?.length ?? 0) > 0;

  const steps: WizardStep[] = [
    { number: 1, label: 'Canchas', done: canchasDone },
    { number: 2, label: 'Horarios', done: horariosDone },
    { number: 3, label: 'Tarifas', done: tarifasDone },
  ];

  function goToStep(n: number): void {
    setStep(clampStep(n));
  }

  function handleAdvance(): void {
    if (step < 3) {
      setStep(clampStep(step + 1));
    } else {
      navigate('/app');
    }
  }

  const isLastStep = step === 3;

  return (
    <div className="mx-auto max-w-4xl space-y-8 py-6 md:py-8">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold leading-tight tracking-tight text-foreground">
          Configuración inicial del club
        </h1>
        <p className="text-sm text-muted-foreground">
          Configurá lo básico para empezar a operar. Podés saltear cualquier
          paso y completarlo después desde Configuración.
        </p>
      </header>

      <StepProgress steps={steps} current={step} onStepClick={goToStep} />

      <div className="border-t border-border pt-6">
        {step === 1 && <StepCanchas />}
        {step === 2 && <StepHorarios />}
        {step === 3 && <StepTarifas />}
      </div>

      <footer className="flex flex-col-reverse items-stretch gap-2 border-t border-border pt-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex">
          {step > 1 ? (
            <Button
              type="button"
              variant="ghost"
              onClick={() => setStep(clampStep(step - 1))}
            >
              ← Volver
            </Button>
          ) : (
            <span />
          )}
        </div>
        <div className="flex flex-col-reverse gap-2 sm:flex-row">
          <Button type="button" variant="outline" onClick={handleAdvance}>
            Configurar después
          </Button>
          <Button type="button" onClick={handleAdvance}>
            {isLastStep ? 'Finalizar' : 'Continuar →'}
          </Button>
        </div>
      </footer>
    </div>
  );
}
