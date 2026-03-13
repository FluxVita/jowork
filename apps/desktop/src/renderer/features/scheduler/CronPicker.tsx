import { useState, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { parseNaturalLanguageCron } from '../../utils/nl-cron';

interface Props {
  value: string;
  onChange: (cron: string) => void;
}

interface Preset {
  labelKey: string;
  cron: string;
  descKey: string;
}

const PRESETS: Preset[] = [
  { labelKey: 'presetEveryHour', cron: '0 * * * *', descKey: 'descEveryHour' },
  { labelKey: 'presetEvery2Hours', cron: '0 */2 * * *', descKey: 'descEvery2Hours' },
  { labelKey: 'presetMorning9', cron: '0 9 * * *', descKey: 'descMorning9' },
  { labelKey: 'presetMorning10', cron: '0 10 * * *', descKey: 'descMorning10' },
  { labelKey: 'presetEvening6', cron: '0 18 * * *', descKey: 'descEvening6' },
  { labelKey: 'presetTwiceDaily', cron: '0 9,18 * * *', descKey: 'descTwiceDaily' },
  { labelKey: 'presetWeekdays9', cron: '0 9 * * 1-5', descKey: 'descWeekdays9' },
  { labelKey: 'presetMonday9', cron: '0 9 * * 1', descKey: 'descMonday9' },
  { labelKey: 'presetEvery15Min', cron: '*/15 * * * *', descKey: 'descEvery15Min' },
  { labelKey: 'presetEvery30Min', cron: '*/30 * * * *', descKey: 'descEvery30Min' },
];

function useDescribeCron() {
  const { t } = useTranslation('scheduler');

  return (cron: string): string => {
    const preset = PRESETS.find((p) => p.cron === cron);
    if (preset) return t(preset.descKey);

    const parts = cron.trim().split(/\s+/);
    if (parts.length !== 5) return t('customSchedule');

    const [min, hour, dom, _mon, dow] = parts;
    const pieces: string[] = [];

    if (min !== '*' && min !== '0') pieces.push(`${t('cronMin')} ${min}`);
    if (hour !== '*') pieces.push(`${t('cronHour')} ${hour}`);
    if (dom !== '*') pieces.push(`${t('cronDay')} ${dom}`);
    if (dow !== '*') {
      const dayKeys = ['daySun', 'dayMon', 'dayTue', 'dayWed', 'dayThu', 'dayFri', 'daySat'] as const;
      pieces.push(dow.split(',').map((d) => t(dayKeys[Number(d)] ?? d)).join(', '));
    }

    return pieces.length > 0 ? pieces.join(', ') : t('everyMinute');
  };
}

function isValidCron(cron: string): boolean {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  // Basic validation: each field matches cron token pattern
  const pattern = /^(\*|[0-9]+(-[0-9]+)?(\/[0-9]+)?)(,(\*|[0-9]+(-[0-9]+)?(\/[0-9]+)?))*$|^\*\/[0-9]+$/;
  return parts.every((p) => pattern.test(p));
}

export function CronPicker({ value, onChange }: Props) {
  const { t } = useTranslation('scheduler');
  const [showPresets, setShowPresets] = useState(false);
  const [nlInput, setNlInput] = useState('');
  const [nlResult, setNlResult] = useState<string | null>(null);
  const describeCron = useDescribeCron();
  const valid = useMemo(() => !value.trim() || isValidCron(value), [value]);

  const handleNlParse = useCallback(() => {
    const result = parseNaturalLanguageCron(nlInput);
    setNlResult(result);
    if (result) {
      onChange(result);
      setNlInput('');
      setNlResult(null);
    }
  }, [nlInput, onChange]);

  return (
    <div className="space-y-2">
      {/* Natural language input */}
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={nlInput}
          onChange={(e) => {
            setNlInput(e.target.value);
            // Auto-parse on typing
            const result = parseNaturalLanguageCron(e.target.value);
            setNlResult(result);
          }}
          onKeyDown={(e) => { if (e.key === 'Enter') handleNlParse(); }}
          placeholder={t('nlPlaceholder')}
          className="flex-1 px-3 py-2 text-sm bg-surface-2 border border-border rounded-md
            text-text-primary placeholder:text-text-secondary focus:outline-none focus:ring-1 focus:ring-accent"
        />
        {nlResult && (
          <button
            onClick={handleNlParse}
            className="px-3 py-2 text-xs bg-accent text-white rounded-md shrink-0"
          >
            {t('applyNl')}
          </button>
        )}
      </div>
      {nlInput && (
        <p className="text-[11px] text-text-secondary">
          {nlResult ? `→ ${nlResult}` : t('nlNoMatch')}
        </p>
      )}

      {/* Cron expression input */}
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="* * * * *"
          className={`flex-1 px-3 py-2 text-sm font-mono bg-surface-2 border rounded-md
            text-text-primary focus:outline-none focus:ring-1 ${
              valid ? 'border-border focus:ring-accent' : 'border-red-400 focus:ring-red-400'
            }`}
        />
        <button
          onClick={() => setShowPresets(!showPresets)}
          className="px-3 py-2 text-xs bg-surface-2 border border-border rounded-md
            text-text-secondary hover:text-text-primary transition-colors shrink-0"
        >
          {showPresets ? t('hidePresets') : t('presets')}
        </button>
      </div>

      <p className={`text-[11px] ${valid ? 'text-text-secondary' : 'text-red-400'}`}>
        {!valid && value.trim() ? t('invalidCron') : describeCron(value)}
      </p>

      {showPresets && (
        <div className="grid grid-cols-2 gap-1.5 p-2 bg-surface-1 border border-border rounded-md">
          {PRESETS.map((preset) => (
            <button
              key={preset.cron}
              onClick={() => {
                onChange(preset.cron);
                setShowPresets(false);
              }}
              className={`text-left px-2 py-1.5 text-xs rounded transition-colors ${
                value === preset.cron
                  ? 'bg-accent/10 text-accent border border-accent/30'
                  : 'hover:bg-surface-2 text-text-secondary hover:text-text-primary'
              }`}
            >
              <div className="font-medium">{t(preset.labelKey)}</div>
              <code className="text-[10px] opacity-60">{preset.cron}</code>
            </button>
          ))}
        </div>
      )}

      <div className="flex gap-3 text-[10px] text-text-secondary font-mono">
        <span>{t('cronMin')}</span>
        <span>{t('cronHour')}</span>
        <span>{t('cronDay')}</span>
        <span>{t('cronMonth')}</span>
        <span>{t('cronDow')}</span>
      </div>
    </div>
  );
}
