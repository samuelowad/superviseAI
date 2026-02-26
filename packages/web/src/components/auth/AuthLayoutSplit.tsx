import type { PropsWithChildren } from 'react';
import { Link } from '../../lib/router';

interface AuthLayoutSplitProps {
  title: string;
  subtitle: string;
  panelQuote: string;
  panelAuthor?: string;
}

const FEATURES = [
  'AI-powered thesis tracking',
  'Citation & plagiarism analysis',
  'Structured supervision workflows',
];

export function AuthLayoutSplit({
  title,
  subtitle,
  panelQuote,
  panelAuthor,
  children,
}: PropsWithChildren<AuthLayoutSplitProps>): JSX.Element {
  return (
    <div className="auth-split-page">
      {/* ── branded left panel ── */}
      <aside className="auth-split-left">
        <div className="auth-left-content">
          <Link to="/" className="auth-left-logo">
            <span className="auth-left-mark" aria-hidden>
              SA
            </span>
            <span className="auth-left-wordmark">SuperviseAI</span>
          </Link>

          <div className="auth-left-hero">
            <h1>Smarter thesis supervision starts here</h1>
            <ul className="auth-left-features">
              {FEATURES.map((f) => (
                <li key={f}>
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
                    <circle cx="8" cy="8" r="8" fill="rgba(255,255,255,0.15)" />
                    <path
                      d="M5 8l2 2 4-4"
                      stroke="#fff"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  {f}
                </li>
              ))}
            </ul>
          </div>

          <blockquote className="auth-left-quote">
            <p>"{panelQuote}"</p>
            {panelAuthor && <footer>— {panelAuthor}</footer>}
          </blockquote>
        </div>
      </aside>

      {/* ── form side ── */}
      <section className="auth-split-right">
        <div className="auth-card">
          <h2>{title}</h2>
          <p className="auth-card-subtitle">{subtitle}</p>
          {children}
        </div>
      </section>
    </div>
  );
}
