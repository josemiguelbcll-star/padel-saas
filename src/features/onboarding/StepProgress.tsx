import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface WizardStep {
  number: number;
  label: string;
  /** true cuando la DB ya tiene datos correspondientes al paso. */
  done: boolean;
}

interface StepProgressProps {
  steps: WizardStep[];
  current: number;
  onStepClick: (n: number) => void;
}

/**
 * Indicador de progreso de tipo "stepper" navegable.
 *
 * Estados visuales por paso:
 *   - done       → círculo lleno con primary + tilde
 *   - current    → círculo con borde primary y ring sutil
 *   - pending    → círculo con borde border + número en muted
 *
 * Cualquier paso es clickeable: el wizard no fuerza orden estricto, el
 * usuario puede saltar adelante o volver atrás libremente.
 */
export function StepProgress({ steps, current, onStepClick }: StepProgressProps) {
  return (
    <ol className="flex items-center" role="list">
      {steps.map((step, idx) => {
        const isCurrent = step.number === current;
        const isLast = idx === steps.length - 1;
        return (
          <li
            key={step.number}
            className={cn(
              'flex items-center',
              !isLast && 'flex-1',
            )}
          >
            <button
              type="button"
              onClick={() => onStepClick(step.number)}
              aria-current={isCurrent ? 'step' : undefined}
              aria-label={
                `Paso ${step.number}: ${step.label}` +
                (step.done ? ' (completado)' : '')
              }
              className="flex items-center gap-3 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <span
                className={cn(
                  'flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-sm font-medium transition-colors',
                  step.done && 'border-primary bg-primary text-primary-foreground',
                  !step.done && isCurrent &&
                    'border-primary text-primary ring-2 ring-primary/20',
                  !step.done && !isCurrent &&
                    'border-border bg-background text-muted-foreground',
                )}
              >
                {step.done ? (
                  <Check className="h-4 w-4" aria-hidden="true" />
                ) : (
                  step.number
                )}
              </span>
              <span
                className={cn(
                  'hidden text-sm transition-colors sm:inline',
                  isCurrent
                    ? 'font-medium text-foreground'
                    : 'text-muted-foreground',
                )}
              >
                {step.label}
              </span>
            </button>
            {!isLast && (
              <span
                aria-hidden="true"
                className={cn(
                  'mx-3 h-px flex-1 transition-colors',
                  step.done ? 'bg-primary' : 'bg-border',
                )}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}
