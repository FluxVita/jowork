import { LauncherInput } from '../features/launcher/LauncherInput';
import { LauncherResults } from '../features/launcher/LauncherResults';

export function LauncherLayout() {
  return (
    <div className="flex flex-col h-screen bg-surface-1/95 backdrop-blur-xl rounded-xl overflow-hidden border border-white/10">
      <LauncherInput />
      <LauncherResults />
      <div className="flex items-center justify-between px-4 py-1.5 border-t border-white/10 text-[10px] text-text-secondary">
        <span>JoWork Quick Ask</span>
        <div className="flex items-center gap-2">
          <kbd className="px-1 py-0.5 bg-white/5 rounded text-[10px]">Esc</kbd>
          <span>close</span>
          <kbd className="px-1 py-0.5 bg-white/5 rounded text-[10px]">⌘↵</kbd>
          <span>open main</span>
        </div>
      </div>
    </div>
  );
}
