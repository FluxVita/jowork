import { useTranslation } from 'react-i18next';
import { useOnboarding } from '../hooks/useOnboarding';

const ROLES = ['engineer', 'pm', 'designer', 'ops', 'founder', 'other'] as const;

const ROLE_KEYS: Record<string, string> = {
  engineer: 'roleEngineer',
  pm: 'rolePm',
  designer: 'roleDesigner',
  ops: 'roleOps',
  founder: 'roleFounder',
  other: 'roleOther',
};

export function ProfileStep() {
  const { t } = useTranslation('onboarding');
  const { t: tc } = useTranslation('common');
  const { nextStep, setProfile, profile } = useOnboarding();

  return (
    <div className="flex flex-col items-center text-center px-8 py-12">
      <div className="text-5xl mb-6">👤</div>
      <h1 className="text-xl font-bold mb-2">{t('profileTitle')}</h1>
      <p className="text-text-secondary mb-8 max-w-md">{t('profileDescription')}</p>

      <div className="w-full max-w-sm space-y-4 mb-8 text-left">
        {/* Role */}
        <div>
          <label className="text-sm font-medium mb-1.5 block">
            {t('yourRole')}
          </label>
          <div className="flex flex-wrap gap-2">
            {ROLES.map((role) => (
              <button
                key={role}
                onClick={() => setProfile({ role })}
                className={`px-3 py-1.5 rounded-md text-sm transition-colors ${
                  profile.role === role
                    ? 'bg-accent text-white'
                    : 'bg-surface-2 text-text-secondary hover:bg-surface-2/80'
                }`}
              >
                {t(ROLE_KEYS[role])}
              </button>
            ))}
          </div>
        </div>

        {/* Communication style */}
        <div>
          <label className="text-sm font-medium mb-1.5 block">
            {t('communicationStyle')}
          </label>
          <div className="flex gap-2">
            <button
              onClick={() => setProfile({ communicationStyle: 'concise' })}
              className={`px-3 py-1.5 rounded-md text-sm transition-colors ${
                profile.communicationStyle === 'concise'
                  ? 'bg-accent text-white'
                  : 'bg-surface-2 text-text-secondary hover:bg-surface-2/80'
              }`}
            >
              {t('concise')}
            </button>
            <button
              onClick={() => setProfile({ communicationStyle: 'detailed' })}
              className={`px-3 py-1.5 rounded-md text-sm transition-colors ${
                profile.communicationStyle === 'detailed'
                  ? 'bg-accent text-white'
                  : 'bg-surface-2 text-text-secondary hover:bg-surface-2/80'
              }`}
            >
              {t('detailed')}
            </button>
          </div>
        </div>

        {/* Custom rules */}
        <div>
          <label className="text-sm font-medium mb-1.5 block">
            {t('rulesLabel')}
          </label>
          <textarea
            value={profile.rules}
            onChange={(e) => setProfile({ rules: e.target.value })}
            rows={3}
            className="w-full bg-surface-2 border border-border rounded-md px-3 py-2 text-sm outline-none focus:border-accent resize-none"
            placeholder={t('rulesPlaceholder')}
          />
        </div>
      </div>

      <div className="flex gap-3">
        <button
          onClick={nextStep}
          className="text-sm text-text-secondary hover:text-text-primary transition-colors"
        >
          {t('skip')}
        </button>
        <button
          onClick={nextStep}
          className="px-8 py-3 rounded-lg bg-accent text-white font-medium hover:bg-accent/90 transition-colors"
        >
          {tc('next')}
        </button>
      </div>
    </div>
  );
}
