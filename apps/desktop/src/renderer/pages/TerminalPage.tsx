import { useEffect, useRef, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

interface TerminalTab {
  id: string;
  title: string;
}

export function TerminalPage() {
  const { t } = useTranslation('settings');
  const termRef = useRef<HTMLDivElement>(null);
  const [tabs, setTabs] = useState<TerminalTab[]>([]);
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const xtermRef = useRef<unknown>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  const createTab = useCallback(async () => {
    const id = await window.jowork.pty.create();
    const tab: TerminalTab = { id, title: t('terminalTab', { n: tabs.length + 1 }) };
    setTabs((prev) => [...prev, tab]);
    setActiveTab(id);
    return id;
  }, [tabs.length]);

  const closeTab = useCallback(async (id: string) => {
    await window.jowork.pty.destroy(id);
    setTabs((prev) => prev.filter((t) => t.id !== id));
    setActiveTab((prev) => (prev === id ? tabs[0]?.id ?? null : prev));
  }, [tabs]);

  useEffect(() => {
    if (!activeTab || !termRef.current) return;

    let terminal: { write: (data: string) => void; onData: (cb: (data: string) => void) => void; open: (el: HTMLElement) => void; dispose: () => void } | null = null;

    const init = async () => {
      // Dynamically import xterm (renderer-only)
      const { Terminal } = await import('@xterm/xterm');
      const { FitAddon } = await import('@xterm/addon-fit');
      await import('@xterm/xterm/css/xterm.css');

      terminal = new Terminal({
        theme: {
          background: '#1a1a1e',
          foreground: '#e4e4e7',
          cursor: '#4f46e5',
        },
        fontSize: 13,
        fontFamily: 'JetBrains Mono, Menlo, Monaco, monospace',
        cursorBlink: true,
      });

      const fitAddon = new FitAddon();
      terminal.loadAddon(fitAddon);

      if (termRef.current) {
        terminal.open(termRef.current);
        fitAddon.fit();

        // Resize IPC
        const { cols, rows } = fitAddon.proposeDimensions() ?? { cols: 80, rows: 24 };
        await window.jowork.pty.resize(activeTab, cols, rows);
      }

      // Keyboard input → PTY
      terminal.onData((data: string) => {
        window.jowork.pty.write(activeTab, data);
      });

      // PTY output → terminal
      const unsub = window.jowork.on('pty:data', (ptId: unknown, data: unknown) => {
        if (ptId === activeTab && terminal) {
          terminal.write(data as string);
        }
      });

      cleanupRef.current = () => {
        unsub();
        terminal?.dispose();
      };
    };

    init();

    return () => {
      cleanupRef.current?.();
    };
  }, [activeTab]);

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
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-1 px-3 py-1 text-xs rounded-t transition-colors ${
              activeTab === tab.id
                ? 'bg-surface-2 text-text-primary'
                : 'text-text-secondary hover:text-text-primary'
            }`}
          >
            <span>{tab.title}</span>
            <span
              onClick={(e) => {
                e.stopPropagation();
                closeTab(tab.id);
              }}
              className="ml-1 hover:text-red-400"
            >
              x
            </span>
          </button>
        ))}
        <button
          onClick={createTab}
          className="px-2 py-1 text-xs text-text-secondary hover:text-accent transition-colors"
        >
          +
        </button>
      </div>

      {/* Terminal */}
      <div ref={termRef} className="flex-1 bg-surface-1" />
    </div>
  );
}
