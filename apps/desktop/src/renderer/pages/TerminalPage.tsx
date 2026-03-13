import { useEffect, useRef, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../stores/app';

interface TerminalTab {
  id: string;
  title: string;
}

let tabCounter = 0;

export function TerminalPage() {
  const { t } = useTranslation('settings');
  const termRef = useRef<HTMLDivElement>(null);
  const [tabs, setTabs] = useState<TerminalTab[]>([]);
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const theme = useAppStore((s) => s.theme);

  const createTab = useCallback(async () => {
    const id = await window.jowork.pty.create();
    tabCounter++;
    const tab: TerminalTab = { id, title: t('terminalTab', { n: tabCounter }) };
    setTabs((prev) => [...prev, tab]);
    setActiveTab(id);
    return id;
  }, [t]);

  const closeTab = useCallback(async (id: string) => {
    await window.jowork.pty.destroy(id);
    setTabs((prev) => {
      const remaining = prev.filter((tab) => tab.id !== id);
      // Use setter for activeTab to avoid stale closure
      setActiveTab((current) => (current === id ? (remaining[0]?.id ?? null) : current));
      return remaining;
    });
  }, []);

  useEffect(() => {
    if (!activeTab || !termRef.current) return;

    let terminal: { write: (data: string) => void; onData: (cb: (data: string) => void) => void; open: (el: HTMLElement) => void; dispose: () => void; loadAddon: (addon: unknown) => void } | null = null;
    let fitAddon: { fit: () => void; proposeDimensions: () => { cols: number; rows: number } | undefined } | null = null;

    const init = async () => {
      const { Terminal } = await import('@xterm/xterm');
      const { FitAddon } = await import('@xterm/addon-fit');
      await import('@xterm/xterm/css/xterm.css');

      // Theme-aware colors
      const isDark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);

      terminal = new Terminal({
        theme: {
          background: isDark ? '#1a1a1e' : '#fafafa',
          foreground: isDark ? '#e4e4e7' : '#27272a',
          cursor: '#4f46e5',
        },
        fontSize: 13,
        fontFamily: 'JetBrains Mono, Menlo, Monaco, monospace',
        cursorBlink: true,
      });

      fitAddon = new FitAddon();
      terminal.loadAddon(fitAddon);

      if (termRef.current) {
        terminal.open(termRef.current);
        fitAddon.fit();

        const { cols, rows } = fitAddon.proposeDimensions() ?? { cols: 80, rows: 24 };
        await window.jowork.pty.resize(activeTab, cols, rows);
      }

      terminal.onData((data: string) => {
        window.jowork.pty.write(activeTab, data);
      });

      const unsub = window.jowork.on('pty:data', (ptId: unknown, data: unknown) => {
        if (ptId === activeTab && terminal) {
          terminal.write(data as string);
        }
      });

      // ResizeObserver to refit terminal when container changes size
      const resizeObserver = new ResizeObserver(() => {
        if (fitAddon && terminal) {
          fitAddon.fit();
          const dims = fitAddon.proposeDimensions();
          if (dims) {
            window.jowork.pty.resize(activeTab, dims.cols, dims.rows).catch(() => {});
          }
        }
      });
      if (termRef.current) resizeObserver.observe(termRef.current);

      cleanupRef.current = () => {
        resizeObserver.disconnect();
        unsub();
        terminal?.dispose();
      };
    };

    init();

    return () => {
      cleanupRef.current?.();
    };
  }, [activeTab, theme]);

  // Create first tab on mount
  useEffect(() => {
    if (tabs.length === 0) {
      createTab();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex flex-col h-full">
      {/* Tab bar */}
      <div className="flex items-center gap-1 px-2 py-1 bg-surface-1 border-b border-border">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            role="tab"
            tabIndex={0}
            aria-selected={activeTab === tab.id}
            onClick={() => setActiveTab(tab.id)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setActiveTab(tab.id); }}
            className={`flex items-center gap-1 px-3 py-1 text-xs rounded-t transition-colors cursor-pointer ${
              activeTab === tab.id
                ? 'bg-surface-2 text-text-primary'
                : 'text-text-secondary hover:text-text-primary'
            }`}
          >
            <span>{tab.title}</span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                closeTab(tab.id);
              }}
              className="ml-1 hover:text-red-400"
              aria-label={t('common:close')}
            >
              x
            </button>
          </div>
        ))}
        <button
          onClick={createTab}
          className="px-2 py-1 text-xs text-text-secondary hover:text-accent transition-colors"
          aria-label={t('common:create')}
        >
          +
        </button>
      </div>

      {/* Terminal */}
      <div ref={termRef} className="flex-1 bg-surface-1" />
    </div>
  );
}
