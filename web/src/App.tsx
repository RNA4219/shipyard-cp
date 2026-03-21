import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from './contexts/ThemeContext';
import { LanguageProvider, useLanguage } from './contexts/LanguageContext';
import { SearchProvider } from './contexts/SearchContext';
import { NotificationProvider } from './contexts/NotificationContext';
import { MainLayout } from './components/layout/MainLayout';
import './styles/themes.css';
import './index.css';

// Lazy load page components for code splitting
const DashboardPage = lazy(() => import('./pages/DashboardPage').then(m => ({ default: m.DashboardPage })));
const TasksPage = lazy(() => import('./pages/TasksPage').then(m => ({ default: m.TasksPage })));
const TaskDetail = lazy(() => import('./components/tasks/TaskDetail').then(m => ({ default: m.TaskDetail })));
const TaskCreatePage = lazy(() => import('./pages/TaskCreatePage').then(m => ({ default: m.TaskCreatePage })));
const RunsPage = lazy(() => import('./pages/RunsPage').then(m => ({ default: m.RunsPage })));
const RunDetail = lazy(() => import('./components/runs/RunDetail').then(m => ({ default: m.RunDetail })));
const SettingsPage = lazy(() => import('./pages/SettingsPage').then(m => ({ default: m.SettingsPage })));
const LanguageOnboarding = lazy(() => import('./components/onboarding/LanguageOnboarding').then(m => ({ default: m.LanguageOnboarding })));

// Optimized QueryClient configuration
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes - data stays fresh for 5 minutes
      gcTime: 1000 * 60 * 30, // 30 minutes - garbage collection time (formerly cacheTime)
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
      retry: 1,
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
    },
  },
});

// Loading fallback component
function PageLoader() {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="flex flex-col items-center gap-4">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        <span className="text-on-surface-variant text-sm font-mono">Loading...</span>
      </div>
    </div>
  );
}

function AppContent() {
  const { hasSelectedLanguage } = useLanguage();

  return (
    <>
      {!hasSelectedLanguage && (
        <Suspense fallback={<PageLoader />}>
          <LanguageOnboarding />
        </Suspense>
      )}
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<MainLayout />}>
            <Route
              index
              element={
                <Suspense fallback={<PageLoader />}>
                  <DashboardPage />
                </Suspense>
              }
            />
            <Route
              path="tasks"
              element={
                <Suspense fallback={<PageLoader />}>
                  <TasksPage />
                </Suspense>
              }
            />
            <Route
              path="tasks/new"
              element={
                <Suspense fallback={<PageLoader />}>
                  <TaskCreatePage />
                </Suspense>
              }
            />
            <Route
              path="tasks/:taskId"
              element={
                <Suspense fallback={<PageLoader />}>
                  <TaskDetail />
                </Suspense>
              }
            />
            <Route
              path="runs"
              element={
                <Suspense fallback={<PageLoader />}>
                  <RunsPage />
                </Suspense>
              }
            />
            <Route
              path="runs/:runId"
              element={
                <Suspense fallback={<PageLoader />}>
                  <RunDetail />
                </Suspense>
              }
            />
            <Route
              path="settings"
              element={
                <Suspense fallback={<PageLoader />}>
                  <SettingsPage />
                </Suspense>
              }
            />
          </Route>
        </Routes>
      </BrowserRouter>
    </>
  );
}

function App() {
  return (
    <ThemeProvider>
      <LanguageProvider>
        <QueryClientProvider client={queryClient}>
          <NotificationProvider>
            <SearchProvider>
              <AppContent />
            </SearchProvider>
          </NotificationProvider>
        </QueryClientProvider>
      </LanguageProvider>
    </ThemeProvider>
  );
}

export default App;