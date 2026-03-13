import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RuleEditor, type NotificationRuleInfo } from './RuleEditor';

export function NotificationRules() {
  const { t } = useTranslation('notifications');
  const { t: tc } = useTranslation('common');
  const [rules, setRules] = useState<NotificationRuleInfo[]>([]);
  const [editingRule, setEditingRule] = useState<NotificationRuleInfo | null>(null);
  const [showEditor, setShowEditor] = useState(false);

  const loadRules = async () => {
    try {
      const data = await window.jowork.notifRules.list();
      setRules(data as NotificationRuleInfo[]);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    loadRules();
  }, []);

  const handleSave = async (rule: NotificationRuleInfo) => {
    if (editingRule) {
      await window.jowork.notifRules.update(rule.id, rule);
    } else {
      await window.jowork.notifRules.add(rule);
    }
    setShowEditor(false);
    setEditingRule(null);
    await loadRules();
  };

  const handleDelete = async (id: string) => {
    await window.jowork.notifRules.delete(id);
    await loadRules();
  };

  const conditionLabel: Record<string, string> = {
    mention_me: t('condMentionMe'),
    p0_issue: t('condP0Issue'),
    pr_review_requested: t('condPrReview'),
    custom: t('condCustom'),
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <p className="text-sm text-text-secondary">
          {t('rulesDescription')}
        </p>
        <button
            onClick={() => {
              setEditingRule(null);
              setShowEditor(!showEditor);
            }}
            className="px-3 py-1 text-xs bg-accent text-white rounded-md hover:bg-accent/90 transition-colors"
          >
            {showEditor ? tc('cancel') : t('newRule')}
          </button>
      </div>

      {showEditor && (
          <div className="mb-4">
            <RuleEditor
              initial={editingRule ?? undefined}
              onSave={handleSave}
              onCancel={() => {
                setShowEditor(false);
                setEditingRule(null);
              }}
            />
          </div>
        )}

        {rules.length === 0 && !showEditor ? (
          <div className="text-center py-12 text-text-secondary text-sm">
            <p>{t('noRules')}</p>
            <p className="text-xs mt-1">{t('noRulesHint')}</p>
          </div>
        ) : (
          <div className="space-y-2">
            {rules.map((rule) => (
              <div
                key={rule.id}
                className="p-3 bg-surface-2 border border-border rounded-lg"
              >
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-text-primary">
                      {rule.connectorId}
                    </span>
                    <span className="text-[10px] px-1.5 py-0.5 bg-accent/10 text-accent rounded">
                      {conditionLabel[rule.condition] ?? rule.condition}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        setEditingRule(rule);
                        setShowEditor(true);
                      }}
                      className="text-xs text-text-secondary hover:text-accent transition-colors"
                    >
                      {tc('edit')}
                    </button>
                    <button
                      onClick={() => handleDelete(rule.id)}
                      className="text-xs text-text-secondary hover:text-red-400 transition-colors"
                    >
                      {tc('delete')}
                    </button>
                  </div>
                </div>

                <div className="flex items-center gap-3 text-[10px] text-text-secondary">
                  <span>{t('channels')}: {rule.channels.join(', ')}</span>
                  {rule.silentHours && (
                    <span>{t('silent')}: {rule.silentHours.start}-{rule.silentHours.end}</span>
                  )}
                  {rule.aiSummary && <span>{t('aiSummary')}</span>}
                </div>
              </div>
            ))}
          </div>
        )}
    </div>
  );
}
