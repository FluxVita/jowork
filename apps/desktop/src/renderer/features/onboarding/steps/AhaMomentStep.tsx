import { useState, useEffect, useRef } from 'react';
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
  const { completeOnboarding, connectedDuringOnboarding, skippedLogin } = useOnboarding();
  const [selectedQuestion, setSelectedQuestion] = useState<string | null>(null);
  const [response, setResponse] = useState<string | null>(null);
  const [streamingText, setStreamingText] = useState('');
  const [loading, setLoading] = useState(false);
  const [fallbackInfo, setFallbackInfo] = useState<string | null>(null);
  const unsubRef = useRef<(() => void) | null>(null);

  // Listen for streaming events
  useEffect(() => {
    return () => {
      unsubRef.current?.();
    };
  }, []);

  // Build suggested questions based on connected connectors
  const questions = connectedDuringOnboarding.length > 0
    ? connectedDuringOnboarding
        .filter((id) => SUGGESTED_QUESTION_KEYS[id])
        .map((id) => t(SUGGESTED_QUESTION_KEYS[id]))
        .slice(0, 3)
    : [t('defaultQ1'), t('defaultQ2'), t('defaultQ3')];

  /**
   * Ensure an engine is available before chatting.
   * If local engine is not installed and user is logged in, switch to cloud engine.
   */
  async function ensureEngine(): Promise<boolean> {
    try {
      const engines = await window.jowork.engine.detect();
      const active = await window.jowork.engine.getActive();

      // Current active engine is available — good to go
      if (engines[active]?.installed) return true;

      // Local engine unavailable — try cloud fallback if user is logged in
      if (!skippedLogin) {
        const user = await window.jowork.auth.getUser();
        if (user && engines['jowork-cloud']?.installed) {
          await window.jowork.engine.switchEngine('jowork-cloud');
          setFallbackInfo(t('cloudFallback'));
          return true;
        }
      }

      return false;
    } catch {
      return false;
    }
  }

  const handleAsk = async (question: string) => {
    setSelectedQuestion(question);
    setLoading(true);
    setResponse(null);
    setStreamingText('');
    setFallbackInfo(null);

    // Check engine availability with cloud fallback
    const engineReady = await ensureEngine();
    if (!engineReady) {
      setLoading(false);
      setResponse(skippedLogin ? t('loginForCloud') : t('engineUnavailable'));
      return;
    }

    // Subscribe to chat events to display real AI response
    unsubRef.current?.();
    let accumulated = '';
    unsubRef.current = window.jowork.on('chat:event', (...args: unknown[]) => {
      const event = (args[0] && typeof args[0] === 'object') ? args[0] as { type?: string; content?: string } : null;
      if (event?.type === 'text' && event.content) {
        accumulated += event.content;
        setStreamingText(accumulated);
      }
    });

    try {
      await window.jowork.chat.send({ message: question });
      // Use accumulated streaming text as the final response
      setResponse(accumulated || t('responseGenerated'));
    } catch {
      setResponse(accumulated || t('engineUnavailable'));
    } finally {
      setLoading(false);
      unsubRef.current?.();
      unsubRef.current = null;
    }
  };

  return (
    <div className="flex flex-col items-center text-center px-8 py-12">
      <div className="text-5xl mb-6">✨</div>
      <h1 className="text-xl font-bold mb-2">{t('step3Title')}</h1>
      <p className="text-text-secondary mb-8 max-w-md">{t('step3Description')}</p>

      {fallbackInfo && (
        <p className="text-xs text-accent mb-4">{fallbackInfo}</p>
      )}

      {!selectedQuestion ? (
        <div className="w-full max-w-md space-y-3 mb-8">
          {questions.map((q, i) => (
            <button
              key={i}
              onClick={() => handleAsk(q)}
              aria-label={`${t('askQuestion', { defaultValue: 'Ask' })}: ${q}`}
              className="w-full text-left bg-surface-1 rounded-lg p-4 text-sm hover:bg-surface-2 transition-colors"
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
          <div className="bg-surface-1 rounded-lg p-4 text-sm text-left min-h-[80px]">
            {loading && !streamingText ? (
              <div className="text-text-secondary animate-pulse">
                {tChat('thinking')}
              </div>
            ) : loading && streamingText ? (
              <div className="whitespace-pre-wrap">{streamingText}<span className="inline-block w-2 h-4 bg-accent/60 animate-pulse ml-0.5" /></div>
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
