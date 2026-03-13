import { useEffect } from 'react';
import { useNavigate } from 'react-router';
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
  const { step, completed, loadState, prevStep, goToStep } = useOnboarding();
  const navigate = useNavigate();

  useEffect(() => {
    loadState();
  }, [loadState]);

  // Navigate to main app once onboarding is completed
  useEffect(() => {
    if (completed) {
      navigate('/', { replace: true });
    }
  }, [completed, navigate]);

  const StepComponent = STEPS[step] ?? WelcomeStep;

  return (
    <div className="h-screen flex flex-col bg-surface-0 text-text-primary">
      {/* Progress indicator */}
      <div className="flex justify-center gap-2 pt-8 pb-4" role="tablist" aria-label="Onboarding progress">
        {[1, 2, 3, 4, 5, 6].map((s) => (
          <button
            key={s}
            onClick={() => s <= step && goToStep(s)}
            disabled={s > step}
            aria-label={`Step ${s}`}
            aria-current={s === step ? 'step' : undefined}
            className={`h-1.5 rounded-full transition-all duration-300 ${
              s <= step ? 'w-8 bg-accent cursor-pointer hover:bg-accent/80' : 'w-4 bg-surface-2 cursor-default'
            }`}
          />
        ))}
      </div>

      {/* Step content */}
      <div className="flex-1 flex items-center justify-center overflow-y-auto relative">
        {step > 1 && (
          <button
            onClick={prevStep}
            className="absolute top-4 left-6 text-sm text-text-secondary hover:text-text-primary transition-colors"
            aria-label="Back"
          >
            ← Back
          </button>
        )}
        <StepComponent />
      </div>
    </div>
  );
}
