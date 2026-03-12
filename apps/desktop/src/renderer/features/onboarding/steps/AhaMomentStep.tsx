import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useOnboarding } from '../hooks/useOnboarding';

interface SuggestedQuestion {
  connector: string;
  question: { zh: string; en: string };
}

const SUGGESTED_QUESTIONS: SuggestedQuestion[] = [
  { connector: 'github', question: { zh: '帮我看看这周有哪些 PR 需要 review', en: 'Show me PRs that need review this week' } },
  { connector: 'feishu', question: { zh: '总结一下飞书群今天的重点', en: "Summarize today's highlights from Feishu group" } },
  { connector: 'local-folder', question: { zh: '这个项目最近最值得关注的文件是什么？', en: 'What files in this project are most worth my attention?' } },
  { connector: 'figma', question: { zh: '看看 Figma 里最新的设计更新', en: 'Show me the latest design updates in Figma' } },
  { connector: 'gitlab', question: { zh: '总结一下 GitLab 上最近的 merge requests', en: 'Summarize recent merge requests on GitLab' } },
];

// Default questions when no connectors are connected
const DEFAULT_QUESTIONS = {
  zh: ['帮我写一段 README.md', '解释一下什么是 MCP Server', '帮我规划一个新项目的架构'],
  en: ['Help me write a README.md', 'Explain what an MCP Server is', 'Help me plan a new project architecture'],
};

export function AhaMomentStep() {
  const { t } = useTranslation('onboarding');
  const { completeOnboarding, connectedDuringOnboarding, language } = useOnboarding();
  const [selectedQuestion, setSelectedQuestion] = useState<string | null>(null);
  const [response, setResponse] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Build suggested questions based on connected connectors
  const questions = connectedDuringOnboarding.length > 0
    ? SUGGESTED_QUESTIONS
        .filter((q) => connectedDuringOnboarding.includes(q.connector))
        .map((q) => q.question[language as 'zh' | 'en'] ?? q.question.en)
        .slice(0, 3)
    : (DEFAULT_QUESTIONS[language as 'zh' | 'en'] ?? DEFAULT_QUESTIONS.en);

  const handleAsk = async (question: string) => {
    setSelectedQuestion(question);
    setLoading(true);
    setResponse(null);

    try {
      const result = await window.jowork.invoke('engine:send', {
        sessionId: null,
        message: question,
      });
      setResponse(result?.text ?? (language === 'zh' ? '回答已生成。' : 'Response generated.'));
    } catch {
      setResponse(language === 'zh'
        ? '引擎暂时不可用，完成设置后再试。'
        : 'Engine unavailable right now. Try again after setup.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col items-center text-center px-8 py-12">
      <div className="text-5xl mb-6">✨</div>
      <h1 className="text-xl font-bold mb-2">{t('step3Title', { defaultValue: 'Try It Now!' })}</h1>
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
                {language === 'zh' ? '思考中...' : 'Thinking...'}
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
        {t('common:done', { ns: 'common' })}
      </button>
    </div>
  );
}
