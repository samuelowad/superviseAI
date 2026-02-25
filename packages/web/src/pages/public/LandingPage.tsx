import { Link } from '../../lib/router';

import { useAuth } from '../../auth/AuthContext';
import { roleHomePath } from '../../auth/routes';

export function LandingPage(): JSX.Element {
  const { user } = useAuth();

  return (
    <div className="landing-page">
      <header className="landing-header">
        <div className="landing-brand">SuperviseAI</div>
        <nav className="landing-nav" aria-label="Landing navigation">
          <a href="#how-it-works">How it works</a>
          <a href="#features">Features</a>
          <a href="#security">Security</a>
          <a href="#faq">FAQ</a>
        </nav>
        <div className="landing-actions">
          <Link className="btn btn-ghost" to={user ? roleHomePath(user.role) : '/login'}>
            {user ? 'Open dashboard' : 'Sign in'}
          </Link>
          <Link className="btn btn-primary" to={user ? roleHomePath(user.role) : '/register'}>
            {user ? 'Continue' : 'Create account'}
          </Link>
        </div>
      </header>

      <section className="hero-section">
        <div className="hero-copy">
          <p className="eyebrow">AI-Powered Thesis Supervision</p>
          <h1>Stay on track. Finish your thesis with confidence.</h1>
          <p>
            Upload drafts, get actionable feedback, citation checks, originality insights, and viva
            coaching in one academic platform.
          </p>
          <div className="hero-cta-row">
            <Link className="btn btn-primary" to="/register">
              Create free account
            </Link>
            <a className="btn btn-muted" href="#how-it-works">
              See how it works
            </a>
          </div>
        </div>

        <div className="hero-visual" aria-label="Dashboard preview">
          <div className="preview-card">
            <h3>Student Dashboard</h3>
            <p>Progress score: 74%</p>
            <p>Citation health: 2 issues</p>
            <p>Plagiarism badge: Pending</p>
          </div>
          <div className="stat-chip chip-1">Real-Time Progress Tracking</div>
          <div className="stat-chip chip-2">AI-Driven Gap Reports</div>
          <div className="stat-chip chip-3">Citation & Plagiarism Monitoring</div>
          <div className="stat-chip chip-4">Multi-Version Thesis Comparison</div>
        </div>
      </section>

      <section id="features" className="section-block">
        <h2>Core Platform Modules</h2>
        <div className="feature-grid">
          <article className="feature-card">
            <h3>ThesisTrack</h3>
            <p>AI-driven thesis structure and progress analysis across versions.</p>
          </article>
          <article className="feature-card">
            <h3>Citation Validator</h3>
            <p>Multi-layer reference validation with formatting and database checks.</p>
          </article>
          <article className="feature-card">
            <h3>Mock Viva Coach</h3>
            <p>Simulated academic questioning with structured readiness feedback.</p>
          </article>
        </div>
      </section>

      <section id="how-it-works" className="section-block">
        <h2>How it works</h2>
        <ol className="steps-row">
          <li>Create account</li>
          <li>Upload abstract or draft</li>
          <li>Get insights and coaching guidance</li>
        </ol>
      </section>

      <section className="section-block quote-block">
        <blockquote>
          “As a supervisor, I can monitor thesis development across my cohort in real time.”
        </blockquote>
      </section>

      <footer className="landing-footer" id="security">
        <p>SuperviseAI</p>
        <p>Academic-grade supervision workflows with role-based access and auditability.</p>
        <p id="faq">Built for the 2026 hackathon demo with production-minded architecture.</p>
      </footer>
    </div>
  );
}
