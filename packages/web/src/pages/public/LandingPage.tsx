import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from '../../lib/router';
import { useAuth } from '../../auth/AuthContext';
import { roleHomePath } from '../../auth/routes';

/* ───── scroll-reveal hook ───── */
function useReveal<T extends HTMLElement>(): React.RefObject<T> {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          el.classList.add('lp-revealed');
          io.unobserve(el);
        }
      },
      { threshold: 0.15 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return ref;
}

/* ───── animated counter hook ───── */
function useCounter(target: number, duration = 1200): number {
  const [value, setValue] = useState(0);
  useEffect(() => {
    let start: number | null = null;
    let raf: number;
    const step = (ts: number) => {
      if (!start) start = ts;
      const progress = Math.min((ts - start) / duration, 1);
      setValue(Math.round(progress * target));
      if (progress < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return value;
}

/* ───── smooth scroll helper ───── */
function scrollToId(id: string): void {
  const el = document.getElementById(id);
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* ───── icon components ───── */
function IconThesisTrack() {
  return (
    <svg
      width="28"
      height="28"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
      <path d="M14 2v6h6" />
      <path d="M9 15l2 2 4-4" />
    </svg>
  );
}

function IconCitation() {
  return (
    <svg
      width="28"
      height="28"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20" />
      <path d="M8 7h6" />
      <path d="M8 11h8" />
    </svg>
  );
}

function IconViva() {
  return (
    <svg
      width="28"
      height="28"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="22" />
    </svg>
  );
}

function IconPlagiarism() {
  return (
    <svg
      width="28"
      height="28"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
      <path d="M9 12l2 2 4-4" />
    </svg>
  );
}

function IconArrowRight() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5 12h14" />
      <path d="m12 5 7 7-7 7" />
    </svg>
  );
}

function IconCheck() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function IconStudent() {
  return (
    <svg
      width="28"
      height="28"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M22 10v6M2 10l10-5 10 5-10 5z" />
      <path d="M6 12v5c3 3 9 3 12 0v-5" />
    </svg>
  );
}

function IconProfessor() {
  return (
    <svg
      width="28"
      height="28"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <path d="M8 21h8" />
      <path d="M12 17v4" />
      <path d="M7 8h2m2 0h2m2 0h2" />
      <path d="M7 12h10" />
    </svg>
  );
}

/* ───── data ───── */
const AUDIENCES = [
  {
    icon: <IconStudent />,
    role: 'For Students',
    points: [
      'Upload drafts and get instant AI progress scoring',
      'Practice your defense with adaptive Mock Viva coaching',
      'Track citation health and plagiarism across versions',
      'See exactly what changed between each draft iteration',
    ],
  },
  {
    icon: <IconProfessor />,
    role: 'For Professors',
    points: [
      'Dashboard with risk-flagged student overview',
      'Side-by-side PDF and text diff for every version',
      'Set milestones and track cohort-wide completion',
      'One-click feedback, revision requests, and approvals',
    ],
  },
] as const;

const FEATURES = [
  {
    icon: <IconThesisTrack />,
    title: 'ThesisTrack™',
    desc: 'AI-driven structure analysis and progress scoring across every draft version. Know exactly where you stand.',
  },
  {
    icon: <IconCitation />,
    title: 'Citation Validator',
    desc: 'Three-layer reference checking — regex cross-matching, GPT formatting analysis, and Semantic Scholar verification.',
  },
  {
    icon: <IconViva />,
    title: 'Mock Viva Coach',
    desc: 'Practice your defense with AI-generated examiner questions, voice interaction, and readiness scoring.',
  },
  {
    icon: <IconPlagiarism />,
    title: 'Plagiarism Monitor',
    desc: 'Asynchronous originality analysis with detailed flagged passage reports and trend tracking across versions.',
  },
] as const;

const STEPS = [
  {
    num: '01',
    title: 'Create your account',
    desc: 'Sign up as a student or professor in seconds.',
  },
  {
    num: '02',
    title: 'Upload your draft',
    desc: 'Submit your thesis as PDF or DOCX. We handle the rest.',
  },
  {
    num: '03',
    title: 'Get AI insights',
    desc: 'Progress score, gap analysis, citations, and plagiarism — all at once.',
  },
  {
    num: '04',
    title: 'Coach & defend',
    desc: 'Practice your viva with AI coaching and strengthen weak areas.',
  },
] as const;

/* ───── main component ───── */
export function LandingPage(): JSX.Element {
  const { user } = useAuth();
  const [scrolled, setScrolled] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const handleNavClick = useCallback((e: React.MouseEvent<HTMLAnchorElement>, id: string) => {
    e.preventDefault();
    setMobileMenuOpen(false);
    scrollToId(id);
  }, []);

  const progress = useCounter(74);
  const citations = useCounter(92);
  const viva = useCounter(68);

  const featuresRef = useReveal<HTMLDivElement>();
  const howRef = useReveal<HTMLDivElement>();
  const audienceRef = useReveal<HTMLDivElement>();

  return (
    <div className="lp">
      {/* ── NAV ── */}
      <header className={`lp-nav${scrolled ? ' lp-nav--scrolled' : ''}`}>
        <div className="lp-nav-inner">
          <Link to="/" className="lp-logo">
            <span className="lp-logo-mark">S</span>
            <span className="lp-logo-text">SuperviseAI</span>
          </Link>

          <nav className="lp-links" aria-label="Main navigation">
            <a href="#features" onClick={(e) => handleNavClick(e, 'features')}>
              Features
            </a>
            <a href="#who-its-for" onClick={(e) => handleNavClick(e, 'who-its-for')}>
              Who it's for
            </a>
            <a href="#how-it-works" onClick={(e) => handleNavClick(e, 'how-it-works')}>
              How it works
            </a>
          </nav>

          <div className="lp-auth">
            <Link className="btn btn-ghost btn-sm" to={user ? roleHomePath(user.role) : '/login'}>
              {user ? 'Dashboard' : 'Sign in'}
            </Link>
            <Link
              className="btn btn-primary btn-sm"
              to={user ? roleHomePath(user.role) : '/register'}
            >
              {user ? 'Open app' : 'Get started free'}
            </Link>
          </div>

          <button
            type="button"
            className="lp-hamburger"
            aria-label={mobileMenuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={mobileMenuOpen}
            onClick={() => setMobileMenuOpen((v) => !v)}
          >
            <span className={`lp-hamburger-bar${mobileMenuOpen ? ' open' : ''}`} />
          </button>
        </div>

        {mobileMenuOpen && (
          <nav className="lp-mobile-menu" aria-label="Mobile navigation">
            <a href="#features" onClick={(e) => handleNavClick(e, 'features')}>
              Features
            </a>
            <a href="#who-its-for" onClick={(e) => handleNavClick(e, 'who-its-for')}>
              Who it's for
            </a>
            <a href="#how-it-works" onClick={(e) => handleNavClick(e, 'how-it-works')}>
              How it works
            </a>
            <div className="lp-mobile-menu-auth">
              <Link
                className="btn btn-ghost btn-sm btn-full"
                to={user ? roleHomePath(user.role) : '/login'}
              >
                {user ? 'Dashboard' : 'Sign in'}
              </Link>
              <Link
                className="btn btn-primary btn-sm btn-full"
                to={user ? roleHomePath(user.role) : '/register'}
              >
                {user ? 'Open app' : 'Get started free'}
              </Link>
            </div>
          </nav>
        )}
      </header>

      {/* ── HERO ── */}
      <section className="lp-hero">
        <div className="lp-hero-inner">
          <div className="lp-hero-copy">
            <div className="lp-pill">AI-Powered Academic Platform</div>
            <h1>
              Stay on track.
              <br />
              <span className="lp-hero-accent">Finish your thesis</span> with confidence.
            </h1>
            <p className="lp-hero-sub">
              Upload drafts, get actionable feedback, validate citations, check originality, and
              practice your defense — all in one intelligent platform built for students and
              supervisors.
            </p>
            <div className="lp-hero-ctas">
              <Link className="btn btn-primary btn-lg" to="/register">
                Get started free
                <IconArrowRight />
              </Link>
              <a
                className="btn btn-muted btn-lg"
                href="#how-it-works"
                onClick={(e) => handleNavClick(e, 'how-it-works')}
              >
                See how it works
              </a>
            </div>
            <div className="lp-hero-trust">
              <div className="lp-trust-checks">
                <span>
                  <IconCheck /> Free for students
                </span>
                <span>
                  <IconCheck /> No AI API keys needed
                </span>
                <span>
                  <IconCheck /> Results in minutes
                </span>
              </div>
            </div>
          </div>

          <div className="lp-hero-visual">
            <div className="lp-dash-preview">
              <div className="lp-dash-header">
                <div className="lp-dash-dots">
                  <span />
                  <span />
                  <span />
                </div>
                <span className="lp-dash-title">Thesis Workspace</span>
              </div>
              <div className="lp-dash-body">
                <div className="lp-metric lp-metric--main">
                  <span className="lp-metric-label">Progress Score</span>
                  <span className="lp-metric-value">{progress}%</span>
                  <div className="lp-metric-bar">
                    <div className="lp-metric-fill" style={{ width: `${progress}%` }} />
                  </div>
                  <span className="lp-metric-trend lp-metric-trend--up">↑ 12% vs last draft</span>
                </div>
                <div className="lp-metrics-row">
                  <div className="lp-metric lp-metric--sm">
                    <span className="lp-metric-label">Citation Health</span>
                    <span className="lp-metric-value">{citations}%</span>
                    <span className="lp-metric-sub">3 issues auto-detected</span>
                  </div>
                  <div className="lp-metric lp-metric--sm">
                    <span className="lp-metric-label">Viva Readiness</span>
                    <span className="lp-metric-value">{viva}%</span>
                    <span className="lp-metric-sub">AI coaching score</span>
                  </div>
                </div>
                <div className="lp-plag-badge">
                  <span className="lp-plag-dot" />
                  Plagiarism: <strong>Clear — 97% original</strong>
                </div>
              </div>
            </div>

            {/* floating chips */}
            <div className="lp-chip lp-chip-1">📊 Real-Time Tracking</div>
            <div className="lp-chip lp-chip-2">🔍 Gap Analysis</div>
            <div className="lp-chip lp-chip-3">📎 Citation Check</div>
          </div>
        </div>
      </section>

      {/* ── FEATURES ── */}
      <section id="features" className="lp-features">
        <div className="lp-section-header">
          <div className="lp-pill">Core Modules</div>
          <h2>Everything you need to supervise and complete your thesis</h2>
          <p>
            Four integrated modules that cover the entire thesis lifecycle — from first draft to
            final defense.
          </p>
        </div>
        <div className="lp-feature-grid lp-reveal" ref={featuresRef}>
          {FEATURES.map((f) => (
            <article key={f.title} className="lp-feature-card">
              <div className="lp-feature-icon">{f.icon}</div>
              <h3>{f.title}</h3>
              <p>{f.desc}</p>
            </article>
          ))}
        </div>
      </section>

      {/* ── WHO IT'S FOR ── */}
      <section id="who-its-for" className="lp-audience">
        <div className="lp-section-header">
          <div className="lp-pill">Built for Both Sides</div>
          <h2>Designed for students and supervisors</h2>
          <p>
            Whether you're writing your thesis or reviewing one, SuperviseAI gives you the tools to
            move faster and with more clarity.
          </p>
        </div>
        <div className="lp-audience-grid lp-reveal" ref={audienceRef}>
          {AUDIENCES.map((a) => (
            <article key={a.role} className="lp-audience-card">
              <div className="lp-audience-icon">{a.icon}</div>
              <h3>{a.role}</h3>
              <ul>
                {a.points.map((p) => (
                  <li key={p}>
                    <IconCheck />
                    {p}
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </section>

      {/* ── HOW IT WORKS ── */}
      <section id="how-it-works" className="lp-how">
        <div className="lp-section-header">
          <div className="lp-pill">Simple Process</div>
          <h2>From upload to defense in four steps</h2>
        </div>
        <div className="lp-steps lp-reveal" ref={howRef}>
          {STEPS.map((s, i) => (
            <div key={s.num} className="lp-step">
              <div className="lp-step-num">{s.num}</div>
              <h3>{s.title}</h3>
              <p>{s.desc}</p>
              {i < STEPS.length - 1 && <div className="lp-step-connector" />}
            </div>
          ))}
        </div>
      </section>

      {/* ── CTA BAND ── */}
      <section className="lp-cta-band">
        <h2>Ready to accelerate your thesis journey?</h2>
        <p>Upload your first draft and get AI-powered feedback in minutes — completely free.</p>
        <div className="lp-cta-band-actions">
          <Link className="btn btn-primary btn-lg" to="/register">
            Create free account <IconArrowRight />
          </Link>
        </div>
      </section>

      {/* ── FOOTER ── */}
      <footer className="lp-footer">
        <div className="lp-footer-inner">
          <div className="lp-footer-brand">
            <span className="lp-logo-mark">S</span>
            <span className="lp-logo-text">SuperviseAI</span>
            <p>AI-powered thesis supervision for the modern university.</p>
          </div>
          <div className="lp-footer-col">
            <h4>Product</h4>
            <a href="#features" onClick={(e) => handleNavClick(e, 'features')}>
              Features
            </a>
            <a href="#who-its-for" onClick={(e) => handleNavClick(e, 'who-its-for')}>
              Who it's for
            </a>
            <a href="#how-it-works" onClick={(e) => handleNavClick(e, 'how-it-works')}>
              How it works
            </a>
          </div>
          <div className="lp-footer-col">
            <h4>Account</h4>
            <Link to="/login">Sign in</Link>
            <Link to="/register">Create account</Link>
          </div>
          <div className="lp-footer-col">
            <h4>Legal</h4>
            <a href="#privacy">Privacy policy</a>
            <a href="#terms">Terms of service</a>
          </div>
        </div>
        <div className="lp-footer-bottom">
          <p>© 2026 SuperviseAI. Built with purpose for academic excellence.</p>
        </div>
      </footer>
    </div>
  );
}
