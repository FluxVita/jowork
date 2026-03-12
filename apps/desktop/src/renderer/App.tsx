import { HashRouter, Routes, Route } from 'react-router';
import { MainLayout } from './layouts/MainLayout';
import { LauncherLayout } from './layouts/LauncherLayout';
import { ConversationPage } from './features/conversation/ConversationPage';
import { ConnectorsPage } from './features/connectors/ConnectorsPage';
import { MemoryPage } from './features/memory/MemoryPage';
import { SkillsPanel } from './features/skills/SkillsPanel';
import { WorkstyleEditor } from './features/workstyle/WorkstyleEditor';
import { SchedulerPage } from './features/scheduler/SchedulerPage';
import { NotificationCenter } from './features/notifications/NotificationCenter';
import { BillingPage } from './features/billing/BillingPage';
import { TeamPage } from './features/team/TeamPage';
import { TerminalPage } from './pages/TerminalPage';
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
          <Route path="scheduler" element={<SchedulerPage />} />
          <Route path="notifications" element={<NotificationCenter />} />
          <Route path="billing" element={<BillingPage />} />
          <Route path="team" element={<TeamPage />} />
          <Route path="terminal" element={<TerminalPage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
      </Routes>
    </HashRouter>
  );
}
