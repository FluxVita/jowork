import { useState } from 'react';
import { useTranslation } from 'react-i18next';

export interface NotificationRuleInfo {
  id: string;
  connectorId: string;
  condition: string;
  customFilter?: string;
  channels: string[];
  silentHours?: { start: string; end: string };
  aiSummary: boolean;
}

interface Props {
  initial?: NotificationRuleInfo;
  onSave: (rule: NotificationRuleInfo) => Promise<void>;
  onCancel: () => void;
}

export function RuleEditor({ initial, onSave, onCancel }: Props) {
  const { t } = useTranslation('notifications');
  const { t: tc } = useTranslation('common');

  const CONDITIONS = [
    { value: 'mention_me', label: t('condMentionMe') },
    { value: 'p0_issue', label: t('condP0Issue') },
    { value: 'pr_review_requested', label: t('condPrReview') },
    { value: 'custom', label: t('condCustom') },
  ];

  const CHANNELS = [
    { value: 'system', label: t('channelSystem') },
    { value: 'app', label: t('channelApp') },
    { value: 'feishu', label: t('channelFeishu') },
  ];

  const [connectorId, setConnectorId] = useState(initial?.connectorId ?? '');
  const [condition, setCondition] = useState(initial?.condition ?? 'mention_me');
  const [customFilter, setCustomFilter] = useState(initial?.customFilter ?? '');
  const [channels, setChannels] = useState<string[]>(initial?.channels ?? ['app']);
  const [silentEnabled, setSilentEnabled] = useState(!!initial?.silentHours);
  const [silentStart, setSilentStart] = useState(initial?.silentHours?.start ?? '22:00');
  const [silentEnd, setSilentEnd] = useState(initial?.silentHours?.end ?? '08:00');
  const [aiSummary, setAiSummary] = useState(initial?.aiSummary ?? false);
  const [saving, setSaving] = useState(false);

  const toggleChannel = (ch: string) => {
    setChannels((prev) =>
      prev.includes(ch) ? prev.filter((c) => c !== ch) : [...prev, ch],
    );
  };

  const handleSave = async () => {
    if (!connectorId.trim() || channels.length === 0) return;
    setSaving(true);
    try {
      await onSave({
        id: initial?.id ?? `rule_${Date.now()}`,
        connectorId: connectorId.trim(),
        condition,
        customFilter: condition === 'custom' ? customFilter : undefined,
        channels,
        silentHours: silentEnabled ? { start: silentStart, end: silentEnd } : undefined,
        aiSummary,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3 p-4 bg-surface-1 border border-border rounded-lg">
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-sm font-medium text-text-primary">
          {initial ? t('editRule') : t('newRuleTitle')}
        </h3>
        <button onClick={onCancel} className="text-xs text-text-secondary hover:text-text-primary">
          {tc('cancel')}
        </button>
      </div>

      <div>
        <label className="block text-xs text-text-secondary mb-1">{t('connectorId')}</label>
        <input
          type="text"
          value={connectorId}
          onChange={(e) => setConnectorId(e.target.value)}
          placeholder={t('connectorIdPlaceholder')}
          className="w-full px-2 py-1.5 text-sm bg-surface-2 border border-border rounded
            text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
        />
      </div>

      <div>
        <label className="block text-xs text-text-secondary mb-1">{t('condition')}</label>
        <select
          value={condition}
          onChange={(e) => setCondition(e.target.value)}
          className="w-full px-2 py-1.5 text-sm bg-surface-2 border border-border rounded
            text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
        >
          {CONDITIONS.map((c) => (
            <option key={c.value} value={c.value}>{c.label}</option>
          ))}
        </select>
      </div>

      {condition === 'custom' && (
        <div>
          <label className="block text-xs text-text-secondary mb-1">{t('customFilterExpression')}</label>
          <input
            type="text"
            value={customFilter}
            onChange={(e) => setCustomFilter(e.target.value)}
            placeholder={t('customFilterPlaceholder')}
            className="w-full px-2 py-1.5 text-sm bg-surface-2 border border-border rounded
              text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </div>
      )}

      <div>
        <label className="block text-xs text-text-secondary mb-1.5">{t('deliveryChannels')}</label>
        <div className="flex items-center gap-4">
          {CHANNELS.map((ch) => (
            <label key={ch.value} className="flex items-center gap-1.5 text-xs text-text-secondary">
              <input
                type="checkbox"
                checked={channels.includes(ch.value)}
                onChange={() => toggleChannel(ch.value)}
                className="accent-accent"
              />
              {ch.label}
            </label>
          ))}
        </div>
      </div>

      <div>
        <label className="flex items-center gap-2 text-xs text-text-secondary">
          <input
            type="checkbox"
            checked={silentEnabled}
            onChange={(e) => setSilentEnabled(e.target.checked)}
            className="accent-accent"
          />
          {t('silentHours')}
        </label>
        {silentEnabled && (
          <div className="flex items-center gap-2 mt-1.5 ml-5">
            <input
              type="time"
              value={silentStart}
              onChange={(e) => setSilentStart(e.target.value)}
              className="px-2 py-1 text-xs bg-surface-2 border border-border rounded text-text-primary"
            />
            <span className="text-xs text-text-secondary">{t('silentTo')}</span>
            <input
              type="time"
              value={silentEnd}
              onChange={(e) => setSilentEnd(e.target.value)}
              className="px-2 py-1 text-xs bg-surface-2 border border-border rounded text-text-primary"
            />
          </div>
        )}
      </div>

      <label className="flex items-center gap-2 text-xs text-text-secondary">
        <input
          type="checkbox"
          checked={aiSummary}
          onChange={(e) => setAiSummary(e.target.checked)}
          className="accent-accent"
        />
        {t('aiSummary')}
      </label>

      <div className="flex justify-end pt-1">
        <button
          onClick={handleSave}
          disabled={saving || !connectorId.trim() || channels.length === 0}
          className="px-4 py-1.5 text-sm bg-accent text-white rounded-md hover:bg-accent/90
            disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {saving ? tc('saving') : initial ? tc('update') : t('createRule')}
        </button>
      </div>
    </div>
  );
}
