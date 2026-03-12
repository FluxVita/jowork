import { HashRouter, Routes, Route } from 'react-router';
import { MainLayout } from './layouts/MainLayout';
import { LauncherLayout } from './layouts/LauncherLayout';
import { ConversationPage } from './features/conversation/ConversationPage';
import { ConnectorsPage } from './features/connectors/ConnectorsPage';
import { MemoryPage } from './features/memory/MemoryPage';
import { SkillsPanel } from './features/skills/SkillsPanel';
import { WorkstyleEditor } from './features/workstyle/WorkstyleEditor';
import { SettingsPage } from './pages/SettingsPage';

export function App() {
  return (
    <HashRouter>
      <Routes>
        {/* Launcher window (separate layout, no sidebar) */}
        <Route path="launcher" element={<LauncherLayout />} />

        {/* Main window */}
        <Route element={<MainLayout />}>
          <Route index element={<ConversationPage />} />
          <Route path="connectors" element={<ConnectorsPage />} />
          <Route path="memories" element={<MemoryPage />} />
          <Route path="skills" element={<SkillsPanel />} />
          <Route path="workstyle" element={<WorkstyleEditor />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
      </Routes>
    </HashRouter>
  );
}
