import type { PropsWithChildren } from 'react';

import { useAuth } from '../../auth/AuthContext';
import { roleHomePath } from '../../auth/routes';
import { NavLink } from '../../lib/router';

interface NavItem {
  to: string;
  label: string;
}

interface AppShellProps {
  title: string;
  navItems: NavItem[];
  lockedMessage?: string;
}

export function AppShell({
  title,
  navItems,
  lockedMessage,
  children,
}: PropsWithChildren<AppShellProps>): JSX.Element {
  const { user, logout } = useAuth();

  return (
    <div className="shell-root">
      <aside className="shell-sidebar">
        <NavLink className="shell-logo" to={roleHomePath(user?.role ?? 'student')}>
          SuperviseAI
        </NavLink>

        <nav className="shell-nav" aria-label="Main navigation">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to.split('/').length <= 2}
              className={({ isActive }) => `shell-nav-link ${isActive ? 'active' : ''}`}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        <button type="button" className="btn btn-ghost shell-logout" onClick={logout}>
          Logout
        </button>
      </aside>

      <div className="shell-content-wrap">
        <header className="shell-topbar">
          <div>
            <p className="shell-topbar-title">{title}</p>
            <p className="shell-topbar-subtitle">{user?.full_name}</p>
          </div>
          <span className="role-pill">{user?.role}</span>
        </header>

        {lockedMessage ? <p className="locked-banner">{lockedMessage}</p> : null}

        <main className="shell-main">{children}</main>
      </div>
    </div>
  );
}
