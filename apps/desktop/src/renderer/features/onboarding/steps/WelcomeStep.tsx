import { useTranslation } from 'react-i18next';
import { useOnboarding } from '../hooks/useOnboarding';
import { i18n } from '@jowork/core';
import { TestimonialStack, Testimonial } from '../../../components/ui/glass-testimonial-swiper';
import { Bot, Cpu, Database, Shield, Zap, ArrowRight, Languages } from 'lucide-react';

export function WelcomeStep() {
  const { t } = useTranslation('onboarding');
  const { t: tc } = useTranslation('common');
  const { nextStep, setLanguage, language } = useOnboarding();

  const handleLanguageChange = (lang: string) => {
    setLanguage(lang);
    i18n.changeLanguage(lang);
    window.jowork.settings.notifyLanguageChanged(lang);
  };

  const features: Testimonial[] = [
    {
      id: 'mcp',
      initials: 'MCP',
      name: 'Model Context Protocol',
      role: t('featureMcpRole', { defaultValue: language === 'zh' ? '本地数据连接器' : 'Local Data Connector' }),
      quote: t('featureMcpQuote', { defaultValue: language === 'zh' ? 'JoWork 通过 MCP 协议深度连接你的本地代码库、文件和数据库，让 AI 真正懂你的工作流。' : 'Connect seamlessly with local files, repos and DBs via MCP protocol. AI that truly understands your workspace.' }),
      tags: [{ text: 'LOCAL-FIRST', type: 'featured' }, { text: 'Privacy', type: 'default' }],
      stats: [{ icon: Database, text: '50+ Source' }, { icon: Shield, text: 'Secure' }],
      avatarGradient: 'linear-gradient(135deg, #4f46e5, #8b5cf6)',
    },
    {
      id: 'engine',
      initials: 'AI',
      name: 'Multi-Engine Dispatch',
      role: t('featureEngineRole', { defaultValue: language === 'zh' ? '多模型调度引擎' : 'Multi-Engine Dispatch' }),
      quote: t('featureEngineQuote', { defaultValue: language === 'zh' ? '支持 Claude, GPT, DeepSeek 及本地 Ollama 模型，根据任务复杂度自动选择最佳引擎。' : 'Native support for Claude, GPT, DeepSeek and Ollama. Auto-switches based on task complexity.' }),
      tags: [{ text: 'INTELLIGENT', type: 'featured' }, { text: 'Cost-Effective', type: 'default' }],
      stats: [{ icon: Cpu, text: 'Auto-Switch' }, { icon: Zap, text: 'Fast' }],
      avatarGradient: 'linear-gradient(135deg, #10b981, #059669)',
    }
  ];

  return (
    <div className="flex flex-col items-center text-center max-w-5xl mx-auto py-4">
      <div className="space-y-4 mb-10">
        <h1 className="text-5xl font-extrabold tracking-tight text-foreground sm:text-6xl flex items-center justify-center gap-4">
          JoWork <span className="text-[20px] font-bold text-primary bg-primary/10 px-3 py-1 rounded-2xl border border-primary/20 align-middle">v2</span>
        </h1>
        <p className="text-lg text-muted-foreground max-w-2xl mx-auto leading-relaxed">
          {t('welcomeDescription', { defaultValue: language === 'zh' ? '下一代 AI 驱动的智能工作助理，本地优先，隐私无忧。' : 'Next-gen AI assistant. Local-first, privacy-focused, incredibly smart.' })}
        </p>
      </div>

      <div className="w-full mb-12 animate-in zoom-in duration-1000">
        <TestimonialStack testimonials={features} />
      </div>

      {/* Language selector in glass style */}
      <div className="flex items-center gap-2 mb-10 bg-surface-2/30 p-1.5 rounded-2xl border border-border/20 backdrop-blur-md">
        <div className="p-2 text-muted-foreground">
          <Languages className="w-4 h-4" />
        </div>
        <button
          onClick={() => handleLanguageChange('zh')}
          aria-pressed={language === 'zh'}
          className={`px-4 py-1.5 rounded-xl text-xs font-semibold transition-all duration-300 ${
            language === 'zh' ? 'bg-primary text-primary-foreground shadow-lg shadow-primary/20' : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          中文
        </button>
        <button
          onClick={() => handleLanguageChange('en')}
          aria-pressed={language === 'en'}
          className={`px-4 py-1.5 rounded-xl text-xs font-semibold transition-all duration-300 ${
            language === 'en' ? 'bg-primary text-primary-foreground shadow-lg shadow-primary/20' : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          English
        </button>
      </div>

      <button
        onClick={nextStep}
        className="group relative flex items-center gap-3 px-10 py-4 bg-primary text-primary-foreground text-lg font-bold rounded-[20px] shadow-2xl shadow-primary/30 hover:opacity-90 active:scale-95 transition-all duration-300"
      >
        <span>{t('getStarted', { defaultValue: language === 'zh' ? '开启智能之旅' : 'Get Started' })}</span>
        <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
      </button>

      <p className="mt-10 text-[11px] font-medium tracking-widest text-muted-foreground/40 uppercase">
        {tc('v2', { defaultValue: 'v2' })} • {tc('localFirst', { defaultValue: 'Local First' })} • AGPL-3.0
      </p>
    </div>
  );
}
