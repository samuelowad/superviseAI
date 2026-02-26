import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.js?url';

import { getAccessToken } from '../../auth/storage';
import { apiRequest } from '../../lib/api';
import { useNavigate } from '../../lib/router';

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const API_BASE =
  (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3000/api/v1';

interface WorkspaceResponse {
  thesis: null | {
    id: string;
    title: string;
    abstract: string | null;
    status: string;
    status_label: string;
    supervisor_name: string | null;
    supervisor_status: string;
  };
  active_submission: null | {
    id: string;
    version_number: number;
    status: string;
    created_at: string;
  };
  metrics: {
    progress_score: number;
    trend_delta: number;
    citation_health_score: number;
    citation_issues: number;
    plagiarism_similarity: number;
    next_milestone: string;
    due_in_days: number;
  };
  central_panel: {
    mode: 'first_submission' | 'version_comparison';
    abstract_alignment?: {
      verdict: string;
      key_topic_coverage: string[];
      missing_core_sections: string[];
      structural_readiness: string;
    };
    version_comparison?: {
      additions: number;
      deletions: number;
      major_edits: number;
      gaps_resolved: number;
      gaps_open: number;
      previous_excerpt: string;
      current_excerpt: string;
      pr_diff?: {
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
  };
  right_panel: {
    plagiarism: {
      similarity_percent: number;
      risk_level: 'green' | 'yellow' | 'red';
      flagged_sections: string[];
    };
    citations: {
      missing_citations: string[];
      broken_references: string[];
      formatting_errors: string[];
    };
    milestone: {
      next_milestone: string;
      due_in_days: number;
      status: string;
    };
    latest_professor_feedback: {
      text: string;
      timestamp: string | null;
    };
  };
  coaching_summary: null | {
    readiness_score: number | null;
    weak_topics: string[];
    updated_at: string;
  };
  submissions: Array<{
    id: string;
    version_number: number;
    status: string;
    created_at: string;
  }>;
}

interface VivaMessage {
  role: 'student' | 'assistant';
  content: string;
}

interface ProfessorSuggestion {
  id: string;
  email: string;
  full_name: string;
}

interface CreateThesisInput {
  title: string;
  abstractValue: string;
  supervisorQuery?: string;
  supervisorId?: string;
}

interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
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

function formatDate(value: string | null): string {
  if (!value) {
    return 'No timestamp';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'No timestamp';
  }

  return date.toLocaleString();
}

async function uploadSubmission(file: File): Promise<{ submission_id: string; status: string }> {
  const token = getAccessToken();
  if (!token) {
    throw new Error('You are not authenticated.');
  }

  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch(
    `${import.meta.env.VITE_API_URL ?? 'http://localhost:3000/api/v1'}/submissions/upload`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
      },
      body: formData,
    },
  );

  const payload = (await response.json()) as unknown;

  if (!response.ok) {
    const message =
      typeof payload === 'object' && payload !== null && 'message' in payload
        ? String((payload as { message?: string }).message)
        : 'Upload failed.';
    throw new Error(message);
  }

  return payload as { submission_id: string; status: string };
}

function WorkspaceHeader({
  workspace,
  onOpenUpload,
  onSendToSupervisor,
  onStartCoach,
  sending,
}: {
  workspace: WorkspaceResponse;
  onOpenUpload: () => void;
  onSendToSupervisor: () => Promise<void>;
  onStartCoach: () => void;
  sending: boolean;
}): JSX.Element | null {
  if (!workspace.thesis) {
    return null;
  }

  return (
    <section className="workspace-header-card">
      <div>
        <p className="workspace-eyebrow">Thesis Workspace</p>
        <h2>{workspace.thesis.title}</h2>
        <p>
          Supervisor: {workspace.thesis.supervisor_name ?? 'Not assigned'}
          <span className="divider-dot">•</span>
          {workspace.thesis.supervisor_status}
        </p>
      </div>

      <div className="workspace-header-actions">
        <span className={`status-pill ${statusTone(workspace.thesis.status_label)}`}>
          {workspace.thesis.status_label}
        </span>
        <button type="button" className="btn btn-ghost" onClick={onOpenUpload}>
          Upload New Version
        </button>
        <button type="button" className="btn btn-muted" onClick={onStartCoach}>
          Start CoachAI
        </button>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => {
            void onSendToSupervisor();
          }}
          disabled={sending}
        >
          {sending ? 'Sending...' : 'Send to Supervisor'}
        </button>
      </div>
    </section>
  );
}

function MetricsRow({ workspace }: { workspace: WorkspaceResponse }): JSX.Element {
  const trendClass = workspace.metrics.trend_delta >= 0 ? 'trend-up' : 'trend-down';

  return (
    <section className="workspace-metrics-grid">
      <article className="metric-card metric-primary">
        <h3>Thesis Progress Score</h3>
        <p className="metric-value">{workspace.metrics.progress_score}%</p>
        <p className={trendClass}>
          {workspace.metrics.trend_delta >= 0 ? '+' : ''}
          {workspace.metrics.trend_delta}% vs previous draft
        </p>
      </article>

      <article className="metric-card">
        <h3>Citation Health</h3>
        <p className="metric-value">{workspace.metrics.citation_health_score}%</p>
        <p>{workspace.metrics.citation_issues} issue(s) detected</p>
      </article>

      <article className="metric-card">
        <h3>Plagiarism Score</h3>
        <p className="metric-value">{workspace.metrics.plagiarism_similarity}%</p>
        <p>Similarity across detected sections</p>
      </article>

      <article className="metric-card">
        <h3>Milestone</h3>
        <p className="metric-value small">{workspace.metrics.next_milestone}</p>
        <p>Due in {workspace.metrics.due_in_days} day(s)</p>
      </article>
    </section>
  );
}

function PdfViewer({ path, title }: { path: string; title: string }): JSX.Element {
  const [numPages, setNumPages] = useState(0);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);

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
    <div className="pdf-viewer-scroll" aria-label={title}>
      <Document
        file={blobUrl}
        onLoadSuccess={({ numPages: n }) => setNumPages(n)}
        loading={<div className="pdf-viewer-loading">Rendering…</div>}
        error={<div className="pdf-viewer-error">Could not render PDF.</div>}
      >
        {Array.from({ length: numPages }, (_, i) => (
          <Page key={i + 1} pageNumber={i + 1} renderAnnotationLayer renderTextLayer />
        ))}
      </Document>
    </div>
  );
}

function CentralPanel({ workspace }: { workspace: WorkspaceResponse }): JSX.Element {
  const comparison = workspace.central_panel.version_comparison;
  const pdfView = comparison?.pdf_view;
  const [diffTab, setDiffTab] = useState<'text' | 'pdf'>(
    comparison?.pr_diff?.capability === 'ready' ? 'text' : 'pdf',
  );

  return (
    <section className="workspace-central-panel">
      {workspace.central_panel.mode === 'first_submission' ? (
        <>
          <h3>Abstract Alignment Analysis</h3>
          <p>
            Verdict:{' '}
            <strong>
              {workspace.central_panel.abstract_alignment?.verdict ?? 'insufficient_data'}
            </strong>
          </p>
          <div className="grid-two-columns">
            <div>
              <h4>Key Topic Coverage</h4>
              <ul>
                {(workspace.central_panel.abstract_alignment?.key_topic_coverage ?? []).map(
                  (item) => (
                    <li key={item}>{item}</li>
                  ),
                )}
              </ul>
            </div>
            <div>
              <h4>Missing Core Sections</h4>
              <ul>
                {(workspace.central_panel.abstract_alignment?.missing_core_sections ?? []).map(
                  (item) => (
                    <li key={item}>{item}</li>
                  ),
                )}
              </ul>
            </div>
          </div>
          <p>
            Structural readiness:{' '}
            <strong>
              {workspace.central_panel.abstract_alignment?.structural_readiness ?? 'developing'}
            </strong>
          </p>
        </>
      ) : (
        <>
          <h3>Version Comparison</h3>
          <div className="comparison-summary-grid">
            <div>
              <strong>{workspace.central_panel.version_comparison?.additions ?? 0}</strong>
              <span>Additions</span>
            </div>
            <div>
              <strong>{workspace.central_panel.version_comparison?.deletions ?? 0}</strong>
              <span>Deletions</span>
            </div>
            <div>
              <strong>{workspace.central_panel.version_comparison?.major_edits ?? 0}</strong>
              <span>Major Edits</span>
            </div>
            <div>
              <strong>{workspace.central_panel.version_comparison?.gaps_resolved ?? 0}</strong>
              <span>Gaps Resolved</span>
            </div>
            <div>
              <strong>{workspace.central_panel.version_comparison?.gaps_open ?? 0}</strong>
              <span>Gaps Open</span>
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
            comparison?.pr_diff?.capability !== 'ready' ? (
              <div className="diff-empty-state">
                <span className="diff-empty-icon" aria-hidden="true">
                  ⚠
                </span>
                <h4>Text diff unavailable</h4>
                <p>
                  {comparison?.pr_diff?.capability === 'parser_missing'
                    ? 'PDF text extraction requires pdf-parse. Upload a new version after the parser is installed to see inline diff.'
                    : (comparison?.pr_diff?.message ??
                      'Text diff is not available for this submission pair.')}
                </p>
                {(pdfView?.previous_pdf_url ?? pdfView?.current_pdf_url) ? (
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
              <div className="pr-diff-panel">
                <div className="pr-diff-header">
                  <h4>Text Diff</h4>
                  <p>
                    <span className="diff-stat-add">
                      +{comparison.pr_diff?.stats.additions ?? 0}
                    </span>
                    {' / '}
                    <span className="diff-stat-rem">
                      -{comparison.pr_diff?.stats.removals ?? 0}
                    </span>
                  </p>
                </div>

                {comparison.pr_diff?.stats.truncated ? (
                  <p className="pr-diff-note">
                    Large document — diff is truncated for performance.
                  </p>
                ) : null}

                <div className="pr-diff-grid" role="table" aria-label="Pull request style diff">
                  {(comparison.pr_diff?.rows ?? []).map((row, index) => (
                    <div
                      key={`${row.type}-${index}`}
                      className={`pr-diff-row ${row.type}`}
                      role="row"
                    >
                      <span className="pr-line-no">{row.left_line ?? ''}</span>
                      <pre className="pr-line-text">{row.left_text || ' '}</pre>
                      <span className="pr-line-no">{row.right_line ?? ''}</span>
                      <pre className="pr-line-text">{row.right_text || ' '}</pre>
                    </div>
                  ))}
                </div>
              </div>
            )
          ) : (
            <div className="pdf-diff-layout-full">
              <div className="pdf-frame-grid">
                <div className="pdf-frame-col">
                  <div className="pdf-frame-label">
                    <span className="pdf-frame-badge prev">Previous</span>
                    <span>Version {(workspace.active_submission?.version_number ?? 1) - 1}</span>
                  </div>
                  {pdfView?.previous_pdf_url ? (
                    <PdfViewer path={pdfView.previous_pdf_url} title="Previous PDF version" />
                  ) : (
                    <div className="pdf-frame-unavailable">
                      PDF unavailable for previous version.
                    </div>
                  )}
                </div>
                <div className="pdf-frame-col">
                  <div className="pdf-frame-label">
                    <span className="pdf-frame-badge curr">Current</span>
                    <span>Version {workspace.active_submission?.version_number ?? 1}</span>
                  </div>
                  {pdfView?.current_pdf_url ? (
                    <PdfViewer path={pdfView.current_pdf_url} title="Current PDF version" />
                  ) : (
                    <div className="pdf-frame-unavailable">
                      PDF unavailable for current version.
                    </div>
                  )}
                </div>
              </div>

              {(pdfView?.changes?.filter(
                (c) => c.type !== 'edit' || !c.preview.includes('Binary PDF'),
              ).length ?? 0) > 0 ? (
                <div className="pdf-change-details">
                  <h4 className="pdf-changes-heading">Change Markers</h4>
                  {(pdfView?.changes ?? []).map((change) => (
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
  );
}

function RightPanel({ workspace }: { workspace: WorkspaceResponse }): JSX.Element {
  return (
    <aside className="workspace-right-panel">
      <details open>
        <summary>Plagiarism Report</summary>
        <p>Similarity: {workspace.right_panel.plagiarism.similarity_percent}%</p>
        <p>Risk Level: {workspace.right_panel.plagiarism.risk_level}</p>
        <ul>
          {workspace.right_panel.plagiarism.flagged_sections.map((section) => (
            <li key={section}>{section}</li>
          ))}
        </ul>
      </details>

      <details>
        <summary>Citation & Reference Validator</summary>
        <p>Missing citations:</p>
        <ul>
          {workspace.right_panel.citations.missing_citations.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        <p>Broken references:</p>
        <ul>
          {workspace.right_panel.citations.broken_references.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        <p>Formatting errors:</p>
        <ul>
          {workspace.right_panel.citations.formatting_errors.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </details>

      <details>
        <summary>Milestone Tracker</summary>
        <p>{workspace.right_panel.milestone.next_milestone}</p>
        <p>Due in {workspace.right_panel.milestone.due_in_days} day(s)</p>
      </details>

      <details>
        <summary>Latest Professor Feedback</summary>
        <p>{workspace.right_panel.latest_professor_feedback.text}</p>
        <p>{formatDate(workspace.right_panel.latest_professor_feedback.timestamp)}</p>
      </details>
    </aside>
  );
}

function ProposalForm({
  loading,
  onSubmit,
}: {
  loading: boolean;
  onSubmit: (input: CreateThesisInput) => Promise<void>;
}): JSX.Element {
  const [title, setTitle] = useState('');
  const [abstractValue, setAbstractValue] = useState('');
  const [abstractSource, setAbstractSource] = useState<'paste' | 'upload'>('paste');
  const [abstractFileName, setAbstractFileName] = useState('');
  const [supervisorQuery, setSupervisorQuery] = useState('');
  const [supervisorId, setSupervisorId] = useState<string | undefined>(undefined);
  const [professorResults, setProfessorResults] = useState<ProfessorSuggestion[]>([]);
  const [searchingProfessor, setSearchingProfessor] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (supervisorId) {
      setProfessorResults([]);
      return;
    }

    const query = supervisorQuery.trim();
    if (query.length < 2) {
      setProfessorResults([]);
      return;
    }

    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          setSearchingProfessor(true);
          const response = await apiRequest<{ professors: ProfessorSuggestion[] }>(
            `/theses/professors/search?q=${encodeURIComponent(query)}`,
          );
          setProfessorResults(response.professors);
        } catch {
          setProfessorResults([]);
        } finally {
          setSearchingProfessor(false);
        }
      })();
    }, 250);

    return () => {
      window.clearTimeout(timer);
    };
  }, [supervisorId, supervisorQuery]);

  async function readAbstractFile(file: File): Promise<void> {
    if (file.size > 2 * 1024 * 1024) {
      setError('Abstract file must be 2MB or less.');
      return;
    }

    const rawText = await file.text();
    const cleanedText = rawText.replace(/\s+/g, ' ').trim();
    if (cleanedText.length < 40) {
      setError('Uploaded abstract content is too short. Use at least 40 characters.');
      return;
    }

    setAbstractValue(cleanedText.slice(0, 4000));
    setAbstractFileName(file.name);
    setAbstractSource('upload');
    setError(null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    if (title.trim().length < 5) {
      setError('Thesis title must be at least 5 characters.');
      return;
    }

    if (abstractValue.trim().length < 40) {
      setError('Abstract is required and must be at least 40 characters.');
      return;
    }

    setError(null);
    await onSubmit({
      title: title.trim(),
      abstractValue: abstractValue.trim(),
      supervisorId,
      supervisorQuery: supervisorQuery.trim() || undefined,
    });
  }

  return (
    <section className="placeholder-card">
      <h2>Create Thesis Proposal</h2>
      <p>
        Create your thesis once. Every upload, analysis, and coaching session will stay inside this
        workspace.
      </p>

      <form className="proposal-form" onSubmit={(event) => void handleSubmit(event)}>
        <label>
          Thesis title
          <input value={title} onChange={(event) => setTitle(event.target.value)} required />
        </label>
        <label>
          Abstract (required)
          <div className="toggle-pill-group">
            <button
              type="button"
              className={`btn ${abstractSource === 'paste' ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setAbstractSource('paste')}
            >
              Paste Text
            </button>
            <button
              type="button"
              className={`btn ${abstractSource === 'upload' ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setAbstractSource('upload')}
            >
              Upload File
            </button>
          </div>
          {abstractSource === 'paste' ? (
            <textarea
              value={abstractValue}
              onChange={(event) => setAbstractValue(event.target.value)}
              rows={5}
              placeholder="Paste your abstract..."
              required
            />
          ) : (
            <div className="abstract-upload-field">
              <input
                type="file"
                accept=".txt,.md,text/plain,text/markdown"
                onChange={(event) => {
                  const selected = event.target.files?.[0];
                  if (selected) {
                    void readAbstractFile(selected);
                  }
                }}
              />
              <small>
                {abstractFileName ? `Loaded: ${abstractFileName}` : 'Accepted: .txt, .md'}
              </small>
            </div>
          )}
        </label>
        <label>
          Supervisor (email or name)
          <input
            value={supervisorQuery}
            onChange={(event) => {
              setSupervisorQuery(event.target.value);
              setSupervisorId(undefined);
            }}
            placeholder="Search by email or full name"
          />
          {searchingProfessor ? <small>Searching verified professors...</small> : null}
          {professorResults.length > 0 ? (
            <ul className="supervisor-search-results">
              {professorResults.map((professor) => (
                <li key={professor.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setSupervisorId(professor.id);
                      setSupervisorQuery(`${professor.full_name} (${professor.email})`);
                      setProfessorResults([]);
                    }}
                  >
                    {professor.full_name} ({professor.email})
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </label>

        {error ? <p className="form-error">{error}</p> : null}

        <button type="submit" className="btn btn-primary" disabled={loading}>
          {loading ? 'Creating...' : 'Create Thesis Proposal'}
        </button>
      </form>
    </section>
  );
}

function UploadModal({
  open,
  loading,
  steps,
  onClose,
  onUpload,
}: {
  open: boolean;
  loading: boolean;
  steps: string[];
  onClose: () => void;
  onUpload: (file: File) => Promise<void>;
}): JSX.Element | null {
  const [file, setFile] = useState<File | null>(null);

  if (!open) {
    return null;
  }

  return (
    <div className="modal-overlay" role="dialog" aria-modal>
      <div className="modal-card">
        <h3>Upload New Version</h3>
        <p>Supported formats: PDF / DOCX, up to 20MB.</p>

        <label className="dropzone">
          <input
            type="file"
            accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            onChange={(event) => {
              const selected = event.target.files?.[0] ?? null;
              setFile(selected);
            }}
          />
          <span>{file ? file.name : 'Drag and drop a file, or click to select.'}</span>
        </label>

        {loading ? (
          <div className="processing-timeline">
            <p>Processing submission...</p>
            <ul>
              {[
                'File uploaded',
                'Extracting text',
                'Running thesis analysis',
                'Running citation validation',
                'Running plagiarism check',
              ].map((label, index) => (
                <li
                  key={label}
                  className={
                    steps[index] === 'done' ? 'done' : steps[index] === 'active' ? 'active' : ''
                  }
                >
                  {label}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={loading}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              if (file) {
                void onUpload(file);
              }
            }}
            disabled={!file || loading}
          >
            Continue
          </button>
        </div>
      </div>
    </div>
  );
}

export function StudentWorkspacePage(): JSX.Element {
  const navigate = useNavigate();
  const [workspace, setWorkspace] = useState<WorkspaceResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [sendingToSupervisor, setSendingToSupervisor] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadLoading, setUploadLoading] = useState(false);
  const [uploadSteps, setUploadSteps] = useState<string[]>([
    'idle',
    'idle',
    'idle',
    'idle',
    'idle',
  ]);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadWorkspace(): Promise<void> {
    setLoading(true);
    setError(null);

    try {
      const data = await apiRequest<WorkspaceResponse>('/theses/me/workspace');
      setWorkspace(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load workspace.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadWorkspace();
  }, []);

  const hasThesis = useMemo(() => Boolean(workspace?.thesis), [workspace]);

  async function handleCreateThesis(input: CreateThesisInput): Promise<void> {
    setCreating(true);
    setError(null);
    setNotice(null);

    try {
      await apiRequest('/theses', {
        method: 'POST',
        body: {
          title: input.title,
          abstract: input.abstractValue,
          supervisor_query: input.supervisorQuery,
          supervisor_id: input.supervisorId,
        },
      });
      setNotice('Thesis proposal created. You can now upload your first version.');
      await loadWorkspace();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create thesis proposal.');
    } finally {
      setCreating(false);
    }
  }

  async function handleSendToSupervisor(): Promise<void> {
    if (!workspace?.thesis) {
      return;
    }

    setSendingToSupervisor(true);
    setNotice(null);

    try {
      await apiRequest(`/theses/${workspace.thesis.id}/send-to-supervisor`, {
        method: 'PATCH',
      });
      setNotice('Submission sent to supervisor.');
      await loadWorkspace();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send thesis to supervisor.');
    } finally {
      setSendingToSupervisor(false);
    }
  }

  async function handleUpload(file: File): Promise<void> {
    setUploadLoading(true);
    setError(null);

    let activeStep = 0;
    setUploadSteps(['active', 'idle', 'idle', 'idle', 'idle']);

    const timer = window.setInterval(() => {
      activeStep = Math.min(activeStep + 1, 4);
      setUploadSteps((previous) =>
        previous.map((_, index) => {
          if (index < activeStep) {
            return 'done';
          }
          if (index === activeStep) {
            return 'active';
          }
          return 'idle';
        }),
      );
    }, 600);

    try {
      await uploadSubmission(file);
      window.clearInterval(timer);
      setUploadSteps(['done', 'done', 'done', 'done', 'done']);
      setNotice('New submission uploaded and processed successfully.');
      await loadWorkspace();
      setUploadOpen(false);
    } catch (err) {
      window.clearInterval(timer);
      setError(err instanceof Error ? err.message : 'Upload failed.');
    } finally {
      setUploadLoading(false);
    }
  }

  if (loading) {
    return (
      <section className="placeholder-card">
        <h2>Loading Thesis Workspace...</h2>
      </section>
    );
  }

  return (
    <div className="student-workspace-layout">
      {notice ? <p className="form-success">{notice}</p> : null}
      {error ? <p className="form-error">{error}</p> : null}

      {!hasThesis ? (
        <ProposalForm loading={creating} onSubmit={handleCreateThesis} />
      ) : (
        <>
          <WorkspaceHeader
            workspace={workspace as WorkspaceResponse}
            onOpenUpload={() => {
              setUploadOpen(true);
              setUploadSteps(['idle', 'idle', 'idle', 'idle', 'idle']);
            }}
            onSendToSupervisor={handleSendToSupervisor}
            onStartCoach={() => navigate('/student/mock-viva')}
            sending={sendingToSupervisor}
          />

          <MetricsRow workspace={workspace as WorkspaceResponse} />

          <div className="workspace-main-grid">
            <CentralPanel workspace={workspace as WorkspaceResponse} />
            <RightPanel workspace={workspace as WorkspaceResponse} />
          </div>
        </>
      )}

      <UploadModal
        open={uploadOpen}
        loading={uploadLoading}
        steps={uploadSteps}
        onClose={() => setUploadOpen(false)}
        onUpload={handleUpload}
      />
    </div>
  );
}

export function StudentSubmissionsPage(): JSX.Element {
  const [workspace, setWorkspace] = useState<WorkspaceResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      try {
        const data = await apiRequest<WorkspaceResponse>('/theses/me/workspace');
        setWorkspace(data);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) {
    return <section className="placeholder-card">Loading submissions...</section>;
  }

  if (!workspace?.thesis) {
    return <section className="placeholder-card">No thesis yet.</section>;
  }

  return (
    <section className="placeholder-card">
      <h2>Submissions</h2>
      <table className="simple-table">
        <thead>
          <tr>
            <th>Version</th>
            <th>Status</th>
            <th>Uploaded</th>
          </tr>
        </thead>
        <tbody>
          {workspace.submissions.map((submission) => (
            <tr key={submission.id}>
              <td>v{submission.version_number}</td>
              <td>{submission.status}</td>
              <td>{new Date(submission.created_at).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

export function StudentHistoryPage(): JSX.Element {
  return (
    <section className="placeholder-card">
      <h2>History</h2>
      <p>
        Version timeline and rich diff history are tracked through the Thesis Workspace submission
        stream.
      </p>
    </section>
  );
}

export function StudentSettingsPage(): JSX.Element {
  return (
    <section className="placeholder-card">
      <h2>Settings</h2>
      <p>Profile, notification, and preference controls will be expanded in upcoming iterations.</p>
    </section>
  );
}

export function StudentMockVivaPage(): JSX.Element {
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const [workspace, setWorkspace] = useState<WorkspaceResponse | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<VivaMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [totalQuestions, setTotalQuestions] = useState(10);
  const [summary, setSummary] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [voiceInputEnabled, setVoiceInputEnabled] = useState(false);
  const [voiceOutputEnabled, setVoiceOutputEnabled] = useState(true);
  const [isListening, setIsListening] = useState(false);

  const speechRecognitionCtor =
    (
      window as Window & {
        SpeechRecognition?: new () => SpeechRecognitionLike;
        webkitSpeechRecognition?: new () => SpeechRecognitionLike;
      }
    ).SpeechRecognition ??
    (
      window as Window & {
        SpeechRecognition?: new () => SpeechRecognitionLike;
        webkitSpeechRecognition?: new () => SpeechRecognitionLike;
      }
    ).webkitSpeechRecognition;

  const supportsSpeechRecognition = Boolean(speechRecognitionCtor);
  const supportsSpeechSynthesis = typeof window.speechSynthesis !== 'undefined';

  useEffect(() => {
    void (async () => {
      try {
        const data = await apiRequest<WorkspaceResponse>('/theses/me/workspace');
        setWorkspace(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load thesis workspace.');
      }
    })();
  }, []);

  useEffect(() => {
    const RecognitionCtor = speechRecognitionCtor;
    if (!RecognitionCtor || !voiceInputEnabled) {
      recognitionRef.current?.stop();
      recognitionRef.current = null;
      setIsListening(false);
      return;
    }

    const recognition = new RecognitionCtor();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = 'en-US';
    recognition.onresult = (event) => {
      const firstResult = event.results?.[0]?.[0];
      if (firstResult?.transcript) {
        setInput((current) => `${current} ${firstResult.transcript}`.trim());
      }
    };
    recognition.onerror = () => {
      setError('Voice input failed. You can continue using text.');
      setIsListening(false);
    };
    recognition.onend = () => setIsListening(false);

    recognitionRef.current = recognition;
    return () => {
      recognition.stop();
      recognitionRef.current = null;
      setIsListening(false);
    };
  }, [speechRecognitionCtor, voiceInputEnabled]);

  function speakText(content: string): void {
    if (!voiceOutputEnabled || !supportsSpeechSynthesis || !content.trim()) {
      return;
    }

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(content);
    utterance.rate = 0.96;
    utterance.pitch = 1;
    window.speechSynthesis.speak(utterance);
  }

  function toggleListening(): void {
    if (!voiceInputEnabled || !recognitionRef.current) {
      return;
    }

    if (isListening) {
      recognitionRef.current.stop();
      setIsListening(false);
      return;
    }

    setError(null);
    recognitionRef.current.start();
    setIsListening(true);
  }

  async function startSession(): Promise<void> {
    if (!workspace?.thesis) {
      setError('Create a thesis before starting mock viva.');
      return;
    }

    setLoading(true);
    setError(null);
    setSummary(null);

    try {
      const result = await apiRequest<{
        session_id: string;
        question_index: number;
        total_questions: number;
        ai_message: string;
      }>('/coaching/start', {
        method: 'POST',
        body: {
          thesis_id: workspace.thesis.id,
        },
      });

      setSessionId(result.session_id);
      setQuestionIndex(result.question_index);
      setTotalQuestions(result.total_questions);
      setMessages([{ role: 'assistant', content: result.ai_message }]);
      speakText(result.ai_message);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to start mock viva.');
    } finally {
      setLoading(false);
    }
  }

  async function sendMessage(): Promise<void> {
    if (!sessionId || !input.trim()) {
      return;
    }

    const content = input.trim();
    setInput('');
    setLoading(true);

    setMessages((current) => [...current, { role: 'student', content }]);

    try {
      const result = await apiRequest<{
        ai_message: string;
        question_index: number;
        total_questions: number;
      }>('/coaching/message', {
        method: 'POST',
        body: {
          session_id: sessionId,
          content,
        },
      });

      setQuestionIndex(result.question_index);
      setTotalQuestions(result.total_questions);
      setMessages((current) => [...current, { role: 'assistant', content: result.ai_message }]);
      speakText(result.ai_message);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send message.');
    } finally {
      setLoading(false);
    }
  }

  async function endSession(): Promise<void> {
    if (!sessionId) {
      return;
    }

    setLoading(true);

    try {
      const result = await apiRequest<Record<string, unknown>>('/coaching/end', {
        method: 'POST',
        body: {
          session_id: sessionId,
        },
      });
      window.speechSynthesis.cancel();
      setSummary(result);
      setSessionId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to end session.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="mock-viva-page">
      <header className="mock-viva-header">
        <h2>Mock Viva</h2>
        <p>
          Question {Math.max(questionIndex, 1)} / {totalQuestions}
        </p>
      </header>

      <div className="mock-viva-voice-controls">
        <label>
          <input
            type="checkbox"
            checked={voiceOutputEnabled}
            onChange={(event) => setVoiceOutputEnabled(event.target.checked)}
            disabled={!supportsSpeechSynthesis}
          />
          Examiner voice (TTS)
        </label>
        <label>
          <input
            type="checkbox"
            checked={voiceInputEnabled}
            onChange={(event) => setVoiceInputEnabled(event.target.checked)}
            disabled={!supportsSpeechRecognition}
          />
          Voice input (STT)
        </label>
      </div>

      {error ? <p className="form-error">{error}</p> : null}

      {!sessionId ? (
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => void startSession()}
          disabled={loading}
        >
          {loading ? 'Starting...' : 'Start Session'}
        </button>
      ) : null}

      <div className="mock-viva-chat">
        {messages.map((message, index) => (
          <div key={`${message.role}-${index}`} className={`chat-bubble ${message.role}`}>
            <strong>{message.role === 'assistant' ? 'Examiner' : 'You'}</strong>
            <p>{message.content}</p>
          </div>
        ))}
      </div>

      {sessionId ? (
        <div className="mock-viva-input-row">
          <textarea
            rows={3}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="Type your answer..."
          />
          <div>
            {voiceInputEnabled ? (
              <button
                type="button"
                className="btn btn-ghost"
                onClick={toggleListening}
                disabled={loading}
              >
                {isListening ? 'Stop Mic' : 'Use Mic'}
              </button>
            ) : null}
            <button
              type="button"
              className="btn btn-muted"
              onClick={() => void endSession()}
              disabled={loading}
            >
              End Session
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void sendMessage()}
              disabled={loading || !input.trim()}
            >
              Send Answer
            </button>
          </div>
        </div>
      ) : null}

      {summary ? (
        <article className="placeholder-card viva-summary-card">
          <h3>Session Summary</h3>
          <p>
            Confidence Score:{' '}
            <strong>
              {typeof summary.readiness_score === 'number' ? `${summary.readiness_score}%` : 'N/A'}
            </strong>
          </p>
          <p>
            Weak Topics:{' '}
            {Array.isArray(summary.weak_topics)
              ? (summary.weak_topics as string[]).join(', ')
              : 'N/A'}
          </p>
          <p>{typeof summary.recommendation === 'string' ? summary.recommendation : ''}</p>
        </article>
      ) : null}
    </section>
  );
}
