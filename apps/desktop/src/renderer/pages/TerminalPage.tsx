import { useEffect, useRef, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../stores/app';
import { Terminal as TerminalIcon, X, Plus } from 'lucide-react';

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
          background: 'transparent',
          foreground: isDark ? '#e4e4e7' : '#27272a',
          cursor: '#4f46e5',
        },
        fontSize: 13,
        fontFamily: 'JetBrains Mono, Menlo, Monaco, monospace',
        cursorBlink: true,
        allowTransparency: true,
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
    <div className="flex flex-col h-full animate-in fade-in duration-300">
      {/* Tab bar */}
      <div className="flex items-center gap-2 px-3 py-2 bg-surface-1/40 backdrop-blur-md border-b border-border/40">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            role="tab"
            tabIndex={0}
            aria-selected={activeTab === tab.id}
            onClick={() => setActiveTab(tab.id)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setActiveTab(tab.id); }}
            className={`flex items-center gap-2 px-4 py-1.5 text-[13px] rounded-xl transition-all duration-300 cursor-pointer ${
              activeTab === tab.id
                ? 'bg-primary text-primary-foreground shadow-md shadow-primary/20 font-medium'
                : 'text-muted-foreground hover:bg-surface-2/60 hover:text-foreground'
            }`}
          >
            <TerminalIcon className="w-3.5 h-3.5" />
            <span>{tab.title}</span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                closeTab(tab.id);
              }}
              className={`ml-1 p-0.5 rounded-md transition-colors ${activeTab === tab.id ? 'hover:bg-black/20 text-primary-foreground/70 hover:text-white' : 'hover:bg-surface-2 hover:text-red-400'}`}
              aria-label={t('common:close')}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
        <button
          onClick={createTab}
          className="p-1.5 ml-1 rounded-xl text-muted-foreground hover:bg-primary/10 hover:text-primary transition-all duration-200"
          aria-label={t('common:create')}
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>

      {/* Terminal */}
      <div className="flex-1 bg-background/50 p-2 overflow-hidden">
        <div ref={termRef} className="w-full h-full [&_.xterm-viewport]:!bg-transparent" />
      </div>
    </div>
  );
}