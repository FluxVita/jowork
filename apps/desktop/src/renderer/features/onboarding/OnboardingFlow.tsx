import { useEffect } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useOnboarding } from './hooks/useOnboarding';
import { WelcomeStep } from './steps/WelcomeStep';
import { LoginStep } from './steps/LoginStep';
import { EngineStep } from './steps/EngineStep';
import { ConnectorsStep } from './steps/ConnectorsStep';
import { ProfileStep } from './steps/ProfileStep';
import { AhaMomentStep } from './steps/AhaMomentStep';
import { BackgroundGradient } from '../../components/ui/background-gradient';
import { ChevronLeft } from 'lucide-react';

const STEPS: Record<number, React.FC> = {
  1: WelcomeStep,
  2: LoginStep,
  3: EngineStep,
  4: ConnectorsStep,
  5: ProfileStep,
  6: AhaMomentStep,
};

export function OnboardingFlow() {
  const { t } = useTranslation('common');
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
    <div className="relative h-screen flex flex-col bg-background/80 text-foreground overflow-hidden">
      <BackgroundGradient />
      
      {/* Progress indicator */}
      <div className="flex justify-center gap-3 pt-12 pb-6 z-20" role="tablist" aria-label="Onboarding progress">
        {[1, 2, 3, 4, 5, 6].map((s) => (
          <button
            key={s}
            onClick={() => s <= step && goToStep(s)}
            disabled={s > step}
            aria-label={`Step ${s}`}
            aria-current={s === step ? 'step' : undefined}
            className={`h-2 rounded-full transition-all duration-500 relative overflow-hidden ${
              s <= step 
                ? 'w-12 bg-primary/20 cursor-pointer hover:bg-primary/30' 
                : 'w-6 bg-surface-2/40 cursor-default shadow-inner'
            }`}
          >
            {s <= step && (
               <div className={`absolute inset-0 bg-primary shadow-[0_0_12px_rgba(var(--primary),0.4)] ${s === step ? 'animate-shimmer' : ''}`} />
            )}
          </button>
        ))}
      </div>

      {/* Step content */}
      <div className="flex-1 flex items-center justify-center overflow-y-auto relative z-10 px-6 py-8">
        {step > 1 && (
          <button
            onClick={prevStep}
            className="absolute top-0 left-8 flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-primary transition-all duration-300 bg-surface-2/30 px-3 py-1.5 rounded-xl border border-border/20 backdrop-blur-md"
            aria-label={t('back')}
          >
            <ChevronLeft className="w-4 h-4" />
            {t('back')}
          </button>
        )}
        <div className="w-full max-w-5xl animate-in fade-in slide-in-from-bottom-6 duration-700">
          <StepComponent />
        </div>
      </div>
    </div>
  );
}
