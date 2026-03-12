import { HashRouter, Routes, Route } from 'react-router';
import { MainLayout } from './layouts/MainLayout';
import { ConversationPage } from './features/conversation/ConversationPage';
import { ConnectorsPage } from './pages/ConnectorsPage';
import { SettingsPage } from './pages/SettingsPage';

export function App() {
  return (
    <HashRouter>
      <Routes>
        <Route element={<MainLayout />}>
          <Route index element={<ConversationPage />} />
          <Route path="connectors" element={<ConnectorsPage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
      </Routes>
    </HashRouter>
  );
}
