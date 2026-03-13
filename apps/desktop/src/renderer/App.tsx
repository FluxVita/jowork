import { lazy, Suspense, useEffect, useState } from 'react';
import { HashRouter, Routes, Route, Navigate, useLocation } from 'react-router';
import { useTranslation } from 'react-i18next';
import { ErrorBoundary, FeatureErrorBoundary } from './components/ErrorBoundary';
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
  const { t } = useTranslation();
  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="text-sm text-text-secondary animate-pulse">{t('loading')}</div>
    </div>
  );
}

/** Redirects to /onboarding on first launch (onboarding not yet completed). */
function OnboardingGuard({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const [checked, setChecked] = useState(false);
  const [needsOnboarding, setNeedsOnboarding] = useState(false);

  useEffect(() => {
    window.jowork.settings.get('onboarding').then((val) => {
      if (val) {
        try {
          const parsed = typeof val === 'string' ? JSON.parse(val) : val;
          setNeedsOnboarding(!parsed.completed);
        } catch {
          setNeedsOnboarding(true);
        }
      } else {
        setNeedsOnboarding(true);
      }
      setChecked(true);
    }).catch(() => {
      setNeedsOnboarding(true);
      setChecked(true);
    });
  }, []);

  if (!checked) return <PageFallback />;

  // Redirect to onboarding if not completed (but don't redirect if already on onboarding or launcher)
  if (needsOnboarding && !location.pathname.startsWith('/onboarding') && !location.pathname.startsWith('/launcher')) {
    return <Navigate to="/onboarding" replace />;
  }

  return <>{children}</>;
}

export function App() {
  return (
    <ErrorBoundary>
      <HashRouter>
        <Suspense fallback={<PageFallback />}>
          <OnboardingGuard>
          <Routes>
            {/* Onboarding (first-time user) */}
            <Route path="onboarding" element={<OnboardingFlow />} />

            {/* Launcher window (separate layout, no sidebar) */}
            <Route path="launcher" element={<LauncherLayout />} />

            {/* Main window */}
            <Route element={<MainLayout />}>
              <Route index element={<ConversationPage />} />
              <Route path="connectors" element={
                <FeatureErrorBoundary name="Connectors"><Suspense fallback={<PageFallback />}><ConnectorsPage /></Suspense></FeatureErrorBoundary>
              } />
              <Route path="memories" element={
                <FeatureErrorBoundary name="Memory"><Suspense fallback={<PageFallback />}><MemoryPage /></Suspense></FeatureErrorBoundary>
              } />
              <Route path="skills" element={
                <FeatureErrorBoundary name="Skills"><Suspense fallback={<PageFallback />}><SkillsPanel /></Suspense></FeatureErrorBoundary>
              } />
              <Route path="workstyle" element={
                <FeatureErrorBoundary name="Workstyle"><Suspense fallback={<PageFallback />}><WorkstyleEditor /></Suspense></FeatureErrorBoundary>
              } />
              <Route path="scheduler" element={
                <FeatureErrorBoundary name="Scheduler"><Suspense fallback={<PageFallback />}><SchedulerPage /></Suspense></FeatureErrorBoundary>
              } />
              <Route path="notifications" element={
                <FeatureErrorBoundary name="Notifications"><Suspense fallback={<PageFallback />}><NotificationCenter /></Suspense></FeatureErrorBoundary>
              } />
              <Route path="billing" element={
                <FeatureErrorBoundary name="Billing"><Suspense fallback={<PageFallback />}><BillingPage /></Suspense></FeatureErrorBoundary>
              } />
              <Route path="team" element={
                <FeatureErrorBoundary name="Team"><Suspense fallback={<PageFallback />}><TeamPage /></Suspense></FeatureErrorBoundary>
              } />
              <Route path="terminal" element={
                <FeatureErrorBoundary name="Terminal"><Suspense fallback={<PageFallback />}><TerminalPage /></Suspense></FeatureErrorBoundary>
              } />
              <Route path="settings" element={
                <FeatureErrorBoundary name="Settings"><Suspense fallback={<PageFallback />}><SettingsPage /></Suspense></FeatureErrorBoundary>
              } />
            </Route>
          </Routes>
          </OnboardingGuard>
        </Suspense>
      </HashRouter>
    </ErrorBoundary>
  );
}
