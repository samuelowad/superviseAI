import type { PropsWithChildren } from 'react';

import { useAuth } from '../../auth/AuthContext';
import { roleHomePath } from '../../auth/routes';
import { NavLink } from '../../lib/router';

interface NavItem {
  to: string;
  label: string;
  icon?: string;
}

interface AppShellProps {
  title: string;
  navItems: NavItem[];
  lockedMessage?: string;
}

function avatarInitials(name?: string): string {
  if (!name) return '?';
  return name
    .split(' ')
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
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
      {/* ── Sidebar ── */}
      <aside className="shell-sidebar">
        <NavLink className="shell-logo" to={roleHomePath(user?.role ?? 'student')}>
          <span className="shell-logo-mark" aria-hidden>
            SA
          </span>
          <span>SuperviseAI</span>
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

        <div className="shell-sidebar-footer">
          <div className="shell-user-chip">
            <span className="shell-avatar">{avatarInitials(user?.full_name)}</span>
            <div className="shell-user-meta">
              <span className="shell-user-name">{user?.full_name}</span>
              <span className="shell-user-role">{user?.role}</span>
            </div>
          </div>
          <button type="button" className="btn btn-ghost btn-sm shell-logout" onClick={logout}>
            Sign out
          </button>
        </div>
      </aside>

      {/* ── Main content ── */}
      <div className="shell-content-wrap">
        <header className="shell-topbar">
          <h1 className="shell-topbar-title">{title}</h1>
        </header>

        {lockedMessage ? <p className="locked-banner">{lockedMessage}</p> : null}

        <main className="shell-main">{children}</main>
      </div>
    </div>
  );
}
