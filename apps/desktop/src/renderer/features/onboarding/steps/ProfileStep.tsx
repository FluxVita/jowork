import { useTranslation } from 'react-i18next';
import { useOnboarding } from '../hooks/useOnboarding';

const ROLES = ['engineer', 'pm', 'designer', 'ops', 'founder', 'other'];
const ROLE_LABELS: Record<string, Record<string, string>> = {
  zh: { engineer: '工程师', pm: '产品经理', designer: '设计师', ops: '运营', founder: '创始人', other: '其他' },
  en: { engineer: 'Engineer', pm: 'Product Manager', designer: 'Designer', ops: 'Operations', founder: 'Founder', other: 'Other' },
};

export function ProfileStep() {
  const { t } = useTranslation('onboarding');
  const { nextStep, setProfile, profile, language } = useOnboarding();

  const labels = ROLE_LABELS[language] ?? ROLE_LABELS.en;

  return (
    <div className="flex flex-col items-center text-center px-8 py-12">
      <div className="text-5xl mb-6">👤</div>
      <h1 className="text-xl font-bold mb-2">{t('profileTitle')}</h1>
      <p className="text-text-secondary mb-8 max-w-md">{t('profileDescription')}</p>

      <div className="w-full max-w-sm space-y-4 mb-8 text-left">
        {/* Role */}
        <div>
          <label className="text-sm font-medium mb-1.5 block">
            {language === 'zh' ? '你的角色' : 'Your Role'}
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
                {labels[role]}
              </button>
            ))}
          </div>
        </div>

        {/* Communication style */}
        <div>
          <label className="text-sm font-medium mb-1.5 block">
            {language === 'zh' ? '沟通风格' : 'Communication Style'}
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
              {language === 'zh' ? '简洁' : 'Concise'}
            </button>
            <button
              onClick={() => setProfile({ communicationStyle: 'detailed' })}
              className={`px-3 py-1.5 rounded-md text-sm transition-colors ${
                profile.communicationStyle === 'detailed'
                  ? 'bg-accent text-white'
                  : 'bg-surface-2 text-text-secondary hover:bg-surface-2/80'
              }`}
            >
              {language === 'zh' ? '详细' : 'Detailed'}
            </button>
          </div>
        </div>

        {/* Custom rules */}
        <div>
          <label className="text-sm font-medium mb-1.5 block">
            {language === 'zh' ? 'AI 必须遵守的规则（可选）' : 'Rules for AI (optional)'}
          </label>
          <textarea
            value={profile.rules}
            onChange={(e) => setProfile({ rules: e.target.value })}
            rows={3}
            className="w-full bg-surface-2 border border-border rounded-md px-3 py-2 text-sm outline-none focus:border-accent resize-none"
            placeholder={language === 'zh' ? '例如：回答用中文，代码注释用英文' : 'e.g., Always respond in English'}
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
          {t('common:next', { ns: 'common' })}
        </button>
      </div>
    </div>
  );
}
