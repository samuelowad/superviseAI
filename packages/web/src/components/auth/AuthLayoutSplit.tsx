import type { PropsWithChildren } from 'react';
import { Link } from '../../lib/router';

interface AuthLayoutSplitProps {
  title: string;
  subtitle: string;
  panelQuote: string;
}

export function AuthLayoutSplit({
  title,
  subtitle,
  panelQuote,
  children,
}: PropsWithChildren<AuthLayoutSplitProps>): JSX.Element {
  return (
    <div className="auth-split-page">
      <aside className="auth-split-left">
        <div className="auth-left-mark" aria-hidden>
          SA
        </div>
        <p className="auth-left-overline">Academic AI Platform</p>
        <h1>SuperviseAI</h1>
        <p>{panelQuote}</p>
        <Link className="auth-left-link" to="/">
          Back to landing page
        </Link>
      </aside>

      <section className="auth-split-right">
        <div className="auth-card">
          <h2>{title}</h2>
          <p>{subtitle}</p>
          {children}
        </div>
      </section>
    </div>
  );
}
