import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useOnboarding } from '../hooks/useOnboarding';

const SUGGESTED_QUESTION_KEYS: Record<string, string> = {
  github: 'qGithub',
  feishu: 'qFeishu',
  'local-folder': 'qLocalFolder',
  figma: 'qFigma',
  gitlab: 'qGitlab',
};

export function AhaMomentStep() {
  const { t } = useTranslation('onboarding');
  const { t: tc } = useTranslation('common');
  const { t: tChat } = useTranslation('chat');
  const { completeOnboarding, connectedDuringOnboarding } = useOnboarding();
  const [selectedQuestion, setSelectedQuestion] = useState<string | null>(null);
  const [response, setResponse] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Build suggested questions based on connected connectors
  const questions = connectedDuringOnboarding.length > 0
    ? connectedDuringOnboarding
        .filter((id) => SUGGESTED_QUESTION_KEYS[id])
        .map((id) => t(SUGGESTED_QUESTION_KEYS[id]))
        .slice(0, 3)
    : [t('defaultQ1'), t('defaultQ2'), t('defaultQ3')];

  const handleAsk = async (question: string) => {
    setSelectedQuestion(question);
    setLoading(true);
    setResponse(null);

    try {
      await window.jowork.chat.send({ message: question });
      setResponse(t('responseGenerated'));
    } catch {
      setResponse(t('engineUnavailable'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col items-center text-center px-8 py-12">
      <div className="text-5xl mb-6">✨</div>
      <h1 className="text-xl font-bold mb-2">{t('step3Title')}</h1>
      <p className="text-text-secondary mb-8 max-w-md">{t('step3Description')}</p>

      {!selectedQuestion ? (
        <div className="w-full max-w-md space-y-3 mb-8">
          {questions.map((q, i) => (
            <button
              key={i}
              onClick={() => handleAsk(q)}
              className="w-full text-left bg-surface rounded-lg p-4 text-sm hover:bg-surface-2 transition-colors"
            >
              {q}
            </button>
          ))}
        </div>
      ) : (
        <div className="w-full max-w-md mb-8">
          <div className="bg-accent/10 rounded-lg p-4 mb-3 text-sm text-left">
            {selectedQuestion}
          </div>
          <div className="bg-surface rounded-lg p-4 text-sm text-left min-h-[80px]">
            {loading ? (
              <div className="text-text-secondary animate-pulse">
                {tChat('thinking')}
              </div>
            ) : (
              <div className="whitespace-pre-wrap">{response}</div>
            )}
          </div>
        </div>
      )}

      <button
        onClick={completeOnboarding}
        className="px-8 py-3 rounded-lg bg-accent text-white font-medium hover:bg-accent/90 transition-colors"
      >
        {tc('done')}
      </button>
    </div>
  );
}
