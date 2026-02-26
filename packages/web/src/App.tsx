import { useEffect } from 'react';

import { AuthProvider, useAuth } from './auth/AuthContext';
import { roleHomePath } from './auth/routes';
import { AppShell } from './components/layout/AppShell';
import { Link, RouterProvider, useRouter } from './lib/router';
import { AdminCohortsPage, AdminSettingsPage, AdminUsersPage } from './pages/admin/AdminPages';
import {
  ProfessorAnalyticsPage,
  ProfessorDashboardPage,
  ProfessorMilestonesPage,
  ProfessorStudentDetailPage,
  ProfessorStudentsPage,
} from './pages/professor/ProfessorPages';
import { ChangePasswordPage } from './pages/public/ChangePasswordPage';
import { LandingPage } from './pages/public/LandingPage';
import { LoginPage } from './pages/public/LoginPage';
import { RegisterPage } from './pages/public/RegisterPage';
import { ResetPasswordPage } from './pages/public/ResetPasswordPage';
import {
  StudentHistoryPage,
  StudentMockVivaPage,
  StudentSettingsPage,
  StudentSubmissionsPage,
  StudentWorkspacePage,
} from './pages/student/StudentPages';

function FullPageLoader(): JSX.Element {
  return (
    <div className="full-page-loader" role="status" aria-live="polite">
      <div className="spinner" />
      <p>Loading SuperviseAI...</p>
    </div>
  );
}

function NotFoundPage(): JSX.Element {
  return (
    <div className="full-page-loader">
      <p>Page not found.</p>
      <Link className="btn btn-primary" to="/">
        Go to landing page
      </Link>
    </div>
  );
}

function renderStudentRoute(path: string): JSX.Element {
  const subPath = path.replace(/^\/student/, '') || '/';

  if (subPath === '/' || subPath === '') {
    return <StudentWorkspacePage />;
  }

  if (subPath === '/submissions') {
    return <StudentSubmissionsPage />;
  }

  if (subPath === '/mock-viva') {
    return <StudentMockVivaPage />;
  }

  if (subPath === '/history') {
    return <StudentHistoryPage />;
  }

  if (subPath === '/settings') {
    return <StudentSettingsPage />;
  }

  return <NotFoundPage />;
}

function renderProfessorRoute(path: string): JSX.Element {
  const subPath = path.replace(/^\/professor/, '') || '/';

  if (subPath === '/' || subPath === '') {
    return <ProfessorDashboardPage />;
  }

  if (subPath === '/students') {
    return <ProfessorStudentsPage />;
  }

  if (subPath.startsWith('/students/')) {
    const thesisId = subPath.replace('/students/', '');
    if (thesisId.length > 0) {
      return <ProfessorStudentDetailPage thesisId={thesisId} />;
    }
  }

  if (subPath.startsWith('/student/')) {
    const thesisId = subPath.replace('/student/', '');
    if (thesisId.length > 0) {
      return <ProfessorStudentDetailPage thesisId={thesisId} />;
    }
  }

  if (subPath === '/milestones') {
    return <ProfessorMilestonesPage />;
  }

  if (subPath === '/analytics') {
    return <ProfessorAnalyticsPage />;
  }

  return <NotFoundPage />;
}

function renderAdminRoute(path: string): JSX.Element {
  const subPath = path.replace(/^\/admin/, '') || '/';

  if (subPath === '/' || subPath === '') {
    return <AdminUsersPage />;
  }

  if (subPath === '/cohorts') {
    return <AdminCohortsPage />;
  }

  if (subPath === '/settings') {
    return <AdminSettingsPage />;
  }

  return <NotFoundPage />;
}

function AppContent(): JSX.Element {
  const { user, initializing } = useAuth();
  const { path, navigate } = useRouter();

  useEffect(() => {
    if (initializing) {
      return;
    }

    const section = path.split('/').filter(Boolean)[0] ?? '';
    const isAuthPage = ['/login', '/register', '/reset-password', '/change-password'].includes(
      path,
    );
    const isProtectedSection = ['student', 'professor', 'admin'].includes(section);

    if (path === '/dashboard') {
      navigate(user ? roleHomePath(user.role) : '/login', { replace: true });
      return;
    }

    if (isAuthPage && user) {
      navigate(roleHomePath(user.role), { replace: true });
      return;
    }

    if (isProtectedSection && !user) {
      navigate('/login', { replace: true });
      return;
    }

    if (isProtectedSection && user && section !== user.role) {
      navigate(roleHomePath(user.role), { replace: true });
    }
  }, [initializing, navigate, path, user]);

  if (initializing) {
    return <FullPageLoader />;
  }

  if (path === '/') {
    return <LandingPage />;
  }

  if (path === '/login') {
    return <LoginPage />;
  }

  if (path === '/register') {
    return <RegisterPage />;
  }

  if (path === '/reset-password') {
    return <ResetPasswordPage />;
  }

  if (path === '/change-password') {
    return <ChangePasswordPage />;
  }

  if (path.startsWith('/student')) {
    return (
      <AppShell
        title="Student Workspace"
        navItems={[
          { to: '/student', label: 'Thesis' },
          { to: '/student/submissions', label: 'Submissions' },
          { to: '/student/mock-viva', label: 'Mock Viva' },
          { to: '/student/history', label: 'History' },
          { to: '/student/settings', label: 'Settings' },
        ]}
      >
        {renderStudentRoute(path)}
      </AppShell>
    );
  }

  if (path.startsWith('/professor')) {
    return (
      <AppShell
        title="Professor Workspace"
        navItems={[
          { to: '/professor', label: 'Dashboard' },
          { to: '/professor/students', label: 'Students' },
          { to: '/professor/milestones', label: 'Milestones' },
          { to: '/professor/analytics', label: 'Analytics' },
        ]}
      >
        {renderProfessorRoute(path)}
      </AppShell>
    );
  }

  if (path.startsWith('/admin')) {
    return (
      <AppShell
        title="Admin Workspace"
        lockedMessage="Admin tooling is restricted. First admin user must be seeded manually."
        navItems={[
          { to: '/admin', label: 'Users' },
          { to: '/admin/cohorts', label: 'Cohorts' },
          { to: '/admin/settings', label: 'Settings' },
        ]}
      >
        {renderAdminRoute(path)}
      </AppShell>
    );
  }

  return <NotFoundPage />;
}

export default function App(): JSX.Element {
  return (
    <RouterProvider>
      <AuthProvider>
        <AppContent />
      </AuthProvider>
    </RouterProvider>
  );
}
