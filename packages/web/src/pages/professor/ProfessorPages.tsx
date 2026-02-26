import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.js?url';

import { getAccessToken } from '../../auth/storage';
import { apiRequest } from '../../lib/api';
import { Link } from '../../lib/router';

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const API_BASE =
  (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3000/api/v1';

interface ProfessorStudentRow {
  thesis_id: string;
  thesis_title: string;
  thesis_status: string;
  thesis_status_label: string;
  student_id: string;
  student_name: string;
  student_email: string | null;
  progress_score: number;
  trend_delta: number;
  plagiarism_similarity: number;
  last_submission_at: string | null;
  risk_level: 'green' | 'yellow' | 'red';
  risk_reasons: string[];
}

interface ProfessorDashboardResponse {
  summary: {
    total_students: number;
    active_theses: number;
    awaiting_review: number;
    at_risk_count: number;
  };
  students: ProfessorStudentRow[];
}

interface MilestoneRecord {
  id: string;
  title: string;
  stage: string;
  due_date: string;
  due_in_days: number | null;
  created_at: string;
  updated_at: string;
}

interface MilestonesResponse {
  milestones: MilestoneRecord[];
}

interface ProfessorAnalyticsResponse {
  totals: {
    supervised_students: number;
    average_progress_score: number;
    at_risk_count: number;
  };
  risk_distribution: {
    green: number;
    yellow: number;
    red: number;
  };
  progress_trend: Array<{
    date: string;
    average_progress: number;
    samples: number;
  }>;
  submission_activity: Array<{
    date: string;
    submissions: number;
  }>;
  at_risk_students: Array<{
    thesis_id: string;
    student_name: string;
    thesis_title: string;
    risk_level: 'green' | 'yellow' | 'red';
    risk_reasons: string[];
  }>;
}

interface ProfessorStudentDetailResponse {
  student: {
    id: string;
    full_name: string;
    email: string | null;
  };
  thesis: {
    id: string;
    title: string;
    abstract: string | null;
    status: string;
    status_label: string;
    latest_professor_feedback: string | null;
    latest_feedback_at: string | null;
  };
  latest_submission: {
    id: string;
    version_number: number;
    status: string;
    created_at: string;
  } | null;
  metrics: {
    progress_score: number;
    trend_delta: number;
    citation_health_score: number;
    plagiarism_similarity: number;
    readiness_score: number | null;
  };
  reports: {
    citations: {
      issues_count: number;
      missing_citations: string[];
      broken_references: string[];
      formatting_errors: string[];
    };
    plagiarism: {
      risk_level: 'green' | 'yellow' | 'red';
      flagged_sections: string[];
    };
  };
  history: {
    progress: Array<{
      version_number: number;
      progress_score: number;
      trend_delta: number;
      created_at: string;
    }>;
    plagiarism: Array<{
      version_number: number;
      similarity_percent: number;
      risk_level: 'green' | 'yellow' | 'red';
      created_at: string;
    }>;
    timeline: Array<{
      id: string;
      label: string;
      timestamp: string;
      type: 'status' | 'submission' | 'feedback';
    }>;
  };
  comparison: null | {
    previous_version: number;
    current_version: number;
    additions: number;
    deletions: number;
    major_edits: number;
    pr_diff: {
      capability: 'ready' | 'parser_missing' | 'binary_detected' | 'no_content';
      message: string | null;
      rows: Array<{
        type: 'context' | 'addition' | 'removal';
        left_line: number | null;
        right_line: number | null;
        left_text: string;
        right_text: string;
      }>;
      stats: {
        additions: number;
        removals: number;
        unchanged: number;
        truncated: boolean;
      };
    };
    pdf_view?: {
      previous_pdf_url: string | null;
      current_pdf_url: string | null;
      changes: Array<{
        id: string;
        label: string;
        type: 'addition' | 'removal' | 'edit';
        preview: string;
      }>;
    };
  };
  submissions: Array<{
    id: string;
    version_number: number;
    status: string;
    created_at: string;
  }>;
}

interface MilestoneDraft {
  title: string;
  stage: string;
  due_date: string;
}

function formatDate(value: string | null): string {
  if (!value) {
    return 'N/A';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString();
}

function formatDateOnly(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleDateString();
}

function statusTone(status: string): 'info' | 'success' | 'warning' {
  if (status === 'Completed') {
    return 'success';
  }

  if (status === 'Awaiting Review' || status === 'Returned') {
    return 'warning';
  }

  return 'info';
}

function riskClass(risk: 'green' | 'yellow' | 'red'): string {
  if (risk === 'red') {
    return 'risk-red';
  }

  if (risk === 'yellow') {
    return 'risk-yellow';
  }

  return 'risk-green';
}

function PdfViewer({ path, title }: { path: string; title: string }): JSX.Element {
  const [numPages, setNumPages] = useState(0);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [pageWidth, setPageWidth] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      setPageWidth(Math.floor(entry.contentRect.width) - 16);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    let objectUrl: string | null = null;
    const token = getAccessToken();

    fetch(`${API_BASE}${path}`, {
      headers: { Authorization: `Bearer ${token ?? ''}` },
    })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.blob();
      })
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob);
        setBlobUrl(objectUrl);
      })
      .catch(() => setLoadError(true));

    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [path]);

  if (loadError) return <div className="pdf-viewer-error">Could not load PDF.</div>;
  if (!blobUrl) return <div className="pdf-viewer-loading">Loading PDF…</div>;

  return (
    <div className="pdf-viewer-scroll" ref={scrollRef} aria-label={title}>
      <Document
        file={blobUrl}
        onLoadSuccess={({ numPages: n }) => setNumPages(n)}
        loading={<div className="pdf-viewer-loading">Rendering…</div>}
        error={<div className="pdf-viewer-error">Could not render PDF.</div>}
      >
        {Array.from({ length: numPages }, (_, i) => (
          <Page
            key={i + 1}
            pageNumber={i + 1}
            width={pageWidth > 0 ? pageWidth : undefined}
            renderAnnotationLayer
            renderTextLayer
          />
        ))}
      </Document>
    </div>
  );
}

function ResizableSplitView({
  left,
  right,
}: {
  left: JSX.Element;
  right: JSX.Element;
}): JSX.Element {
  const [splitPct, setSplitPct] = useState(50);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const raw = ((e.clientX - rect.left) / rect.width) * 100;
      setSplitPct(Math.max(20, Math.min(80, raw)));
    };
    const onUp = () => {
      dragging.current = false;
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className="pdf-split-container"
      style={{ gridTemplateColumns: `${splitPct}% 6px 1fr` }}
    >
      <div className="pdf-split-pane">{left}</div>
      <div
        className="pdf-resize-handle"
        onMouseDown={() => {
          dragging.current = true;
        }}
        role="separator"
        aria-label="Drag to resize panels"
      />
      <div className="pdf-split-pane">{right}</div>
    </div>
  );
}

function LoadingCard({ message }: { message: string }): JSX.Element {
  return (
    <section className="placeholder-card">
      <h2>{message}</h2>
    </section>
  );
}

function ErrorCard({ message }: { message: string }): JSX.Element {
  return (
    <section className="placeholder-card">
      <h2>Something went wrong</h2>
      <p>{message}</p>
    </section>
  );
}

export function ProfessorDashboardPage(): JSX.Element {
  const [data, setData] = useState<ProfessorDashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    const load = async (): Promise<void> => {
      setLoading(true);
      setError(null);
      try {
        const response = await apiRequest<ProfessorDashboardResponse>('/dashboard/professor');
        if (!active) {
          return;
        }
        setData(response);
      } catch (err) {
        if (!active) {
          return;
        }
        setError(err instanceof Error ? err.message : 'Failed to load dashboard.');
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    void load();

    return () => {
      active = false;
    };
  }, []);

  if (loading) {
    return <LoadingCard message="Loading professor dashboard..." />;
  }

  if (error || !data) {
    return <ErrorCard message={error ?? 'Professor dashboard is unavailable.'} />;
  }

  return (
    <div className="professor-page-grid">
      <section className="workspace-metrics-grid">
        <article className="metric-card metric-primary">
          <h3>Total Students</h3>
          <p className="metric-value">{data.summary.total_students}</p>
          <p>Assigned to you</p>
        </article>
        <article className="metric-card">
          <h3>Active Theses</h3>
          <p className="metric-value">{data.summary.active_theses}</p>
          <p>Not marked complete</p>
        </article>
        <article className="metric-card">
          <h3>Awaiting Review</h3>
          <p className="metric-value">{data.summary.awaiting_review}</p>
          <p>Need your decision</p>
        </article>
        <article className="metric-card">
          <h3>At-Risk</h3>
          <p className="metric-value">{data.summary.at_risk_count}</p>
          <p>Needs intervention</p>
        </article>
      </section>

      <section className="placeholder-card">
        <div className="professor-section-header">
          <h2>Student Review Queue</h2>
          <Link className="btn btn-ghost" to="/professor/students">
            Open Full Students View
          </Link>
        </div>

        {data.students.length === 0 ? (
          <p>No assigned students yet.</p>
        ) : (
          <table className="simple-table">
            <thead>
              <tr>
                <th>Student</th>
                <th>Thesis</th>
                <th>Progress</th>
                <th>Plagiarism</th>
                <th>Last Submission</th>
                <th>Status</th>
                <th>Risk</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {data.students.slice(0, 10).map((student) => (
                <tr key={student.thesis_id}>
                  <td>
                    <strong>{student.student_name}</strong>
                    <br />
                    <small>{student.student_email ?? 'No email'}</small>
                  </td>
                  <td>{student.thesis_title}</td>
                  <td>
                    {student.progress_score}%{' '}
                    <small className={student.trend_delta >= 0 ? 'trend-up' : 'trend-down'}>
                      {student.trend_delta >= 0 ? '+' : ''}
                      {student.trend_delta}
                    </small>
                  </td>
                  <td>{student.plagiarism_similarity}%</td>
                  <td>{formatDate(student.last_submission_at)}</td>
                  <td>
                    <span className={`status-pill ${statusTone(student.thesis_status_label)}`}>
                      {student.thesis_status_label}
                    </span>
                  </td>
                  <td>
                    <span className={`risk-dot ${riskClass(student.risk_level)}`} />
                    {student.risk_level.toUpperCase()}
                  </td>
                  <td>
                    <Link className="btn btn-muted" to={`/professor/student/${student.thesis_id}`}>
                      Review
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

export function ProfessorStudentsPage(): JSX.Element {
  const [students, setStudents] = useState<ProfessorStudentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    let active = true;

    const load = async (): Promise<void> => {
      setLoading(true);
      setError(null);
      try {
        const response = await apiRequest<{ students: ProfessorStudentRow[] }>(
          '/dashboard/professor/students',
        );
        if (!active) {
          return;
        }
        setStudents(response.students);
      } catch (err) {
        if (!active) {
          return;
        }
        setError(err instanceof Error ? err.message : 'Failed to load students.');
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    void load();

    return () => {
      active = false;
    };
  }, []);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return students;
    }

    return students.filter((student) => {
      return (
        student.student_name.toLowerCase().includes(normalized) ||
        student.thesis_title.toLowerCase().includes(normalized) ||
        student.thesis_status_label.toLowerCase().includes(normalized)
      );
    });
  }, [query, students]);

  if (loading) {
    return <LoadingCard message="Loading students..." />;
  }

  if (error) {
    return <ErrorCard message={error} />;
  }

  return (
    <div className="professor-page-grid">
      <section className="placeholder-card">
        <div className="professor-section-header">
          <h2>Assigned Students</h2>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="text-field professor-search"
            placeholder="Search by student, thesis, status"
          />
        </div>

        {filtered.length === 0 ? (
          <p>No students matched your search.</p>
        ) : (
          <table className="simple-table">
            <thead>
              <tr>
                <th>Student</th>
                <th>Thesis</th>
                <th>Status</th>
                <th>Progress</th>
                <th>Trend</th>
                <th>Risk</th>
                <th>Reasons</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((student) => (
                <tr key={student.thesis_id}>
                  <td>
                    <strong>{student.student_name}</strong>
                    <br />
                    <small>{student.student_email ?? 'No email'}</small>
                  </td>
                  <td>{student.thesis_title}</td>
                  <td>
                    <span className={`status-pill ${statusTone(student.thesis_status_label)}`}>
                      {student.thesis_status_label}
                    </span>
                  </td>
                  <td>{student.progress_score}%</td>
                  <td className={student.trend_delta >= 0 ? 'trend-up' : 'trend-down'}>
                    {student.trend_delta >= 0 ? '+' : ''}
                    {student.trend_delta}
                  </td>
                  <td>
                    <span className={`risk-dot ${riskClass(student.risk_level)}`} />
                    {student.risk_level.toUpperCase()}
                  </td>
                  <td>{student.risk_reasons.join(', ') || 'Stable'}</td>
                  <td>
                    <Link className="btn btn-muted" to={`/professor/student/${student.thesis_id}`}>
                      Open
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

export function ProfessorMilestonesPage(): JSX.Element {
  const [milestones, setMilestones] = useState<MilestoneRecord[]>([]);
  const [drafts, setDrafts] = useState<Record<string, MilestoneDraft>>({});
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [createInput, setCreateInput] = useState<MilestoneDraft>({
    title: '',
    stage: 'draft_review',
    due_date: '',
  });

  async function loadMilestones(): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      const response = await apiRequest<MilestonesResponse>('/milestones');
      setMilestones(response.milestones);
      const nextDrafts: Record<string, MilestoneDraft> = {};
      for (const milestone of response.milestones) {
        nextDrafts[milestone.id] = {
          title: milestone.title,
          stage: milestone.stage,
          due_date: milestone.due_date,
        };
      }
      setDrafts(nextDrafts);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load milestones.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadMilestones();
  }, []);

  async function handleCreate(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setCreating(true);
    setError(null);
    setNotice(null);

    try {
      await apiRequest<{ milestone: MilestoneRecord }>('/milestones', {
        method: 'POST',
        body: createInput,
      });
      setCreateInput({ title: '', stage: 'draft_review', due_date: '' });
      setNotice('Milestone created.');
      await loadMilestones();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create milestone.');
    } finally {
      setCreating(false);
    }
  }

  async function handleSave(milestoneId: string): Promise<void> {
    const draft = drafts[milestoneId];
    if (!draft) {
      return;
    }

    setSavingId(milestoneId);
    setError(null);
    setNotice(null);

    try {
      await apiRequest<{ milestone: MilestoneRecord }>(`/milestones/${milestoneId}`, {
        method: 'PATCH',
        body: draft,
      });
      setNotice('Milestone updated.');
      await loadMilestones();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update milestone.');
    } finally {
      setSavingId(null);
    }
  }

  return (
    <div className="professor-page-grid">
      <section className="placeholder-card">
        <h2>Create Milestone</h2>
        <form className="professor-form-grid" onSubmit={(event) => void handleCreate(event)}>
          <input
            className="text-field"
            placeholder="Milestone title"
            value={createInput.title}
            onChange={(event) =>
              setCreateInput((previous) => ({ ...previous, title: event.target.value }))
            }
          />
          <select
            className="text-field"
            value={createInput.stage}
            onChange={(event) =>
              setCreateInput((previous) => ({ ...previous, stage: event.target.value }))
            }
          >
            <option value="proposal">Proposal</option>
            <option value="literature_review">Literature Review</option>
            <option value="methodology">Methodology</option>
            <option value="draft_review">Draft Review</option>
            <option value="final_review">Final Review</option>
          </select>
          <input
            className="text-field"
            type="date"
            value={createInput.due_date}
            onChange={(event) =>
              setCreateInput((previous) => ({ ...previous, due_date: event.target.value }))
            }
          />
          <button type="submit" className="btn btn-primary" disabled={creating}>
            {creating ? 'Creating...' : 'Create Milestone'}
          </button>
        </form>
        {notice ? <p className="form-success">{notice}</p> : null}
        {error ? <p className="form-error">{error}</p> : null}
      </section>

      <section className="placeholder-card">
        <h2>Your Milestones</h2>
        {loading ? (
          <p>Loading milestones...</p>
        ) : milestones.length === 0 ? (
          <p>No milestones created yet.</p>
        ) : (
          <table className="simple-table">
            <thead>
              <tr>
                <th>Title</th>
                <th>Stage</th>
                <th>Due Date</th>
                <th>Due In</th>
                <th>Save</th>
              </tr>
            </thead>
            <tbody>
              {milestones.map((milestone) => {
                const draft = drafts[milestone.id] ?? {
                  title: milestone.title,
                  stage: milestone.stage,
                  due_date: milestone.due_date,
                };

                return (
                  <tr key={milestone.id}>
                    <td>
                      <input
                        className="text-field"
                        value={draft.title}
                        onChange={(event) =>
                          setDrafts((previous) => ({
                            ...previous,
                            [milestone.id]: { ...draft, title: event.target.value },
                          }))
                        }
                      />
                    </td>
                    <td>
                      <select
                        className="text-field"
                        value={draft.stage}
                        onChange={(event) =>
                          setDrafts((previous) => ({
                            ...previous,
                            [milestone.id]: { ...draft, stage: event.target.value },
                          }))
                        }
                      >
                        <option value="proposal">Proposal</option>
                        <option value="literature_review">Literature Review</option>
                        <option value="methodology">Methodology</option>
                        <option value="draft_review">Draft Review</option>
                        <option value="final_review">Final Review</option>
                      </select>
                    </td>
                    <td>
                      <input
                        className="text-field"
                        type="date"
                        value={draft.due_date}
                        onChange={(event) =>
                          setDrafts((previous) => ({
                            ...previous,
                            [milestone.id]: { ...draft, due_date: event.target.value },
                          }))
                        }
                      />
                    </td>
                    <td>
                      {milestone.due_in_days === null
                        ? 'N/A'
                        : milestone.due_in_days < 0
                          ? `${Math.abs(milestone.due_in_days)} days overdue`
                          : `${milestone.due_in_days} days`}
                    </td>
                    <td>
                      <button
                        type="button"
                        className="btn btn-muted"
                        onClick={() => {
                          void handleSave(milestone.id);
                        }}
                        disabled={savingId === milestone.id}
                      >
                        {savingId === milestone.id ? 'Saving...' : 'Save'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

export function ProfessorAnalyticsPage(): JSX.Element {
  const [data, setData] = useState<ProfessorAnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    const load = async (): Promise<void> => {
      setLoading(true);
      setError(null);
      try {
        const response = await apiRequest<ProfessorAnalyticsResponse>(
          '/dashboard/professor/analytics',
        );
        if (!active) {
          return;
        }
        setData(response);
      } catch (err) {
        if (!active) {
          return;
        }
        setError(err instanceof Error ? err.message : 'Failed to load analytics.');
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    void load();

    return () => {
      active = false;
    };
  }, []);

  if (loading) {
    return <LoadingCard message="Loading analytics..." />;
  }

  if (error || !data) {
    return <ErrorCard message={error ?? 'Analytics unavailable.'} />;
  }

  return (
    <div className="professor-page-grid">
      <section className="workspace-metrics-grid">
        <article className="metric-card metric-primary">
          <h3>Supervised Students</h3>
          <p className="metric-value">{data.totals.supervised_students}</p>
        </article>
        <article className="metric-card">
          <h3>Avg Progress</h3>
          <p className="metric-value">{data.totals.average_progress_score}%</p>
        </article>
        <article className="metric-card">
          <h3>At-Risk Students</h3>
          <p className="metric-value">{data.totals.at_risk_count}</p>
        </article>
        <article className="metric-card">
          <h3>Risk Split</h3>
          <p className="metric-value small">
            G:{data.risk_distribution.green} Y:{data.risk_distribution.yellow} R:
            {data.risk_distribution.red}
          </p>
        </article>
      </section>

      <section className="placeholder-card">
        <h2>Progress Trend</h2>
        {data.progress_trend.length === 0 ? (
          <p>No trend data yet.</p>
        ) : (
          <table className="simple-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Average Progress</th>
                <th>Samples</th>
              </tr>
            </thead>
            <tbody>
              {data.progress_trend.map((entry) => (
                <tr key={entry.date}>
                  <td>{formatDateOnly(entry.date)}</td>
                  <td>{entry.average_progress}%</td>
                  <td>{entry.samples}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="placeholder-card">
        <h2>Submission Activity</h2>
        {data.submission_activity.length === 0 ? (
          <p>No submission activity yet.</p>
        ) : (
          <table className="simple-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Submissions</th>
              </tr>
            </thead>
            <tbody>
              {data.submission_activity.map((entry) => (
                <tr key={entry.date}>
                  <td>{formatDateOnly(entry.date)}</td>
                  <td>{entry.submissions}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="placeholder-card">
        <h2>At-Risk Students</h2>
        {data.at_risk_students.length === 0 ? (
          <p>No at-risk students right now.</p>
        ) : (
          <table className="simple-table">
            <thead>
              <tr>
                <th>Student</th>
                <th>Thesis</th>
                <th>Risk</th>
                <th>Reasons</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {data.at_risk_students.map((student) => (
                <tr key={student.thesis_id}>
                  <td>{student.student_name}</td>
                  <td>{student.thesis_title}</td>
                  <td>
                    <span className={`risk-dot ${riskClass(student.risk_level)}`} />
                    {student.risk_level.toUpperCase()}
                  </td>
                  <td>{student.risk_reasons.join(', ')}</td>
                  <td>
                    <Link className="btn btn-muted" to={`/professor/student/${student.thesis_id}`}>
                      Review
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

export function ProfessorStudentDetailPage({ thesisId }: { thesisId: string }): JSX.Element {
  const [detail, setDetail] = useState<ProfessorStudentDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [feedback, setFeedback] = useState('');
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [diffTab, setDiffTab] = useState<'text' | 'pdf'>('text');

  const loadDetail = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);

    try {
      const response = await apiRequest<ProfessorStudentDetailResponse>(
        `/dashboard/professor/students/${thesisId}`,
      );
      setDetail(response);
      setFeedback(response.thesis.latest_professor_feedback ?? '');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load student detail.');
    } finally {
      setLoading(false);
    }
  }, [thesisId]);

  useEffect(() => {
    void loadDetail();
  }, [loadDetail]);

  useEffect(() => {
    const comparison = detail?.comparison;
    if (!comparison) {
      setDiffTab('text');
      return;
    }

    setDiffTab(comparison.pr_diff.capability === 'ready' ? 'text' : 'pdf');
  }, [detail?.comparison]);

  async function submitAction(
    action:
      | 'save_feedback'
      | 'return_to_student'
      | 'request_revisions'
      | 'approve_milestone'
      | 'mark_complete',
  ): Promise<void> {
    setActionLoading(action);
    setError(null);
    setNotice(null);

    try {
      await apiRequest<Record<string, unknown>>(
        `/dashboard/professor/students/${thesisId}/review`,
        {
          method: 'PATCH',
          body: {
            action,
            feedback: feedback.trim() || undefined,
          },
        },
      );
      setNotice('Review action saved.');
      await loadDetail();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not submit review action.');
    } finally {
      setActionLoading(null);
    }
  }

  if (loading) {
    return <LoadingCard message="Loading student detail..." />;
  }

  if (error || !detail) {
    return <ErrorCard message={error ?? 'Student detail unavailable.'} />;
  }

  return (
    <div className="professor-page-grid">
      <section className="workspace-header-card">
        <div>
          <p className="workspace-eyebrow">Professor Review</p>
          <h2>{detail.thesis.title}</h2>
          <p>
            {detail.student.full_name}
            <span className="divider-dot">•</span>
            {detail.student.email ?? 'No email'}
          </p>
        </div>
        <div className="workspace-header-actions">
          <span className={`status-pill ${statusTone(detail.thesis.status_label)}`}>
            {detail.thesis.status_label}
          </span>
          <Link className="btn btn-ghost" to="/professor/students">
            Back to Students
          </Link>
        </div>
      </section>

      <section className="workspace-metrics-grid">
        <article className="metric-card metric-primary">
          <h3>Progress</h3>
          <p className="metric-value">{detail.metrics.progress_score}%</p>
          <p className={detail.metrics.trend_delta >= 0 ? 'trend-up' : 'trend-down'}>
            {detail.metrics.trend_delta >= 0 ? '+' : ''}
            {detail.metrics.trend_delta} vs previous
          </p>
        </article>
        <article className="metric-card">
          <h3>Citation Health</h3>
          <p className="metric-value">{detail.metrics.citation_health_score}%</p>
          <p>{detail.reports.citations.issues_count} issues detected</p>
        </article>
        <article className="metric-card">
          <h3>Plagiarism</h3>
          <p className="metric-value">{detail.metrics.plagiarism_similarity}%</p>
          <p>{detail.reports.plagiarism.risk_level.toUpperCase()} risk</p>
        </article>
        <article className="metric-card">
          <h3>Mock Viva Readiness</h3>
          <p className="metric-value">{detail.metrics.readiness_score ?? 'N/A'}</p>
          <p>Latest coaching readiness</p>
        </article>
      </section>

      <section className="placeholder-card">
        <h2>Professor Feedback</h2>
        <textarea
          className="professor-feedback-input"
          value={feedback}
          onChange={(event) => setFeedback(event.target.value)}
          placeholder="Write actionable feedback for the student"
        />
        <div className="professor-action-row">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              void submitAction('save_feedback');
            }}
            disabled={actionLoading !== null}
          >
            {actionLoading === 'save_feedback' ? 'Saving...' : 'Save Feedback'}
          </button>
          <button
            type="button"
            className="btn btn-muted"
            onClick={() => {
              void submitAction('request_revisions');
            }}
            disabled={actionLoading !== null}
          >
            {actionLoading === 'request_revisions' ? 'Submitting...' : 'Request Revisions'}
          </button>
          <button
            type="button"
            className="btn btn-muted"
            onClick={() => {
              void submitAction('return_to_student');
            }}
            disabled={actionLoading !== null}
          >
            {actionLoading === 'return_to_student' ? 'Submitting...' : 'Return to Student'}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              void submitAction('approve_milestone');
            }}
            disabled={actionLoading !== null}
          >
            {actionLoading === 'approve_milestone' ? 'Approving...' : 'Approve Milestone'}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              void submitAction('mark_complete');
            }}
            disabled={actionLoading !== null}
          >
            {actionLoading === 'mark_complete' ? 'Completing...' : 'Mark Complete'}
          </button>
        </div>
        {notice ? <p className="form-success">{notice}</p> : null}
        {error ? <p className="form-error">{error}</p> : null}
        <p className="professor-feedback-meta">
          Last feedback update: {formatDate(detail.thesis.latest_feedback_at)}
        </p>
      </section>

      <section className="placeholder-card">
        <h2>Version Comparison</h2>
        {!detail.comparison ? (
          <p>At least two submissions are needed before version comparison appears.</p>
        ) : (
          <>
            <div className="comparison-summary-grid">
              <div>
                <strong>V{detail.comparison.previous_version}</strong>
                <span>Previous</span>
              </div>
              <div>
                <strong>V{detail.comparison.current_version}</strong>
                <span>Current</span>
              </div>
              <div>
                <strong>{detail.comparison.additions}</strong>
                <span>Additions</span>
              </div>
              <div>
                <strong>{detail.comparison.deletions}</strong>
                <span>Deletions</span>
              </div>
              <div>
                <strong>{detail.comparison.major_edits}</strong>
                <span>Major Edits</span>
              </div>
            </div>

            <div className="diff-tab-row">
              <button
                type="button"
                className={`btn ${diffTab === 'text' ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() => setDiffTab('text')}
              >
                Text Diff
              </button>
              <button
                type="button"
                className={`btn ${diffTab === 'pdf' ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() => setDiffTab('pdf')}
              >
                PDF View
              </button>
            </div>

            {diffTab === 'text' ? (
              detail.comparison.pr_diff.capability !== 'ready' ? (
                <div className="diff-empty-state">
                  <span className="diff-empty-icon" aria-hidden="true">
                    ⚠
                  </span>
                  <h4>Text diff unavailable</h4>
                  <p>
                    {detail.comparison.pr_diff.message ?? 'Diff is not available for this pair.'}
                  </p>
                  {(detail.comparison.pdf_view?.previous_pdf_url ??
                  detail.comparison.pdf_view?.current_pdf_url) ? (
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => setDiffTab('pdf')}
                    >
                      View PDFs
                    </button>
                  ) : null}
                </div>
              ) : (
                <div className="pr-diff-panel professor-diff-panel">
                  <div className="pr-diff-header">
                    <h4>Text Diff</h4>
                    <p>
                      <span className="diff-stat-add">
                        +{detail.comparison.pr_diff.stats.additions}
                      </span>{' '}
                      <span className="diff-stat-rem">
                        -{detail.comparison.pr_diff.stats.removals}
                      </span>
                    </p>
                  </div>

                  {detail.comparison.pr_diff.stats.truncated ? (
                    <p className="pr-diff-note">
                      Large document - diff is truncated for performance.
                    </p>
                  ) : null}

                  <div className="pr-diff-grid" role="table" aria-label="Professor diff view">
                    {detail.comparison.pr_diff.rows.map((row, index) => (
                      <div
                        key={`${row.type}-${index}`}
                        className={`pr-diff-row ${row.type}`}
                        role="row"
                      >
                        <span className="pr-line-no" aria-hidden="true">
                          {row.left_line ?? ''}
                        </span>
                        <pre className="pr-line-text">{row.left_text || ' '}</pre>
                        <span className="pr-line-no" aria-hidden="true">
                          {row.right_line ?? ''}
                        </span>
                        <pre className="pr-line-text">{row.right_text || ' '}</pre>
                      </div>
                    ))}
                  </div>
                </div>
              )
            ) : (
              <div className="pdf-diff-layout-full">
                <ResizableSplitView
                  left={
                    <div className="pdf-split-pane-inner">
                      <div className="pdf-frame-label">
                        <span className="pdf-frame-badge prev">Previous</span>
                        <span>Version {detail.comparison.previous_version}</span>
                      </div>
                      {detail.comparison.pdf_view?.previous_pdf_url ? (
                        <PdfViewer
                          path={detail.comparison.pdf_view.previous_pdf_url}
                          title="Previous PDF version"
                        />
                      ) : (
                        <div className="pdf-frame-unavailable">
                          PDF unavailable for previous version.
                        </div>
                      )}
                    </div>
                  }
                  right={
                    <div className="pdf-split-pane-inner">
                      <div className="pdf-frame-label">
                        <span className="pdf-frame-badge curr">Current</span>
                        <span>Version {detail.comparison.current_version}</span>
                      </div>
                      {detail.comparison.pdf_view?.current_pdf_url ? (
                        <PdfViewer
                          path={detail.comparison.pdf_view.current_pdf_url}
                          title="Current PDF version"
                        />
                      ) : (
                        <div className="pdf-frame-unavailable">
                          PDF unavailable for current version.
                        </div>
                      )}
                    </div>
                  }
                />

                {(detail.comparison.pdf_view?.changes?.filter(
                  (change) => change.type !== 'edit' || !change.preview.includes('Binary PDF'),
                ).length ?? 0) > 0 ? (
                  <div className="pdf-change-details">
                    <h4 className="pdf-changes-heading">Change Markers</h4>
                    {(detail.comparison.pdf_view?.changes ?? []).map((change) => (
                      <article
                        key={change.id}
                        id={change.id}
                        className={`change-card ${change.type}`}
                      >
                        <h5>{change.label}</h5>
                        <p>{change.preview}</p>
                      </article>
                    ))}
                  </div>
                ) : null}
              </div>
            )}
          </>
        )}
      </section>

      <section className="grid-two-columns">
        <article className="placeholder-card">
          <h2>Progress History</h2>
          {detail.history.progress.length === 0 ? (
            <p>No progress history yet.</p>
          ) : (
            <table className="simple-table">
              <thead>
                <tr>
                  <th>Version</th>
                  <th>Progress</th>
                  <th>Trend</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {detail.history.progress.map((entry) => (
                  <tr key={`progress-${entry.version_number}`}>
                    <td>V{entry.version_number}</td>
                    <td>{entry.progress_score}%</td>
                    <td className={entry.trend_delta >= 0 ? 'trend-up' : 'trend-down'}>
                      {entry.trend_delta >= 0 ? '+' : ''}
                      {entry.trend_delta}
                    </td>
                    <td>{formatDate(entry.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </article>

        <article className="placeholder-card">
          <h2>Plagiarism History</h2>
          {detail.history.plagiarism.length === 0 ? (
            <p>No plagiarism history yet.</p>
          ) : (
            <table className="simple-table">
              <thead>
                <tr>
                  <th>Version</th>
                  <th>Similarity</th>
                  <th>Risk</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {detail.history.plagiarism.map((entry) => (
                  <tr key={`plagiarism-${entry.version_number}`}>
                    <td>V{entry.version_number}</td>
                    <td>{entry.similarity_percent}%</td>
                    <td>
                      <span className={`risk-dot ${riskClass(entry.risk_level)}`} />
                      {entry.risk_level.toUpperCase()}
                    </td>
                    <td>{formatDate(entry.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </article>
      </section>

      <section className="placeholder-card">
        <h2>Version Timeline</h2>
        {detail.history.timeline.length === 0 ? (
          <p>No timeline events yet.</p>
        ) : (
          <ul className="professor-timeline">
            {detail.history.timeline.map((entry) => (
              <li key={entry.id}>
                <strong>{entry.label}</strong>
                <span>{formatDate(entry.timestamp)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
