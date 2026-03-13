import { useState } from 'react';
import { useTranslation } from 'react-i18next';

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

    if (min !== '*' && min !== '0') pieces.push(`min ${min}`);
    if (hour !== '*') pieces.push(`hour ${hour}`);
    if (dom !== '*') pieces.push(`day ${dom}`);
    if (dow !== '*') {
      const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      pieces.push(dow.split(',').map((d) => days[Number(d)] ?? d).join(', '));
    }

    return pieces.length > 0 ? pieces.join(', ') : t('everyMinute');
  };
}

export function CronPicker({ value, onChange }: Props) {
  const { t } = useTranslation('scheduler');
  const [showPresets, setShowPresets] = useState(false);
  const describeCron = useDescribeCron();

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="* * * * *"
          className="flex-1 px-3 py-2 text-sm font-mono bg-surface-2 border border-border rounded-md
            text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
        />
        <button
          onClick={() => setShowPresets(!showPresets)}
          className="px-3 py-2 text-xs bg-surface-2 border border-border rounded-md
            text-text-secondary hover:text-text-primary transition-colors shrink-0"
        >
          {showPresets ? t('hidePresets') : t('presets')}
        </button>
      </div>

      <p className="text-[11px] text-text-secondary">
        {describeCron(value)}
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
        <span>min</span>
        <span>hour</span>
        <span>day</span>
        <span>month</span>
        <span>dow</span>
      </div>
    </div>
  );
}
