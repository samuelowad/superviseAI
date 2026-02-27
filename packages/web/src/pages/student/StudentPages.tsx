import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.js?url';

import { useAuth } from '../../auth/AuthContext';
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
    due_in_days: number | null;
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
      id: string | null;
      next_milestone: string;
      due_date: string | null;
      due_in_days: number | null;
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

interface ParsedAbstractResponse {
  text: string;
  file_name: string;
  truncated: boolean;
  original_length: number;
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

interface SubmissionDetail {
  id: string;
  version_number: number;
  status: string;
  created_at: string;
  analysis?: {
    progress_score: number;
    key_gaps: string[];
  } | null;
  citations?: {
    health_score: number;
    issues_count: number;
  } | null;
  plagiarism?: {
    similarity_percent: number;
    risk_level: 'green' | 'yellow' | 'red';
  } | null;
}

function wordDiff(a: string, b: string): Array<{ text: string; type: 'equal' | 'remove' | 'add' }> {
  const tokA = a.split(/(\s+)/);
  const tokB = b.split(/(\s+)/);
  const m = tokA.length;
  const n = tokB.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] = tokA[i] === tokB[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const result: Array<{ text: string; type: 'equal' | 'remove' | 'add' }> = [];
  let i = 0;
  let j = 0;
  while (i < m || j < n) {
    if (i < m && j < n && tokA[i] === tokB[j]) {
      result.push({ text: tokA[i], type: 'equal' });
      i++;
      j++;
    } else if (j < n && (i >= m || dp[i][j + 1] >= dp[i + 1][j])) {
      result.push({ text: tokB[j], type: 'add' });
      j++;
    } else {
      result.push({ text: tokA[i], type: 'remove' });
      i++;
    }
  }
  return result;
}

function renderWordDiff(text: string, counterText: string, side: 'left' | 'right'): JSX.Element {
  const segments = wordDiff(text, counterText);
  return (
    <pre className="pr-line-text">
      {segments.map((seg, idx) => {
        if (side === 'left' && seg.type === 'remove') {
          return (
            <mark key={idx} style={{ background: 'rgba(185,28,28,0.25)', borderRadius: '2px' }}>
              {seg.text}
            </mark>
          );
        }
        if (side === 'right' && seg.type === 'add') {
          return (
            <mark key={idx} style={{ background: 'rgba(21,128,61,0.25)', borderRadius: '2px' }}>
              {seg.text}
            </mark>
          );
        }
        if (seg.type === 'equal') {
          return <span key={idx}>{seg.text}</span>;
        }
        return null;
      })}
    </pre>
  );
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

async function uploadSubmission(
  file: File,
  milestoneId?: string | null,
): Promise<{ submission_id: string; status: string }> {
  const token = getAccessToken();
  if (!token) {
    throw new Error('You are not authenticated.');
  }

  const formData = new FormData();
  formData.append('file', file);
  if (milestoneId) {
    formData.append('milestone_id', milestoneId);
  }

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

function formatDueText(dueInDays: number | null): string {
  if (dueInDays === null) {
    return 'No due date';
  }

  if (dueInDays < 0) {
    return `Overdue by ${Math.abs(dueInDays)} day(s)`;
  }

  return `Due in ${dueInDays} day(s)`;
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
  const plagRisk = workspace.right_panel.plagiarism.risk_level;
  const dueUrgent = workspace.metrics.due_in_days !== null && workspace.metrics.due_in_days < 3;
  const citColor =
    workspace.metrics.citation_health_score >= 80
      ? 'var(--success)'
      : workspace.metrics.citation_health_score >= 50
        ? '#d97706'
        : 'var(--risk)';

  return (
    <section className="workspace-metrics-grid">
      <article className="metric-card metric-primary">
        <h3>Thesis Progress Score</h3>
        <p className="metric-value">{workspace.metrics.progress_score}%</p>
        <div className="metric-bar-track">
          <div
            className="metric-bar-fill"
            style={{ width: `${workspace.metrics.progress_score}%` }}
          />
        </div>
        <p className={trendClass}>
          {workspace.metrics.trend_delta >= 0 ? '+' : ''}
          {workspace.metrics.trend_delta}% vs previous draft
        </p>
      </article>

      <article className="metric-card">
        <h3>Citation Health</h3>
        <p className="metric-value">{workspace.metrics.citation_health_score}%</p>
        <div className="metric-bar-track">
          <div
            className="metric-bar-fill"
            style={{ width: `${workspace.metrics.citation_health_score}%`, background: citColor }}
          />
        </div>
        <p>
          {workspace.metrics.citation_issues > 0 ? (
            <strong style={{ color: '#d97706' }}>{workspace.metrics.citation_issues}</strong>
          ) : (
            workspace.metrics.citation_issues
          )}{' '}
          issue(s) detected
        </p>
      </article>

      <article className="metric-card">
        <h3>Plagiarism Score</h3>
        <p className="metric-value">
          <span className={`risk-dot risk-${plagRisk}`} />
          {workspace.metrics.plagiarism_similarity}%
        </p>
        <p>
          Risk:{' '}
          <strong
            style={{
              color:
                plagRisk === 'green'
                  ? 'var(--success)'
                  : plagRisk === 'yellow'
                    ? '#d97706'
                    : 'var(--risk)',
            }}
          >
            {plagRisk.toUpperCase()}
          </strong>
        </p>
      </article>

      <article className="metric-card">
        <h3>Next Milestone</h3>
        <p className="metric-value small">{workspace.metrics.next_milestone}</p>
        <p
          style={{
            color: dueUrgent ? 'var(--risk)' : undefined,
            fontWeight: dueUrgent ? 700 : undefined,
          }}
        >
          {formatDueText(workspace.metrics.due_in_days)}
        </p>
      </article>
    </section>
  );
}

function PdfViewer({ path, title }: { path: string; title: string }): JSX.Element {
  const [numPages, setNumPages] = useState(0);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [pageWidth, setPageWidth] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Measure container width so pages scale to fit (and rescale on drag-resize)
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
          <p style={{ marginBottom: '0.75rem' }}>
            Verdict:{' '}
            <span
              className={`status-pill ${
                workspace.central_panel.abstract_alignment?.verdict === 'aligned'
                  ? 'success'
                  : workspace.central_panel.abstract_alignment?.verdict === 'partially_aligned'
                    ? 'warning'
                    : 'info'
              }`}
            >
              {(workspace.central_panel.abstract_alignment?.verdict ?? 'insufficient data').replace(
                /_/g,
                ' ',
              )}
            </span>
          </p>
          <div className="grid-two-columns">
            <div>
              <h4>Key Topic Coverage</h4>
              {(workspace.central_panel.abstract_alignment?.key_topic_coverage ?? []).length > 0 ? (
                <ul>
                  {(workspace.central_panel.abstract_alignment?.key_topic_coverage ?? []).map(
                    (item) => (
                      <li key={item}>{item}</li>
                    ),
                  )}
                </ul>
              ) : (
                <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                  No topics identified yet.
                </p>
              )}
            </div>
            <div>
              <h4>Missing Core Sections</h4>
              {(workspace.central_panel.abstract_alignment?.missing_core_sections ?? []).length >
              0 ? (
                <ul>
                  {(workspace.central_panel.abstract_alignment?.missing_core_sections ?? []).map(
                    (item) => (
                      <li key={item}>{item}</li>
                    ),
                  )}
                </ul>
              ) : (
                <p style={{ fontSize: '0.85rem', color: 'var(--success)' }}>
                  No missing sections detected.
                </p>
              )}
            </div>
          </div>
          <p>
            Structural readiness:{' '}
            <span
              className={`status-pill ${
                workspace.central_panel.abstract_alignment?.structural_readiness === 'ready'
                  ? 'success'
                  : workspace.central_panel.abstract_alignment?.structural_readiness ===
                      'developing'
                    ? 'warning'
                    : 'info'
              }`}
            >
              {workspace.central_panel.abstract_alignment?.structural_readiness ?? 'developing'}
            </span>
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
                      {row.type === 'removal' ? (
                        renderWordDiff(row.left_text || ' ', row.right_text || ' ', 'left')
                      ) : (
                        <pre className="pr-line-text">{row.left_text || ' '}</pre>
                      )}
                      <span className="pr-line-no">{row.right_line ?? ''}</span>
                      {row.type === 'addition' ? (
                        renderWordDiff(row.left_text || ' ', row.right_text || ' ', 'right')
                      ) : (
                        <pre className="pr-line-text">{row.right_text || ' '}</pre>
                      )}
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
                }
                right={
                  <div className="pdf-split-pane-inner">
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
                }
              />

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

function citationItemToString(item: unknown): string {
  if (typeof item === 'string') return item;
  if (item && typeof item === 'object') {
    const obj = item as Record<string, unknown>;
    if (obj.issue && obj.description) return `${obj.issue}: ${obj.description}`;
    if (obj.issue) return String(obj.issue);
    if (obj.description) return String(obj.description);
    return JSON.stringify(item);
  }
  return String(item);
}

function RightPanel({ workspace }: { workspace: WorkspaceResponse }): JSX.Element {
  const plagRisk = workspace.right_panel.plagiarism.risk_level;
  const citIssueCount =
    workspace.right_panel.citations.missing_citations.length +
    workspace.right_panel.citations.broken_references.length +
    workspace.right_panel.citations.formatting_errors.length;
  const dueUrgent =
    workspace.right_panel.milestone.due_in_days !== null &&
    workspace.right_panel.milestone.due_in_days < 3;

  return (
    <aside className="workspace-right-panel">
      <details open>
        <summary>
          Plagiarism Report
          <span
            className={`summary-badge ${plagRisk === 'red' ? 'danger' : plagRisk === 'yellow' ? 'warning' : ''}`}
          >
            {workspace.right_panel.plagiarism.similarity_percent}%
          </span>
        </summary>
        <div className="right-panel-card-body">
          <p>
            <span className={`risk-dot risk-${plagRisk}`} />
            Similarity: <strong>{workspace.right_panel.plagiarism.similarity_percent}%</strong>
          </p>
          <p>
            Risk Level:{' '}
            <strong
              style={{
                color:
                  plagRisk === 'green'
                    ? 'var(--success)'
                    : plagRisk === 'yellow'
                      ? '#d97706'
                      : 'var(--risk)',
              }}
            >
              {plagRisk.toUpperCase()}
            </strong>
          </p>
          {workspace.right_panel.plagiarism.flagged_sections.length > 0 ? (
            <>
              <p style={{ marginTop: '0.4rem', fontWeight: 600 }}>Flagged sections:</p>
              <ul>
                {workspace.right_panel.plagiarism.flagged_sections.map((section) => (
                  <li key={section}>{section}</li>
                ))}
              </ul>
            </>
          ) : (
            <p style={{ color: 'var(--success)', marginTop: '0.4rem' }}>
              No flagged sections found.
            </p>
          )}
        </div>
      </details>

      <details>
        <summary>
          Citation & Reference Validator
          {citIssueCount > 0 ? (
            <span className="summary-badge warning">{citIssueCount}</span>
          ) : (
            <span className="summary-badge">OK</span>
          )}
        </summary>
        <div className="right-panel-card-body">
          {workspace.right_panel.citations.missing_citations.length > 0 ? (
            <>
              <p style={{ fontWeight: 600 }}>Missing citations:</p>
              <ul>
                {workspace.right_panel.citations.missing_citations.map((item, i) => {
                  const text = citationItemToString(item);
                  return <li key={i}>{text}</li>;
                })}
              </ul>
            </>
          ) : null}
          {workspace.right_panel.citations.broken_references.length > 0 ? (
            <>
              <p style={{ fontWeight: 600 }}>Broken references:</p>
              <ul>
                {workspace.right_panel.citations.broken_references.map((item, i) => {
                  const text = citationItemToString(item);
                  return <li key={i}>{text}</li>;
                })}
              </ul>
            </>
          ) : null}
          {workspace.right_panel.citations.formatting_errors.length > 0 ? (
            <>
              <p style={{ fontWeight: 600 }}>Formatting errors:</p>
              <ul>
                {workspace.right_panel.citations.formatting_errors.map((item, i) => {
                  const text = citationItemToString(item);
                  return <li key={i}>{text}</li>;
                })}
              </ul>
            </>
          ) : null}
          {citIssueCount === 0 ? (
            <p style={{ color: 'var(--success)' }}>All citations look good.</p>
          ) : null}
        </div>
      </details>

      <details>
        <summary>Milestone Tracker</summary>
        <div className="right-panel-card-body">
          <p style={{ fontWeight: 600 }}>{workspace.right_panel.milestone.next_milestone}</p>
          <p
            style={{
              color: dueUrgent ? 'var(--risk)' : undefined,
              fontWeight: dueUrgent ? 700 : undefined,
            }}
          >
            {formatDueText(workspace.right_panel.milestone.due_in_days)}
          </p>
          <p>
            Status:{' '}
            <span className={`status-pill ${statusTone(workspace.right_panel.milestone.status)}`}>
              {workspace.right_panel.milestone.status}
            </span>
          </p>
          <p>Due Date: {workspace.right_panel.milestone.due_date ?? 'Not set'}</p>
        </div>
      </details>

      <details>
        <summary>Latest Professor Feedback</summary>
        <div className="right-panel-card-body">
          {workspace.right_panel.latest_professor_feedback.text ? (
            <p style={{ lineHeight: 1.55 }}>
              {workspace.right_panel.latest_professor_feedback.text}
            </p>
          ) : (
            <p style={{ color: 'var(--text-secondary)', fontStyle: 'italic' }}>No feedback yet.</p>
          )}
          <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '0.3rem' }}>
            {formatDate(workspace.right_panel.latest_professor_feedback.timestamp)}
          </p>
        </div>
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
    if (file.size > 20 * 1024 * 1024) {
      setError('Abstract/proposal file must be 20MB or less.');
      return;
    }

    const token = getAccessToken();
    if (!token) {
      setError('Please sign in again and retry.');
      return;
    }

    const formData = new FormData();
    formData.append('file', file);

    try {
      const response = await fetch(`${API_BASE}/theses/abstract/parse`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: formData,
      });

      let payload: ParsedAbstractResponse | { message?: string } = { message: '' };
      try {
        payload = (await response.json()) as ParsedAbstractResponse | { message?: string };
      } catch {
        payload = { message: 'Failed to parse uploaded file.' };
      }

      if (!response.ok) {
        const msg =
          typeof payload === 'object' && payload && 'message' in payload
            ? (payload.message ?? 'Failed to parse file.')
            : 'Failed to parse file.';
        setError(msg);
        return;
      }

      const parsed = payload as ParsedAbstractResponse;
      setAbstractValue(parsed.text);
      setAbstractFileName(
        parsed.truncated
          ? `${parsed.file_name || file.name} (truncated to 30,000 chars)`
          : parsed.file_name || file.name,
      );
      setAbstractSource('upload');
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to parse uploaded file.');
    }
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
                accept=".pdf,.docx,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown"
                onChange={(event) => {
                  const selected = event.target.files?.[0];
                  if (selected) {
                    void readAbstractFile(selected);
                  }
                }}
              />
              <small>
                {abstractFileName
                  ? `Loaded: ${abstractFileName}`
                  : 'Accepted: .pdf, .docx, .txt, .md (up to 20MB)'}
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
      await uploadSubmission(file, workspace?.right_panel.milestone.id);
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
      <section className="placeholder-card" style={{ textAlign: 'center', padding: '3rem' }}>
        <div className="spinner" role="status" aria-label="Loading workspace" />
        <p style={{ marginTop: '0.75rem' }}>Loading Thesis Workspace...</p>
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
    return (
      <section className="placeholder-card" style={{ textAlign: 'center', padding: '2.5rem' }}>
        <div className="spinner" role="status" aria-label="Loading submissions" />
      </section>
    );
  }

  if (!workspace?.thesis) {
    return (
      <section className="placeholder-card">
        <h2>Submissions</h2>
        <p>Create a thesis proposal first to start uploading drafts.</p>
      </section>
    );
  }

  if (workspace.submissions.length === 0) {
    return (
      <section className="placeholder-card">
        <h2>Submissions</h2>
        <p style={{ marginBottom: '0.5rem' }}>{workspace.thesis.title}</p>
        <p>No submissions yet. Upload your first draft from the workspace.</p>
      </section>
    );
  }

  return (
    <section className="placeholder-card">
      <h2>Submissions</h2>
      <p style={{ marginBottom: '1rem', color: 'var(--text-secondary)', fontSize: '0.88rem' }}>
        {workspace.thesis.title} -- {workspace.submissions.length} version(s)
      </p>
      <table className="simple-table">
        <thead>
          <tr>
            <th>Version</th>
            <th>Status</th>
            <th>Uploaded</th>
          </tr>
        </thead>
        <tbody>
          {[...workspace.submissions].reverse().map((submission) => (
            <tr key={submission.id}>
              <td>
                <strong style={{ fontFamily: 'monospace' }}>v{submission.version_number}</strong>
              </td>
              <td>
                <span className={`status-pill ${statusTone(submission.status)}`}>
                  {submission.status}
                </span>
              </td>
              <td>{formatDate(submission.created_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

export function StudentHistoryPage(): JSX.Element {
  const [workspace, setWorkspace] = useState<WorkspaceResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [submissionDetails, setSubmissionDetails] = useState<Record<string, SubmissionDetail>>({});
  const [detailLoading, setDetailLoading] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let active = true;
    const load = async (): Promise<void> => {
      setLoading(true);
      setError(null);
      try {
        const data = await apiRequest<WorkspaceResponse>('/theses/me/workspace');
        if (active) setWorkspace(data);
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : 'Failed to load history.');
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, []);

  const handleExpand = async (subId: string): Promise<void> => {
    if (expandedId === subId) {
      setExpandedId(null);
      return;
    }
    setExpandedId(subId);
    if (!submissionDetails[subId]) {
      setDetailLoading((prev) => ({ ...prev, [subId]: true }));
      try {
        const detail = await apiRequest<SubmissionDetail>(`/submissions/${subId}`);
        setSubmissionDetails((prev) => ({ ...prev, [subId]: detail }));
      } catch {
        // leave as empty if error
      } finally {
        setDetailLoading((prev) => ({ ...prev, [subId]: false }));
      }
    }
  };

  if (loading) {
    return (
      <section className="placeholder-card">
        <h2>History</h2>
        <div className="spinner" role="status" aria-label="Loading history" />
      </section>
    );
  }

  if (error) {
    return (
      <section className="placeholder-card">
        <h2>History</h2>
        <p style={{ color: 'var(--danger, #dc2626)' }}>{error}</p>
      </section>
    );
  }

  const submissions = workspace?.submissions ?? [];

  if (!workspace?.thesis || submissions.length === 0) {
    return (
      <section className="placeholder-card">
        <h2>History</h2>
        <p>No submissions yet. Upload your first draft from the workspace.</p>
      </section>
    );
  }

  return (
    <section className="placeholder-card">
      <h2>Submission History</h2>
      <p
        style={{
          marginBottom: '1.25rem',
          color: 'var(--text-secondary, #666)',
          fontSize: '0.9rem',
        }}
      >
        {workspace.thesis.title}
      </p>
      <div className="history-timeline">
        {[...submissions].reverse().map((sub) => {
          const isExpanded = expandedId === sub.id;
          const detail = submissionDetails[sub.id];
          const isDetailLoading = detailLoading[sub.id];

          return (
            <article key={sub.id} className="history-entry">
              <div className="history-entry-header">
                <span
                  className="version-badge"
                  style={{
                    fontFamily: 'monospace',
                    fontWeight: 800,
                    color: 'var(--primary)',
                    border: '1px solid var(--primary)',
                    borderRadius: '6px',
                    padding: '0.2rem 0.5rem',
                    fontSize: '0.85rem',
                  }}
                >
                  V{sub.version_number}
                </span>
                <span
                  style={{ flex: 1, fontSize: '0.85rem', color: 'var(--text-secondary, #666)' }}
                >
                  {formatDate(sub.created_at)}
                </span>
                <span className={`status-pill status-${statusTone(sub.status)}`}>{sub.status}</span>
                <button
                  type="button"
                  className="btn btn-ghost"
                  style={{ fontSize: '0.82rem' }}
                  onClick={() => {
                    void handleExpand(sub.id);
                  }}
                >
                  {isExpanded ? 'Hide ▲' : 'View Analysis ▼'}
                </button>
              </div>

              {isExpanded && (
                <div
                  style={{
                    marginTop: '1rem',
                    borderTop: '1px solid var(--border)',
                    paddingTop: '1rem',
                  }}
                >
                  {isDetailLoading ? (
                    <div className="spinner" role="status" aria-label="Loading analysis" />
                  ) : detail ? (
                    <div
                      className="workspace-metrics-grid"
                      style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))' }}
                    >
                      {detail.analysis != null && (
                        <article className="metric-card">
                          <h3>Progress</h3>
                          <p className="metric-value">{detail.analysis.progress_score}%</p>
                        </article>
                      )}
                      {detail.citations != null && (
                        <article className="metric-card">
                          <h3>Citation Health</h3>
                          <p className="metric-value">{detail.citations.health_score}%</p>
                          <p>
                            {detail.citations.issues_count} issue
                            {detail.citations.issues_count !== 1 ? 's' : ''}
                          </p>
                        </article>
                      )}
                      {detail.plagiarism != null && (
                        <article className="metric-card">
                          <h3>Plagiarism</h3>
                          <p className="metric-value">{detail.plagiarism.similarity_percent}%</p>
                          {detail.plagiarism.risk_level ? (
                            <p>{detail.plagiarism.risk_level.toUpperCase()}</p>
                          ) : null}
                        </article>
                      )}
                      {detail.analysis?.key_gaps && detail.analysis.key_gaps.length > 0 && (
                        <article className="metric-card" style={{ gridColumn: 'span 2' }}>
                          <h3>Key Gaps</h3>
                          <ul style={{ margin: 0, paddingLeft: '1rem', fontSize: '0.82rem' }}>
                            {detail.analysis.key_gaps.map((gap, idx) => (
                              <li key={idx}>{gap}</li>
                            ))}
                          </ul>
                        </article>
                      )}
                    </div>
                  ) : (
                    <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary, #666)' }}>
                      Analysis not available for this submission.
                    </p>
                  )}
                </div>
              )}
            </article>
          );
        })}
      </div>

      <style>{`
        .history-timeline { display: grid; gap: 0.75rem; }
        .history-entry { border: 1px solid var(--border); border-radius: 12px; background: white; padding: 1rem; }
        .history-entry-header { display: flex; align-items: center; gap: 0.75rem; flex-wrap: wrap; }
      `}</style>
    </section>
  );
}

export function StudentSettingsPage(): JSX.Element {
  const { user } = useAuth();

  return (
    <div style={{ display: 'grid', gap: '0.75rem' }}>
      <section className="placeholder-card">
        <h2>Profile</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginTop: '0.75rem' }}>
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: '50%',
              background: 'var(--primary)',
              color: '#fff',
              display: 'grid',
              placeItems: 'center',
              fontSize: '1.1rem',
              fontWeight: 700,
              flexShrink: 0,
            }}
          >
            {user?.full_name
              ?.split(' ')
              .slice(0, 2)
              .map((w) => w[0])
              .join('')
              .toUpperCase() ?? '?'}
          </div>
          <div>
            <p style={{ margin: 0, fontWeight: 700, fontSize: '1rem' }}>{user?.full_name}</p>
            <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.88rem' }}>
              {user?.email}
            </p>
            <span className="role-pill" style={{ marginTop: '0.3rem', display: 'inline-block' }}>
              {user?.role}
            </span>
          </div>
        </div>
      </section>

      <section className="placeholder-card">
        <h2>Notifications</h2>
        <div style={{ display: 'grid', gap: '0.65rem', marginTop: '0.75rem' }}>
          {[
            { label: 'Email me when supervisor sends feedback', defaultOn: true },
            { label: 'Email me before milestone deadlines', defaultOn: true },
            { label: 'Email me when plagiarism scan completes', defaultOn: false },
          ].map((pref) => (
            <label
              key={pref.label}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.55rem',
                fontSize: '0.88rem',
                cursor: 'pointer',
              }}
            >
              <input type="checkbox" defaultChecked={pref.defaultOn} />
              {pref.label}
            </label>
          ))}
        </div>
      </section>

      <section className="placeholder-card">
        <h2>Account</h2>
        <p style={{ marginTop: '0.5rem' }}>
          Account management and data export options will be available in a future release.
        </p>
      </section>
    </div>
  );
}

type CoachingMode = 'mock_viva' | 'argument_defender' | 'socratic';
type LearnerProfile = 'standard' | 'esl_support' | 'anxious_speaker' | 'advanced_researcher';
type DifficultyBand = 'easy' | 'medium' | 'hard';

interface TurnScores {
  argument_strength: number;
  evidence_quality: number;
  logical_consistency: number;
  clarity: number;
  confidence: number;
}

interface LiveMetrics {
  turn: number;
  confidence: number;
  sentiment: 'positive' | 'neutral' | 'negative';
  difficulty: DifficultyBand;
  scores: TurnScores;
  trend: 'improving' | 'stable' | 'declining';
  hesitation_signals: string[];
}

interface DimensionSummary {
  averages: TurnScores;
  first_turn: TurnScores;
  last_turn: TurnScores;
  deltas: TurnScores;
  best_improved: keyof TurnScores;
  weakest_persistent: keyof TurnScores;
}

interface SessionSummary {
  mode?: CoachingMode;
  learner_profile?: LearnerProfile;
  readiness_score?: number;
  weak_topics?: string[];
  recommendation?: string;
  dimension_summary?: DimensionSummary;
  progress_delta?: number;
  turns_completed?: number;
}

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let index = 0; index < text.length; index += 1) {
    view.setUint8(offset + index, text.charCodeAt(index));
  }
}

function encodePcmWav(samples: Float32Array, sampleRate: number): Blob {
  const bytesPerSample = 2;
  const blockAlign = bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // format = PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true); // bits per sample
  writeAscii(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i += 1) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

async function convertBlobToPcmWav(blob: Blob, targetRate = 16000): Promise<Blob> {
  const arrayBuffer = await blob.arrayBuffer();
  const audioContext = new AudioContext();
  try {
    const decoded = await audioContext.decodeAudioData(arrayBuffer.slice(0));
    const frameCount = Math.max(1, Math.ceil(decoded.duration * targetRate));
    const offline = new OfflineAudioContext(1, frameCount, targetRate);
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start(0);
    const rendered = await offline.startRendering();
    const channelData = rendered.getChannelData(0);
    const samples = new Float32Array(channelData.length);
    samples.set(channelData);
    return encodePcmWav(samples, targetRate);
  } finally {
    await audioContext.close();
  }
}

const COACHING_MODE_LABELS: Record<CoachingMode, string> = {
  mock_viva: 'Mock Viva',
  argument_defender: 'Argument Defender',
  socratic: 'Socratic Coach',
};

const COACHING_MODE_DESCRIPTIONS: Record<CoachingMode, string> = {
  mock_viva: 'Face a rigorous viva examination based on your actual thesis content.',
  argument_defender: 'Defend specific claims in your thesis against a critical academic reviewer.',
  socratic: 'Deepen your understanding through guided Socratic questioning.',
};

const LEARNER_PROFILE_LABELS: Record<LearnerProfile, string> = {
  standard: 'Standard',
  esl_support: 'ESL Support',
  anxious_speaker: 'Anxious Speaker',
  advanced_researcher: 'Advanced Researcher',
};

const LEARNER_PROFILE_DESCRIPTIONS: Record<LearnerProfile, string> = {
  standard: 'Default coaching style suitable for most students.',
  esl_support: 'Simpler language, slower progression, extra clarification prompts.',
  anxious_speaker: 'Supportive tone, confidence-building follow-ups, reduced confrontation.',
  advanced_researcher: 'Maximum rigour, stress-test methodology, fast difficulty ramp.',
};

const DIFFICULTY_COLORS: Record<DifficultyBand, string> = {
  easy: '#16a34a',
  medium: '#d97706',
  hard: '#dc2626',
};

const TREND_ICONS: Record<string, string> = {
  improving: '↑',
  stable: '→',
  declining: '↓',
};

const SCORE_LABELS: Record<keyof TurnScores, string> = {
  argument_strength: 'Argument',
  evidence_quality: 'Evidence',
  logical_consistency: 'Logic',
  clarity: 'Clarity',
  confidence: 'Confidence',
};

function adaptationMessage(metrics: LiveMetrics): string {
  if (metrics.difficulty === 'easy') {
    return 'Coach reduced complexity due to lower confidence signals.';
  }
  if (metrics.difficulty === 'hard') {
    return 'Coach increased rigour due to strong confidence signals.';
  }
  return 'Coach is maintaining balanced challenge depth.';
}

export function StudentMockVivaPage(): JSX.Element {
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const [workspace, setWorkspace] = useState<WorkspaceResponse | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [selectedMode, setSelectedMode] = useState<CoachingMode>('mock_viva');
  const [selectedProfile, setSelectedProfile] = useState<LearnerProfile>('standard');
  const [messages, setMessages] = useState<VivaMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [totalQuestions, setTotalQuestions] = useState(10);
  const [summary, setSummary] = useState<SessionSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [voiceInputEnabled, setVoiceInputEnabled] = useState(false);
  const [voiceOutputEnabled, setVoiceOutputEnabled] = useState(true);
  const [isListening, setIsListening] = useState(false);
  const [useAzureVoice, setUseAzureVoice] = useState(true);
  const [liveMetrics, setLiveMetrics] = useState<LiveMetrics | null>(null);
  const [metricsHistory, setMetricsHistory] = useState<LiveMetrics[]>([]);

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
  const supportsMediaRecorder = typeof MediaRecorder !== 'undefined';

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
    if (!RecognitionCtor || !voiceInputEnabled || useAzureVoice) {
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
  }, [speechRecognitionCtor, voiceInputEnabled, useAzureVoice]);

  async function speakText(content: string): Promise<void> {
    if (!voiceOutputEnabled || !content.trim()) return;

    // Try Azure TTS first
    if (useAzureVoice) {
      try {
        const token = getAccessToken() ?? '';
        const resp = await fetch(`${API_BASE}/coaching/tts`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ text: content.slice(0, 800) }),
        });
        if (resp.ok) {
          const blob = await resp.blob();
          const url = URL.createObjectURL(blob);
          const audio = new Audio(url);
          audio.onended = () => URL.revokeObjectURL(url);
          void audio.play();
          return;
        }
      } catch {
        // fall through to browser TTS
      }
    }

    // Browser TTS fallback
    if (!supportsSpeechSynthesis) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(content);
    utterance.rate = 0.96;
    utterance.pitch = 1;
    window.speechSynthesis.speak(utterance);
  }

  function toggleListening(): void {
    if (!voiceInputEnabled) return;

    // Azure STT: record via MediaRecorder and POST to /coaching/voice
    if (useAzureVoice && supportsMediaRecorder) {
      if (isListening) {
        mediaRecorderRef.current?.stop();
        setIsListening(false);
        return;
      }

      setError(null);
      void navigator.mediaDevices
        .getUserMedia({ audio: true })
        .then((stream) => {
          const preferredTypes = ['audio/ogg;codecs=opus', 'audio/webm;codecs=opus', 'audio/webm'];
          const selectedMimeType = preferredTypes.find((type) =>
            MediaRecorder.isTypeSupported(type),
          );

          const recorder = selectedMimeType
            ? new MediaRecorder(stream, { mimeType: selectedMimeType })
            : new MediaRecorder(stream);
          audioChunksRef.current = [];
          recorder.ondataavailable = (e) => {
            if (e.data.size > 0) audioChunksRef.current.push(e.data);
          };
          recorder.onstop = () => {
            stream.getTracks().forEach((t) => t.stop());
            void (async () => {
              if (!sessionId || audioChunksRef.current.length === 0) return;
              setLoading(true);
              try {
                const recordedMimeType = selectedMimeType || recorder.mimeType || 'audio/webm';
                const extension = recordedMimeType.includes('ogg') ? 'ogg' : 'webm';
                const rawBlob = new Blob(audioChunksRef.current, { type: recordedMimeType });
                let uploadBlob = rawBlob;
                let uploadFilename = `recording.${extension}`;

                try {
                  uploadBlob = await convertBlobToPcmWav(rawBlob, 16000);
                  uploadFilename = 'recording.wav';
                } catch {
                  // keep original if conversion fails
                }
                const formData = new FormData();
                formData.append('audio', uploadBlob, uploadFilename);
                const token = getAccessToken() ?? '';
                const resp = await fetch(`${API_BASE}/coaching/voice?session_id=${sessionId}`, {
                  method: 'POST',
                  headers: { Authorization: `Bearer ${token}` },
                  body: formData,
                });
                if (!resp.ok) throw new Error('Voice recognition failed.');
                const result = (await resp.json()) as {
                  ai_message: string;
                  question_index: number;
                  total_questions: number;
                  transcribed_text: string;
                  live_metrics?: LiveMetrics;
                };
                if (result.transcribed_text) {
                  setMessages((current) => [
                    ...current,
                    { role: 'student', content: result.transcribed_text },
                  ]);
                }
                setQuestionIndex(result.question_index);
                setTotalQuestions(result.total_questions);
                setMessages((current) => [
                  ...current,
                  { role: 'assistant', content: result.ai_message },
                ]);
                if (result.live_metrics) {
                  setLiveMetrics(result.live_metrics);
                  setMetricsHistory((current) => [...current, result.live_metrics as LiveMetrics]);
                }
                void speakText(result.ai_message);
              } catch (err) {
                setError(err instanceof Error ? err.message : 'Voice input failed.');
              } finally {
                setLoading(false);
              }
            })();
          };
          mediaRecorderRef.current = recorder;
          recorder.start();
          setIsListening(true);
        })
        .catch(() => {
          setError('Microphone access denied. You can continue using text input.');
        });
      return;
    }

    // Browser Web Speech API fallback
    if (!recognitionRef.current) return;
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
      setError('Create a thesis before starting a coaching session.');
      return;
    }

    setLoading(true);
    setError(null);
    setSummary(null);

    try {
      const result = await apiRequest<{
        session_id: string;
        mode: CoachingMode;
        question_index: number;
        total_questions: number;
        ai_message: string;
        learner_profile?: LearnerProfile;
      }>('/coaching/start', {
        method: 'POST',
        body: {
          thesis_id: workspace.thesis.id,
          mode: selectedMode,
          learner_profile: selectedProfile,
        },
      });

      setSessionId(result.session_id);
      setQuestionIndex(result.question_index);
      setTotalQuestions(result.total_questions);
      setLiveMetrics(null);
      setMetricsHistory([]);
      setMessages([{ role: 'assistant', content: result.ai_message }]);
      void speakText(result.ai_message);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to start coaching session.');
    } finally {
      setLoading(false);
    }
  }

  async function sendMessage(): Promise<void> {
    if (!sessionId || !input.trim()) return;

    const content = input.trim();
    setInput('');
    setLoading(true);
    setMessages((current) => [...current, { role: 'student', content }]);

    try {
      const result = await apiRequest<{
        ai_message: string;
        question_index: number;
        total_questions: number;
        intent_blocked?: boolean;
        live_metrics?: LiveMetrics;
      }>('/coaching/message', {
        method: 'POST',
        body: { session_id: sessionId, content },
      });

      setQuestionIndex(result.question_index);
      setTotalQuestions(result.total_questions);
      setMessages((current) => [...current, { role: 'assistant', content: result.ai_message }]);
      if (result.live_metrics) {
        setLiveMetrics(result.live_metrics);
        setMetricsHistory((current) => [...current, result.live_metrics as LiveMetrics]);
      }
      void speakText(result.ai_message);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send message.');
    } finally {
      setLoading(false);
    }
  }

  async function endSession(): Promise<void> {
    if (!sessionId) return;

    setLoading(true);

    try {
      const result = await apiRequest<SessionSummary>('/coaching/end', {
        method: 'POST',
        body: { session_id: sessionId },
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

  const modeLabel = COACHING_MODE_LABELS[selectedMode];

  return (
    <section className="mock-viva-page">
      <header className="mock-viva-header">
        <div>
          <h2>{sessionId ? modeLabel : 'AI Coaching'}</h2>
          {sessionId ? (
            <p>
              Question {Math.max(questionIndex, 1)} of {totalQuestions}
              {' · '}
              <span style={{ color: 'var(--primary)', fontWeight: 600 }}>
                {LEARNER_PROFILE_LABELS[selectedProfile]}
              </span>
            </p>
          ) : (
            <p>Choose a mode and start an AI-powered coaching session based on your thesis.</p>
          )}
        </div>
        {sessionId ? (
          <div style={{ minWidth: '140px', textAlign: 'right' }}>
            <div
              style={{
                fontSize: '0.78rem',
                color: 'var(--text-secondary)',
                marginBottom: '0.3rem',
              }}
            >
              {Math.round((Math.max(questionIndex, 1) / totalQuestions) * 100)}% complete
            </div>
            <div className="metric-bar-track" style={{ height: '6px' }}>
              <div
                className="metric-bar-fill"
                style={{
                  width: `${(Math.max(questionIndex, 1) / totalQuestions) * 100}%`,
                  transition: 'width 0.4s',
                }}
              />
            </div>
          </div>
        ) : null}
      </header>

      {/* Mode selector — only visible before session starts */}
      {!sessionId && !summary ? (
        <>
          <h3 style={{ margin: '0 0 0.4rem', fontSize: '0.95rem', color: 'var(--text-secondary)' }}>
            Coaching Mode
          </h3>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
              gap: '0.75rem',
              marginBottom: '1rem',
            }}
          >
            {(Object.keys(COACHING_MODE_LABELS) as CoachingMode[]).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setSelectedMode(mode)}
                style={{
                  border: `2px solid ${selectedMode === mode ? 'var(--primary)' : 'var(--border)'}`,
                  borderRadius: '12px',
                  padding: '1rem',
                  background: selectedMode === mode ? 'rgba(14,124,102,0.07)' : 'white',
                  textAlign: 'left',
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                }}
              >
                <div
                  style={{
                    fontWeight: 700,
                    color: selectedMode === mode ? 'var(--primary)' : 'var(--text)',
                    marginBottom: '0.25rem',
                  }}
                >
                  {COACHING_MODE_LABELS[mode]}
                </div>
                <div
                  style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.4 }}
                >
                  {COACHING_MODE_DESCRIPTIONS[mode]}
                </div>
              </button>
            ))}
          </div>

          <h3 style={{ margin: '0 0 0.4rem', fontSize: '0.95rem', color: 'var(--text-secondary)' }}>
            Learner Profile
          </h3>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
              gap: '0.75rem',
              marginBottom: '1rem',
            }}
          >
            {(Object.keys(LEARNER_PROFILE_LABELS) as LearnerProfile[]).map((profile) => (
              <button
                key={profile}
                type="button"
                onClick={() => setSelectedProfile(profile)}
                style={{
                  border: `2px solid ${selectedProfile === profile ? 'var(--primary)' : 'var(--border)'}`,
                  borderRadius: '12px',
                  padding: '0.85rem',
                  background: selectedProfile === profile ? 'rgba(14,124,102,0.07)' : 'white',
                  textAlign: 'left',
                  cursor: 'pointer',
                }}
              >
                <div
                  style={{
                    fontWeight: 700,
                    color: selectedProfile === profile ? 'var(--primary)' : 'var(--text)',
                    marginBottom: '0.2rem',
                  }}
                >
                  {LEARNER_PROFILE_LABELS[profile]}
                </div>
                <div
                  style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.35 }}
                >
                  {LEARNER_PROFILE_DESCRIPTIONS[profile]}
                </div>
              </button>
            ))}
          </div>
        </>
      ) : null}

      {/* Voice / TTS controls */}
      <div className="mock-viva-voice-controls">
        <label>
          <input
            type="checkbox"
            checked={voiceOutputEnabled}
            onChange={(e) => setVoiceOutputEnabled(e.target.checked)}
          />
          AI voice output
        </label>
        <label>
          <input
            type="checkbox"
            checked={voiceInputEnabled}
            onChange={(e) => setVoiceInputEnabled(e.target.checked)}
            disabled={!supportsSpeechRecognition && !supportsMediaRecorder}
          />
          Voice input
        </label>
        {voiceInputEnabled ? (
          <label>
            <input
              type="checkbox"
              checked={useAzureVoice}
              onChange={(e) => setUseAzureVoice(e.target.checked)}
            />
            Use Azure AI voice
          </label>
        ) : null}
      </div>

      {error ? <p className="form-error">{error}</p> : null}

      {!sessionId && !summary ? (
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => void startSession()}
          disabled={loading}
        >
          {loading ? 'Preparing questions from your thesis...' : `Start ${modeLabel}`}
        </button>
      ) : null}

      {sessionId && liveMetrics ? (
        <article className="placeholder-card" style={{ marginTop: '0.25rem' }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'baseline',
              marginBottom: '0.5rem',
            }}
          >
            <h3 style={{ margin: 0 }}>Live Coaching Analytics</h3>
            <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
              Turn {liveMetrics.turn}
            </span>
          </div>

          <div
            style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}
          >
            <span
              style={{
                border: `1.5px solid ${DIFFICULTY_COLORS[liveMetrics.difficulty]}`,
                color: DIFFICULTY_COLORS[liveMetrics.difficulty],
                background: `${DIFFICULTY_COLORS[liveMetrics.difficulty]}10`,
                borderRadius: '999px',
                padding: '0.2rem 0.65rem',
                fontSize: '0.78rem',
                fontWeight: 700,
                textTransform: 'uppercase',
              }}
            >
              {liveMetrics.difficulty}
            </span>
            <span className="status-pill status-info">Sentiment: {liveMetrics.sentiment}</span>
            <span
              className="status-pill"
              style={{
                background:
                  liveMetrics.trend === 'improving'
                    ? 'rgba(22,163,74,0.1)'
                    : liveMetrics.trend === 'declining'
                      ? 'rgba(220,38,38,0.1)'
                      : 'rgba(0,0,0,0.05)',
                color:
                  liveMetrics.trend === 'improving'
                    ? '#16a34a'
                    : liveMetrics.trend === 'declining'
                      ? '#dc2626'
                      : 'var(--text-secondary)',
              }}
            >
              {TREND_ICONS[liveMetrics.trend]} {liveMetrics.trend}
            </span>
          </div>

          {/* Confidence bar */}
          <div style={{ marginBottom: '0.75rem' }}>
            <div
              style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem' }}
            >
              <span style={{ fontSize: '0.82rem', fontWeight: 600 }}>Confidence</span>
              <span
                style={{
                  fontSize: '0.82rem',
                  fontWeight: 700,
                  color:
                    liveMetrics.confidence >= 70
                      ? '#16a34a'
                      : liveMetrics.confidence >= 40
                        ? '#d97706'
                        : '#dc2626',
                }}
              >
                {liveMetrics.confidence}%
              </span>
            </div>
            <div className="metric-bar-track" style={{ height: '8px' }}>
              <div
                className="metric-bar-fill"
                style={{
                  width: `${Math.max(0, Math.min(100, liveMetrics.confidence))}%`,
                  background:
                    liveMetrics.confidence >= 70
                      ? '#16a34a'
                      : liveMetrics.confidence >= 40
                        ? '#d97706'
                        : '#dc2626',
                  transition: 'width 0.4s',
                }}
              />
            </div>
          </div>

          <p
            style={{
              marginBottom: '0.75rem',
              fontSize: '0.82rem',
              color: 'var(--text-secondary)',
              fontStyle: 'italic',
            }}
          >
            {adaptationMessage(liveMetrics)}
          </p>

          {/* Score dimensions with bars */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
              gap: '0.5rem',
              marginBottom: '0.6rem',
            }}
          >
            {(Object.keys(SCORE_LABELS) as Array<keyof TurnScores>).map((scoreKey) => {
              const val = liveMetrics.scores[scoreKey];
              return (
                <div key={scoreKey} className="metric-card" style={{ padding: '0.6rem' }}>
                  <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                    {SCORE_LABELS[scoreKey]}
                  </p>
                  <p style={{ margin: '0.15rem 0 0.3rem', fontWeight: 800, fontSize: '1rem' }}>
                    {val}%
                  </p>
                  <div className="metric-bar-track" style={{ height: '4px' }}>
                    <div
                      className="metric-bar-fill"
                      style={{
                        width: `${val}%`,
                        background: val >= 70 ? '#16a34a' : val >= 40 ? '#d97706' : '#dc2626',
                        transition: 'width 0.3s',
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          {liveMetrics.hesitation_signals.length > 0 ? (
            <div
              style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap', marginBottom: '0.25rem' }}
            >
              <span
                style={{
                  fontSize: '0.78rem',
                  color: 'var(--text-secondary)',
                  marginRight: '0.2rem',
                }}
              >
                Signals:
              </span>
              {liveMetrics.hesitation_signals.map((sig, i) => (
                <span
                  key={i}
                  style={{
                    display: 'inline-block',
                    padding: '0.1rem 0.45rem',
                    borderRadius: '999px',
                    fontSize: '0.72rem',
                    background: 'rgba(220,38,38,0.08)',
                    color: '#dc2626',
                    fontWeight: 500,
                  }}
                >
                  {sig}
                </span>
              ))}
            </div>
          ) : null}

          {metricsHistory.length > 1 ? (
            <div
              style={{
                marginTop: '0.5rem',
                display: 'flex',
                gap: '0.35rem',
                alignItems: 'center',
                flexWrap: 'wrap',
              }}
            >
              <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                Confidence trend:
              </span>
              {metricsHistory.map((entry, i) => (
                <span
                  key={i}
                  style={{
                    fontSize: '0.78rem',
                    fontWeight: 700,
                    color:
                      entry.confidence >= 70
                        ? '#16a34a'
                        : entry.confidence >= 40
                          ? '#d97706'
                          : '#dc2626',
                  }}
                >
                  {entry.confidence}%{i < metricsHistory.length - 1 ? ' →' : ''}
                </span>
              ))}
            </div>
          ) : null}
        </article>
      ) : null}

      <div className="mock-viva-chat">
        {messages.map((message, index) => {
          const isAssistant = message.role === 'assistant';
          const senderLabel = isAssistant
            ? selectedMode === 'mock_viva'
              ? 'Examiner'
              : selectedMode === 'argument_defender'
                ? 'Reviewer'
                : 'Coach'
            : 'You';
          const initials = isAssistant ? senderLabel.charAt(0) : 'Y';
          return (
            <div
              key={`${message.role}-${index}`}
              className={`chat-row ${isAssistant ? 'chat-row-left' : 'chat-row-right'}`}
            >
              {isAssistant ? <span className="chat-avatar chat-avatar-ai">{initials}</span> : null}
              <div className={`chat-bubble ${message.role}`}>
                <span className="chat-sender">{senderLabel}</span>
                <p>{message.content}</p>
              </div>
              {!isAssistant ? (
                <span className="chat-avatar chat-avatar-user">{initials}</span>
              ) : null}
            </div>
          );
        })}
      </div>

      {sessionId ? (
        <div className="mock-viva-input-row">
          <textarea
            rows={3}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type your answer..."
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void sendMessage();
            }}
          />
          <div>
            {voiceInputEnabled ? (
              <button
                type="button"
                className={`btn ${isListening ? 'btn-primary' : 'btn-ghost'}`}
                onClick={toggleListening}
                disabled={loading}
              >
                {isListening ? 'Stop Recording' : 'Use Mic'}
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
          <h3 style={{ marginBottom: '0.2rem' }}>Session Summary</h3>
          <div
            style={{
              display: 'flex',
              gap: '0.5rem',
              flexWrap: 'wrap',
              marginBottom: '1rem',
              fontSize: '0.82rem',
              color: 'var(--text-secondary)',
            }}
          >
            <span>{modeLabel}</span>
            {summary.learner_profile ? (
              <>
                <span>·</span>
                <span>{LEARNER_PROFILE_LABELS[summary.learner_profile]}</span>
              </>
            ) : null}
            {typeof summary.turns_completed === 'number' ? (
              <>
                <span>·</span>
                <span>{summary.turns_completed} turns</span>
              </>
            ) : null}
          </div>

          {/* Readiness score hero */}
          {typeof summary.readiness_score === 'number' ? (
            <div
              style={{
                background:
                  summary.readiness_score >= 70
                    ? 'rgba(22,163,74,0.06)'
                    : summary.readiness_score >= 40
                      ? 'rgba(217,119,6,0.06)'
                      : 'rgba(220,38,38,0.06)',
                border: `1px solid ${summary.readiness_score >= 70 ? 'rgba(22,163,74,0.2)' : summary.readiness_score >= 40 ? 'rgba(217,119,6,0.2)' : 'rgba(220,38,38,0.2)'}`,
                borderRadius: '12px',
                padding: '1rem 1.25rem',
                marginBottom: '1rem',
                display: 'flex',
                alignItems: 'center',
                gap: '1rem',
              }}
            >
              <div>
                <p
                  style={{
                    margin: 0,
                    fontSize: '0.82rem',
                    color: 'var(--text-secondary)',
                    fontWeight: 600,
                  }}
                >
                  Readiness Score
                </p>
                <p
                  style={{
                    margin: '0.1rem 0 0',
                    fontSize: '2rem',
                    fontWeight: 800,
                    color:
                      summary.readiness_score >= 70
                        ? '#16a34a'
                        : summary.readiness_score >= 40
                          ? '#d97706'
                          : '#dc2626',
                    lineHeight: 1,
                  }}
                >
                  {summary.readiness_score}%
                </p>
              </div>
              <div style={{ flex: 1 }}>
                <div className="metric-bar-track" style={{ height: '10px' }}>
                  <div
                    className="metric-bar-fill"
                    style={{
                      width: `${summary.readiness_score}%`,
                      background:
                        summary.readiness_score >= 70
                          ? '#16a34a'
                          : summary.readiness_score >= 40
                            ? '#d97706'
                            : '#dc2626',
                    }}
                  />
                </div>
                {typeof summary.progress_delta === 'number' ? (
                  <p
                    style={{
                      margin: '0.35rem 0 0',
                      fontSize: '0.82rem',
                      fontWeight: 600,
                      color: summary.progress_delta >= 0 ? '#16a34a' : '#dc2626',
                    }}
                  >
                    {summary.progress_delta >= 0 ? '+' : ''}
                    {summary.progress_delta} since last session
                  </p>
                ) : null}
              </div>
            </div>
          ) : null}

          {/* Weak areas as pills */}
          {Array.isArray(summary.weak_topics) && summary.weak_topics.length > 0 ? (
            <div style={{ marginBottom: '0.75rem' }}>
              <p
                style={{
                  margin: '0 0 0.35rem',
                  fontSize: '0.82rem',
                  fontWeight: 600,
                  color: 'var(--text-secondary)',
                }}
              >
                Areas to Improve
              </p>
              <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                {summary.weak_topics.map((topic, i) => (
                  <span
                    key={i}
                    style={{
                      display: 'inline-block',
                      padding: '0.2rem 0.6rem',
                      borderRadius: '999px',
                      fontSize: '0.78rem',
                      fontWeight: 500,
                      background: 'rgba(220,38,38,0.08)',
                      color: '#b91c1c',
                    }}
                  >
                    {topic}
                  </span>
                ))}
              </div>
            </div>
          ) : null}

          {/* Recommendation */}
          {typeof summary.recommendation === 'string' && summary.recommendation ? (
            <div
              style={{
                background: 'rgba(14,124,102,0.05)',
                border: '1px solid rgba(14,124,102,0.15)',
                borderRadius: '10px',
                padding: '0.75rem 1rem',
                marginBottom: '0.75rem',
                fontSize: '0.88rem',
                lineHeight: 1.5,
                color: 'var(--text)',
              }}
            >
              <p
                style={{
                  margin: '0 0 0.15rem',
                  fontWeight: 600,
                  fontSize: '0.82rem',
                  color: 'var(--primary)',
                }}
              >
                Recommendation
              </p>
              <p style={{ margin: 0 }}>{summary.recommendation}</p>
            </div>
          ) : null}

          {/* Dimension scores with bars */}
          {summary.dimension_summary?.averages ? (
            <div style={{ marginBottom: '0.75rem' }}>
              <p
                style={{
                  margin: '0 0 0.45rem',
                  fontSize: '0.82rem',
                  fontWeight: 600,
                  color: 'var(--text-secondary)',
                }}
              >
                Dimension Scores
              </p>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
                  gap: '0.55rem',
                }}
              >
                {(Object.keys(SCORE_LABELS) as Array<keyof TurnScores>).map((scoreKey) => {
                  const avg = summary.dimension_summary?.averages[scoreKey] ?? 0;
                  const delta = summary.dimension_summary?.deltas[scoreKey] ?? 0;
                  return (
                    <div
                      key={`summary-${scoreKey}`}
                      className="metric-card"
                      style={{ padding: '0.6rem' }}
                    >
                      <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                        {SCORE_LABELS[scoreKey]}
                      </p>
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'baseline',
                          gap: '0.35rem',
                          margin: '0.15rem 0 0.3rem',
                        }}
                      >
                        <span style={{ fontWeight: 800, fontSize: '1rem' }}>{avg}%</span>
                        {delta !== 0 ? (
                          <span
                            style={{
                              fontSize: '0.75rem',
                              fontWeight: 600,
                              color: delta > 0 ? '#16a34a' : '#dc2626',
                            }}
                          >
                            {delta > 0 ? '+' : ''}
                            {delta}
                          </span>
                        ) : null}
                      </div>
                      <div className="metric-bar-track" style={{ height: '4px' }}>
                        <div
                          className="metric-bar-fill"
                          style={{
                            width: `${avg}%`,
                            background: avg >= 70 ? '#16a34a' : avg >= 40 ? '#d97706' : '#dc2626',
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}

          {summary.dimension_summary ? (
            <div
              style={{
                display: 'flex',
                gap: '1rem',
                flexWrap: 'wrap',
                fontSize: '0.84rem',
                marginBottom: '0.5rem',
              }}
            >
              <span>
                Best improved:{' '}
                <strong style={{ color: '#16a34a' }}>
                  {SCORE_LABELS[summary.dimension_summary.best_improved]}
                </strong>
              </span>
              <span>
                Needs work:{' '}
                <strong style={{ color: '#dc2626' }}>
                  {SCORE_LABELS[summary.dimension_summary.weakest_persistent]}
                </strong>
              </span>
            </div>
          ) : null}

          <button
            type="button"
            className="btn btn-primary"
            style={{ marginTop: '1rem' }}
            onClick={() => {
              setSummary(null);
              setMessages([]);
              setQuestionIndex(0);
              setLiveMetrics(null);
              setMetricsHistory([]);
            }}
          >
            Start New Session
          </button>
        </article>
      ) : null}
    </section>
  );
}
