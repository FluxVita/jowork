import { useEffect, useState } from 'react';
import { RuleEditor, type NotificationRuleInfo } from './RuleEditor';

export function NotificationRules() {
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
    mention_me: 'Mention me',
    p0_issue: 'P0 issue',
    pr_review_requested: 'PR review requested',
    custom: 'Custom',
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <p className="text-sm text-text-secondary">
          Configure when and how you receive notifications from connectors.
        </p>
        <button
            onClick={() => {
              setEditingRule(null);
              setShowEditor(!showEditor);
            }}
            className="px-3 py-1 text-xs bg-accent text-white rounded-md hover:bg-accent/90 transition-colors"
          >
            {showEditor ? 'Cancel' : '+ New Rule'}
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
            <p>No notification rules configured.</p>
            <p className="text-xs mt-1">Create a rule to get notified about connector events.</p>
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
                      Edit
                    </button>
                    <button
                      onClick={() => handleDelete(rule.id)}
                      className="text-xs text-text-secondary hover:text-red-400 transition-colors"
                    >
                      Delete
                    </button>
                  </div>
                </div>

                <div className="flex items-center gap-3 text-[10px] text-text-secondary">
                  <span>Channels: {rule.channels.join(', ')}</span>
                  {rule.silentHours && (
                    <span>Silent: {rule.silentHours.start}-{rule.silentHours.end}</span>
                  )}
                  {rule.aiSummary && <span>AI Summary</span>}
                </div>
              </div>
            ))}
          </div>
        )}
    </div>
  );
}
