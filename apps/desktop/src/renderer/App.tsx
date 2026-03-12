import { lazy, Suspense } from 'react';
import { HashRouter, Routes, Route } from 'react-router';
import { ErrorBoundary } from './components/ErrorBoundary';
import { MainLayout } from './layouts/MainLayout';

// Critical path — loaded eagerly (conversation is the default page)
import { ConversationPage } from './features/conversation/ConversationPage';

// Non-critical pages — lazy loaded to speed up startup
const LauncherLayout = lazy(() => import('./layouts/LauncherLayout').then((m) => ({ default: m.LauncherLayout })));
const OnboardingFlow = lazy(() => import('./features/onboarding/OnboardingFlow').then((m) => ({ default: m.OnboardingFlow })));
const ConnectorsPage = lazy(() => import('./features/connectors/ConnectorsPage').then((m) => ({ default: m.ConnectorsPage })));
const MemoryPage = lazy(() => import('./features/memory/MemoryPage').then((m) => ({ default: m.MemoryPage })));
const SkillsPanel = lazy(() => import('./features/skills/SkillsPanel').then((m) => ({ default: m.SkillsPanel })));
const WorkstyleEditor = lazy(() => import('./features/workstyle/WorkstyleEditor').then((m) => ({ default: m.WorkstyleEditor })));
const SchedulerPage = lazy(() => import('./features/scheduler/SchedulerPage').then((m) => ({ default: m.SchedulerPage })));
const NotificationCenter = lazy(() => import('./features/notifications/NotificationCenter').then((m) => ({ default: m.NotificationCenter })));
const BillingPage = lazy(() => import('./features/billing/BillingPage').then((m) => ({ default: m.BillingPage })));
const TeamPage = lazy(() => import('./features/team/TeamPage').then((m) => ({ default: m.TeamPage })));
const TerminalPage = lazy(() => import('./pages/TerminalPage').then((m) => ({ default: m.TerminalPage })));
const SettingsPage = lazy(() => import('./pages/SettingsPage').then((m) => ({ default: m.SettingsPage })));

function PageFallback() {
  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="text-sm text-text-secondary animate-pulse">Loading...</div>
    </div>
  );
}

export function App() {
  return (
    <ErrorBoundary>
      <HashRouter>
        <Suspense fallback={<PageFallback />}>
          <Routes>
            {/* Onboarding (first-time user) */}
            <Route path="onboarding" element={<OnboardingFlow />} />

            {/* Launcher window (separate layout, no sidebar) */}
            <Route path="launcher" element={<LauncherLayout />} />

            {/* Main window */}
            <Route element={<MainLayout />}>
              <Route index element={<ConversationPage />} />
              <Route path="connectors" element={
                <Suspense fallback={<PageFallback />}><ConnectorsPage /></Suspense>
              } />
              <Route path="memories" element={
                <Suspense fallback={<PageFallback />}><MemoryPage /></Suspense>
              } />
              <Route path="skills" element={
                <Suspense fallback={<PageFallback />}><SkillsPanel /></Suspense>
              } />
              <Route path="workstyle" element={
                <Suspense fallback={<PageFallback />}><WorkstyleEditor /></Suspense>
              } />
              <Route path="scheduler" element={
                <Suspense fallback={<PageFallback />}><SchedulerPage /></Suspense>
              } />
              <Route path="notifications" element={
                <Suspense fallback={<PageFallback />}><NotificationCenter /></Suspense>
              } />
              <Route path="billing" element={
                <Suspense fallback={<PageFallback />}><BillingPage /></Suspense>
              } />
              <Route path="team" element={
                <Suspense fallback={<PageFallback />}><TeamPage /></Suspense>
              } />
              <Route path="terminal" element={
                <Suspense fallback={<PageFallback />}><TerminalPage /></Suspense>
              } />
              <Route path="settings" element={
                <Suspense fallback={<PageFallback />}><SettingsPage /></Suspense>
              } />
            </Route>
          </Routes>
        </Suspense>
      </HashRouter>
    </ErrorBoundary>
  );
}
