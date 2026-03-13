import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useEngineStore } from '../../../stores/engine';
import { useToastStore } from '../../../stores/toast';

export function useEngine() {
  const { t } = useTranslation('chat');
  const addToast = useToastStore((s) => s.addToast);
  const detect = useEngineStore((s) => s.detect);

  useEffect(() => {
    detect();
  }, [detect]);

  useEffect(() => {
    const offCrash = window.jowork.engine.onCrashed((data) => {
      const crash = data as { engineId: string; code: number; retries: number };
      addToast('warning', t('engineCrashed', { retries: crash.retries }));
    });

    const offFatal = window.jowork.on('engine:crash-fatal', (data: unknown) => {
      const fatal = data as { engineId: string; message: string };
      addToast('error', t('engineCrashFatal', { max: 3 }), 0); // persistent
    });

    const offReady = window.jowork.on('engine:restart-ready', () => {
      addToast('success', t('engineRestartReady'));
    });

    return () => {
      offCrash();
      offFatal();
      offReady();
    };
  }, [t, addToast]);

  return {
    engines: useEngineStore((s) => s.engines),
    activeEngineId: useEngineStore((s) => s.activeEngineId),
    isDetecting: useEngineStore((s) => s.isDetecting),
    isInstalling: useEngineStore((s) => s.isInstalling),
    switchEngine: useEngineStore((s) => s.switchEngine),
    installEngine: useEngineStore((s) => s.installEngine),
  };
}
