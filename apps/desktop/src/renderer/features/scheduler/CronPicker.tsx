import { useState } from 'react';

interface Props {
  value: string;
  onChange: (cron: string) => void;
}

interface Preset {
  label: string;
  cron: string;
  description: string;
}

const PRESETS: Preset[] = [
  { label: 'Every hour', cron: '0 * * * *', description: 'At minute 0 of every hour' },
  { label: 'Every 2 hours', cron: '0 */2 * * *', description: 'At minute 0, every 2 hours' },
  { label: 'Every morning (9am)', cron: '0 9 * * *', description: 'Every day at 09:00' },
  { label: 'Every morning (10am)', cron: '0 10 * * *', description: 'Every day at 10:00' },
  { label: 'Every evening (6pm)', cron: '0 18 * * *', description: 'Every day at 18:00' },
  { label: 'Twice daily (9am, 6pm)', cron: '0 9,18 * * *', description: 'At 09:00 and 18:00' },
  { label: 'Weekdays at 9am', cron: '0 9 * * 1-5', description: 'Mon-Fri at 09:00' },
  { label: 'Every Monday 9am', cron: '0 9 * * 1', description: 'Every Monday at 09:00' },
  { label: 'Every 15 minutes', cron: '*/15 * * * *', description: 'At :00, :15, :30, :45' },
  { label: 'Every 30 minutes', cron: '*/30 * * * *', description: 'At :00 and :30' },
];

function describeCron(cron: string): string {
  const preset = PRESETS.find((p) => p.cron === cron);
  if (preset) return preset.description;

  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return 'Custom schedule';

  const [min, hour, dom, _mon, dow] = parts;
  const pieces: string[] = [];

  if (min !== '*' && min !== '0') pieces.push(`min ${min}`);
  if (hour !== '*') pieces.push(`hour ${hour}`);
  if (dom !== '*') pieces.push(`day ${dom}`);
  if (dow !== '*') {
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    pieces.push(dow.split(',').map((d) => days[Number(d)] ?? d).join(', '));
  }

  return pieces.length > 0 ? pieces.join(', ') : 'Every minute';
}

export function CronPicker({ value, onChange }: Props) {
  const [showPresets, setShowPresets] = useState(false);
  const activePreset = PRESETS.find((p) => p.cron === value);

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
          {showPresets ? 'Hide' : 'Presets'}
        </button>
      </div>

      <p className="text-[11px] text-text-secondary">
        {activePreset ? activePreset.description : describeCron(value)}
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
              <div className="font-medium">{preset.label}</div>
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
