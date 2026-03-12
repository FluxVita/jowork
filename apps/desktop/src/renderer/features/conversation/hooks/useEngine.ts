import { useEffect } from 'react';
import { useEngineStore } from '../../../stores/engine';

export function useEngine() {
  const detect = useEngineStore((s) => s.detect);

  useEffect(() => {
    detect();
  }, [detect]);

  useEffect(() => {
    const off = window.jowork.engine.onCrashed((data) => {
      const crash = data as { engineId: string; code: number; retries: number };
      console.warn(`Engine ${crash.engineId} crashed (code ${crash.code}), retry #${crash.retries}`);
    });
    return off;
  }, []);

  return {
    engines: useEngineStore((s) => s.engines),
    activeEngineId: useEngineStore((s) => s.activeEngineId),
    isDetecting: useEngineStore((s) => s.isDetecting),
    isInstalling: useEngineStore((s) => s.isInstalling),
    switchEngine: useEngineStore((s) => s.switchEngine),
    installEngine: useEngineStore((s) => s.installEngine),
  };
}
