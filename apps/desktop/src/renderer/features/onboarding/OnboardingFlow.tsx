import { useEffect } from 'react';
import { useOnboarding } from './hooks/useOnboarding';
import { WelcomeStep } from './steps/WelcomeStep';
import { LoginStep } from './steps/LoginStep';
import { EngineStep } from './steps/EngineStep';
import { ConnectorsStep } from './steps/ConnectorsStep';
import { ProfileStep } from './steps/ProfileStep';
import { AhaMomentStep } from './steps/AhaMomentStep';

const STEPS: Record<number, React.FC> = {
  1: WelcomeStep,
  2: LoginStep,
  3: EngineStep,
  4: ConnectorsStep,
  5: ProfileStep,
  6: AhaMomentStep,
};

export function OnboardingFlow() {
  const { step, loadState } = useOnboarding();

  useEffect(() => {
    loadState();
  }, [loadState]);

  const StepComponent = STEPS[step] ?? WelcomeStep;

  return (
    <div className="h-screen flex flex-col bg-background text-text-primary">
      {/* Progress indicator */}
      <div className="flex justify-center gap-2 pt-8 pb-4">
        {[1, 2, 3, 4, 5, 6].map((s) => (
          <div
            key={s}
            className={`h-1.5 rounded-full transition-all duration-300 ${
              s <= step ? 'w-8 bg-accent' : 'w-4 bg-surface-2'
            }`}
          />
        ))}
      </div>

      {/* Step content */}
      <div className="flex-1 flex items-center justify-center overflow-y-auto">
        <StepComponent />
      </div>
    </div>
  );
}
