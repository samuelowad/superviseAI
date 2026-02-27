import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.js?url';

import { getAccessToken } from '../../auth/storage';
import { apiRequest } from '../../lib/api';
import { Link } from '../../lib/router';
import { subscribeRealtime } from '../../lib/socket';

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
  abstract_alignment_verdict: string;
  plagiarism_similarity: number;
  last_submission_at: string | null;
  ai_status_note: string;
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
  cohort_id: string;
  cohort_name: string;
  title: string;
  stage: string;
  due_date: string;
  due_in_days: number | null;
  completion: {
    total_students: number;
    completed_students: number;
    pending_students: number;
  };
  created_at: string;
  updated_at: string;
}

interface MilestonesResponse {
  milestones: MilestoneRecord[];
}

interface CohortRecord {
  id: string;
  name: string;
  citation_style: string;
  student_count: number;
  created_at: string;
}

interface EnrollmentRecord {
  id: string;
  student_id: string;
  student_name: string;
  student_email: string;
  enrolled_at: string;
}

interface CohortsResponse {
  cohorts: CohortRecord[];
}

interface EnrollmentsResponse {
  cohort: CohortRecord;
  enrollments: EnrollmentRecord[];
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
  abstract_alignment: {
    verdict: string;
    key_topic_coverage: string[];
    missing_core_sections: string[];
    structural_readiness: string;
  };
  ai_review: {
    status_note: string;
    change_summary: string;
    recommended_feedback: string[];
    stage_context: string | null;
  } | null;
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

interface CreateMilestoneInput extends MilestoneDraft {
  cohort_id: string;
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

function LineChart({
  data,
  width = 400,
  height = 180,
}: {
  data: Array<{ x: number; y: number; label: string }>;
  width?: number;
  height?: number;
}): JSX.Element {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  if (data.length === 0) return <p>No data.</p>;
  const pad = { top: 16, right: 20, bottom: 28, left: 36 };
  const w = width - pad.left - pad.right;
  const h = height - pad.top - pad.bottom;
  const xs = data.map((d) => d.x);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const toSvgX = (x: number) =>
    maxX === minX ? pad.left + w / 2 : pad.left + ((x - minX) / (maxX - minX)) * w;
  const toSvgY = (y: number) => pad.top + (1 - y / 100) * h;

  /* smoothed cubic path for the line */
  const pts = data.map((d) => ({ x: toSvgX(d.x), y: toSvgY(d.y) }));
  let linePath = `M${pts[0].x},${pts[0].y}`;
  for (let i = 1; i < pts.length; i++) {
    const prev = pts[i - 1];
    const cur = pts[i];
    const cpx = (prev.x + cur.x) / 2;
    linePath += ` C${cpx},${prev.y} ${cpx},${cur.y} ${cur.x},${cur.y}`;
  }

  /* area fill path (same curve, then close along bottom) */
  const areaPath = `${linePath} L${pts[pts.length - 1].x},${pad.top + h} L${pts[0].x},${pad.top + h} Z`;

  const gradientId = 'lc-grad-' + data.length;
  const lineGradId = 'lc-line-grad-' + data.length;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="xMidYMid meet"
      className="analytics-line-chart"
      aria-label="Progress chart"
      onMouseLeave={() => setHoveredIdx(null)}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.25" />
          <stop offset="100%" stopColor="var(--primary)" stopOpacity="0.02" />
        </linearGradient>
        <linearGradient id={lineGradId} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.6" />
          <stop offset="50%" stopColor="var(--primary)" stopOpacity="1" />
          <stop offset="100%" stopColor="var(--primary)" stopOpacity="0.85" />
        </linearGradient>
      </defs>

      {/* Horizontal grid lines */}
      {[0, 25, 50, 75, 100].map((y) => (
        <line
          key={y}
          x1={pad.left}
          y1={toSvgY(y)}
          x2={pad.left + w}
          y2={toSvgY(y)}
          stroke="rgba(0,0,0,0.06)"
          strokeWidth="1"
          strokeDasharray={y === 0 || y === 100 ? 'none' : '3,3'}
        />
      ))}

      {/* Y-axis labels */}
      {[0, 50, 100].map((y) => (
        <text
          key={y}
          x={pad.left - 6}
          y={toSvgY(y) + 3.5}
          fontSize="9"
          textAnchor="end"
          fill="#aaa"
          fontWeight="500"
        >
          {y}
        </text>
      ))}

      {/* Gradient area fill */}
      <path d={areaPath} fill={`url(#${gradientId})`} className="analytics-area-path" />

      {/* Main curve */}
      <path
        d={linePath}
        fill="none"
        stroke={`url(#${lineGradId})`}
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="analytics-line-path"
      />

      {/* Hover crosshair */}
      {hoveredIdx !== null && pts[hoveredIdx] ? (
        <line
          x1={pts[hoveredIdx].x}
          y1={pad.top}
          x2={pts[hoveredIdx].x}
          y2={pad.top + h}
          stroke="var(--primary)"
          strokeWidth="1"
          strokeDasharray="3,3"
          opacity="0.4"
        />
      ) : null}

      {/* Data points */}
      {pts.map((pt, i) => {
        const isHovered = hoveredIdx === i;
        return (
          <g key={i} onMouseEnter={() => setHoveredIdx(i)} style={{ cursor: 'pointer' }}>
            {/* Larger invisible hit area */}
            <circle cx={pt.x} cy={pt.y} r="12" fill="transparent" />
            {/* Glow ring on hover */}
            {isHovered ? (
              <circle cx={pt.x} cy={pt.y} r="8" fill="var(--primary)" opacity="0.12" />
            ) : null}
            {/* Dot */}
            <circle
              cx={pt.x}
              cy={pt.y}
              r={isHovered ? 5 : 3.5}
              fill="#fff"
              stroke="var(--primary)"
              strokeWidth={isHovered ? 2.5 : 2}
              style={{ transition: 'r 0.15s, stroke-width 0.15s' }}
            />
          </g>
        );
      })}

      {/* X-axis labels */}
      {data.map((d, i) => (
        <text
          key={`lbl-${d.x}`}
          x={pts[i].x}
          y={pad.top + h + 16}
          fontSize="9"
          textAnchor="middle"
          fill={hoveredIdx === i ? 'var(--primary)' : '#aaa'}
          fontWeight={hoveredIdx === i ? 700 : 500}
        >
          V{d.x}
        </text>
      ))}

      {/* Floating tooltip */}
      {hoveredIdx !== null && data[hoveredIdx]
        ? (() => {
            const d = data[hoveredIdx];
            const pt = pts[hoveredIdx];
            const tooltipW = 110;
            const tooltipH = 38;
            let tx = pt.x - tooltipW / 2;
            if (tx < pad.left) tx = pad.left;
            if (tx + tooltipW > width - pad.right) tx = width - pad.right - tooltipW;
            const ty = pt.y - tooltipH - 12;
            return (
              <g className="analytics-tooltip">
                <rect
                  x={tx}
                  y={ty}
                  width={tooltipW}
                  height={tooltipH}
                  rx="6"
                  fill="#1a1a2e"
                  opacity="0.92"
                />
                <polygon
                  points={`${pt.x - 5},${ty + tooltipH} ${pt.x + 5},${ty + tooltipH} ${pt.x},${ty + tooltipH + 5}`}
                  fill="#1a1a2e"
                  opacity="0.92"
                />
                <text
                  x={tx + tooltipW / 2}
                  y={ty + 15}
                  textAnchor="middle"
                  fill="#fff"
                  fontSize="10"
                  fontWeight="700"
                >
                  {d.y}% progress
                </text>
                <text
                  x={tx + tooltipW / 2}
                  y={ty + 28}
                  textAnchor="middle"
                  fill="rgba(255,255,255,0.6)"
                  fontSize="8.5"
                >
                  {d.label.split(':')[0]}
                </text>
              </g>
            );
          })()
        : null}
    </svg>
  );
}

function BarChart({
  data,
  width = 400,
  height = 180,
}: {
  data: Array<{ x: string; y: number; label: string }>;
  width?: number;
  height?: number;
}): JSX.Element {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  if (data.length === 0) return <p>No data.</p>;
  const pad = { top: 16, right: 20, bottom: 32, left: 36 };
  const w = width - pad.left - pad.right;
  const h = height - pad.top - pad.bottom;
  const maxY = Math.max(...data.map((d) => d.y), 1);
  const gap = w / data.length;
  const barW = Math.min(Math.max(6, gap * 0.55), 32);
  const barGradId = 'bc-grad-' + data.length;

  /* Rounded y-axis tick values */
  const yTicks: number[] = [];
  const step = maxY <= 4 ? 1 : Math.ceil(maxY / 4);
  for (let v = 0; v <= maxY; v += step) yTicks.push(v);
  if (yTicks[yTicks.length - 1] < maxY) yTicks.push(Math.ceil(maxY));

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="xMidYMid meet"
      className="analytics-bar-chart"
      aria-label="Activity chart"
      onMouseLeave={() => setHoveredIdx(null)}
    >
      <defs>
        <linearGradient id={barGradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.95" />
          <stop offset="100%" stopColor="var(--primary)" stopOpacity="0.55" />
        </linearGradient>
      </defs>

      {/* Horizontal grid lines */}
      {yTicks.map((v) => {
        const yPos = pad.top + (1 - v / maxY) * h;
        return (
          <g key={v}>
            <line
              x1={pad.left}
              y1={yPos}
              x2={pad.left + w}
              y2={yPos}
              stroke="rgba(0,0,0,0.06)"
              strokeWidth="1"
              strokeDasharray={v === 0 ? 'none' : '3,3'}
            />
            <text
              x={pad.left - 6}
              y={yPos + 3.5}
              fontSize="9"
              textAnchor="end"
              fill="#aaa"
              fontWeight="500"
            >
              {v}
            </text>
          </g>
        );
      })}

      {/* Bars */}
      {data.map((d, idx) => {
        const barH = (d.y / maxY) * h;
        const cx = pad.left + gap * idx + gap / 2;
        const isHovered = hoveredIdx === idx;
        const barX = cx - barW / 2;
        const barY = pad.top + h - barH;
        return (
          <g key={idx} onMouseEnter={() => setHoveredIdx(idx)} style={{ cursor: 'pointer' }}>
            {/* Invisible hit area */}
            <rect
              x={cx - gap / 2}
              y={pad.top}
              width={gap}
              height={h + pad.bottom}
              fill="transparent"
            />

            {/* Hover background strip */}
            {isHovered ? (
              <rect
                x={cx - gap / 2}
                y={pad.top}
                width={gap}
                height={h}
                fill="var(--primary)"
                opacity="0.04"
                rx="4"
              />
            ) : null}

            {/* Bar */}
            <rect
              x={barX}
              y={barY}
              width={barW}
              height={barH}
              fill={isHovered ? 'var(--primary)' : `url(#${barGradId})`}
              rx={Math.min(barW / 2, 4)}
              className="analytics-bar-rect"
              style={{ animationDelay: `${idx * 0.06}s` }}
            />

            {/* Value label on hover */}
            {isHovered ? (
              <text
                x={cx}
                y={barY - 6}
                textAnchor="middle"
                fontSize="10"
                fontWeight="700"
                fill="var(--primary)"
              >
                {d.y}
              </text>
            ) : null}

            {/* X-axis labels */}
            <text
              x={cx}
              y={pad.top + h + 16}
              fontSize={data.length > 12 ? '7' : '8.5'}
              textAnchor="middle"
              fill={isHovered ? 'var(--primary)' : '#aaa'}
              fontWeight={isHovered ? 700 : 500}
            >
              {d.x.slice(5)}
            </text>
          </g>
        );
      })}

      {/* Floating tooltip */}
      {hoveredIdx !== null && data[hoveredIdx]
        ? (() => {
            const d = data[hoveredIdx];
            const cx = pad.left + gap * hoveredIdx + gap / 2;
            const barH = (d.y / maxY) * h;
            const barY = pad.top + h - barH;
            const tooltipW = 120;
            const tooltipH = 36;
            let tx = cx - tooltipW / 2;
            if (tx < pad.left) tx = pad.left;
            if (tx + tooltipW > width - pad.right) tx = width - pad.right - tooltipW;
            const ty = barY - tooltipH - 14;
            return ty > 0 ? (
              <g className="analytics-tooltip">
                <rect
                  x={tx}
                  y={ty}
                  width={tooltipW}
                  height={tooltipH}
                  rx="6"
                  fill="#1a1a2e"
                  opacity="0.92"
                />
                <polygon
                  points={`${cx - 5},${ty + tooltipH} ${cx + 5},${ty + tooltipH} ${cx},${ty + tooltipH + 5}`}
                  fill="#1a1a2e"
                  opacity="0.92"
                />
                <text
                  x={tx + tooltipW / 2}
                  y={ty + 14}
                  textAnchor="middle"
                  fill="#fff"
                  fontSize="10"
                  fontWeight="700"
                >
                  {d.y} submission{d.y !== 1 ? 's' : ''}
                </text>
                <text
                  x={tx + tooltipW / 2}
                  y={ty + 27}
                  textAnchor="middle"
                  fill="rgba(255,255,255,0.6)"
                  fontSize="8.5"
                >
                  {d.label.split(':')[0]}
                </text>
              </g>
            ) : null;
          })()
        : null}
    </svg>
  );
}

function VisualTimeline({
  entries,
}: {
  entries: Array<{
    id: string;
    label: string;
    timestamp: string;
    type: 'status' | 'submission' | 'feedback';
  }>;
}): JSX.Element {
  const dotColor = (type: 'status' | 'submission' | 'feedback'): string => {
    if (type === 'submission') return 'var(--primary)';
    if (type === 'feedback') return '#f59e0b';
    return '#2563eb';
  };
  return (
    <div
      style={{ position: 'relative', paddingLeft: '28px', borderLeft: '2px solid var(--border)' }}
    >
      {entries.map((entry, idx) => (
        <div
          key={entry.id}
          style={{
            position: 'relative',
            paddingBottom: idx < entries.length - 1 ? '1rem' : 0,
            borderBottom: idx < entries.length - 1 ? '1px solid var(--border)' : 'none',
            marginBottom: idx < entries.length - 1 ? '1rem' : 0,
          }}
        >
          <span
            style={{
              position: 'absolute',
              left: '-35px',
              top: '2px',
              width: '12px',
              height: '12px',
              borderRadius: '50%',
              background: dotColor(entry.type),
              display: 'block',
            }}
          />
          <strong style={{ display: 'block', fontSize: '0.9rem' }}>{entry.label}</strong>
          <span style={{ color: 'var(--text-secondary, #666)', fontSize: '0.78rem' }}>
            {formatDate(entry.timestamp)}
          </span>
        </div>
      ))}
    </div>
  );
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
    <section className="placeholder-card" style={{ textAlign: 'center', padding: '3rem' }}>
      <div className="spinner" role="status" aria-label={message} />
      <p style={{ marginTop: '0.75rem' }}>{message}</p>
    </section>
  );
}

function ErrorCard({ message }: { message: string }): JSX.Element {
  return (
    <section className="placeholder-card">
      <h2 style={{ color: 'var(--risk, #dc2626)' }}>Something went wrong</h2>
      <p>{message}</p>
    </section>
  );
}

export function ProfessorDashboardPage(): JSX.Element {
  const [data, setData] = useState<ProfessorDashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadDashboard = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const response = await apiRequest<ProfessorDashboardResponse>('/dashboard/professor');
      setData(response);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load dashboard.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  useEffect(() => {
    const unsubDashboard = subscribeRealtime('dashboard.student_update', () => {
      void loadDashboard();
    });
    const unsubPlagiarism = subscribeRealtime('plagiarism.ready', () => {
      void loadDashboard();
    });

    return () => {
      unsubDashboard();
      unsubPlagiarism();
    };
  }, [loadDashboard]);

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
          <div className="metric-bar-track">
            <div
              className="metric-bar-fill"
              style={{
                width: data.summary.total_students
                  ? `${(data.summary.active_theses / data.summary.total_students) * 100}%`
                  : '0%',
              }}
            />
          </div>
          <p>{data.summary.total_students - data.summary.active_theses} completed</p>
        </article>
        <article className="metric-card">
          <h3>Awaiting Review</h3>
          <p
            className="metric-value"
            style={{
              color: data.summary.awaiting_review > 0 ? '#d97706' : undefined,
            }}
          >
            {data.summary.awaiting_review}
          </p>
          <p
            style={{
              fontWeight: data.summary.awaiting_review > 0 ? 700 : undefined,
              color: data.summary.awaiting_review > 0 ? '#d97706' : undefined,
            }}
          >
            {data.summary.awaiting_review > 0 ? 'Need your decision' : 'All reviewed'}
          </p>
        </article>
        <article className="metric-card">
          <h3>At-Risk</h3>
          <p
            className="metric-value"
            style={{
              color: data.summary.at_risk_count > 0 ? 'var(--risk, #dc2626)' : 'var(--success)',
            }}
          >
            {data.summary.at_risk_count}
          </p>
          <p
            style={{
              fontWeight: data.summary.at_risk_count > 0 ? 700 : undefined,
              color: data.summary.at_risk_count > 0 ? 'var(--risk, #dc2626)' : undefined,
            }}
          >
            {data.summary.at_risk_count > 0 ? 'Needs intervention' : 'All on track'}
          </p>
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
                    <small style={{ color: 'var(--text-secondary)' }}>
                      {student.student_email ?? 'No email'}
                    </small>
                  </td>
                  <td
                    style={{
                      maxWidth: 220,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {student.thesis_title}
                    <br />
                    <small style={{ color: 'var(--text-secondary)' }}>
                      Alignment: {student.abstract_alignment_verdict.replace(/_/g, ' ')}
                    </small>
                    <br />
                    <small style={{ color: 'var(--text-secondary)' }}>
                      {student.ai_status_note}
                    </small>
                  </td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                      <span>{student.progress_score}%</span>
                      <span
                        className={student.trend_delta >= 0 ? 'trend-up' : 'trend-down'}
                        style={{ fontSize: '0.78rem' }}
                      >
                        {student.trend_delta >= 0 ? '+' : ''}
                        {student.trend_delta}
                      </span>
                    </div>
                    <div className="metric-bar-track" style={{ marginTop: '0.25rem' }}>
                      <div
                        className="metric-bar-fill"
                        style={{ width: `${student.progress_score}%` }}
                      />
                    </div>
                  </td>
                  <td>
                    <span className={`risk-dot ${riskClass(student.risk_level)}`} />
                    {student.plagiarism_similarity}%
                  </td>
                  <td style={{ fontSize: '0.82rem' }}>{formatDate(student.last_submission_at)}</td>
                  <td>
                    <span className={`status-pill ${statusTone(student.thesis_status_label)}`}>
                      {student.thesis_status_label}
                    </span>
                  </td>
                  <td>
                    <span className={`risk-dot ${riskClass(student.risk_level)}`} />
                    <strong
                      style={{
                        color:
                          student.risk_level === 'red'
                            ? 'var(--risk, #dc2626)'
                            : student.risk_level === 'yellow'
                              ? '#d97706'
                              : 'var(--success)',
                      }}
                    >
                      {student.risk_level.toUpperCase()}
                    </strong>
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

  const loadStudents = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const response = await apiRequest<{ students: ProfessorStudentRow[] }>(
        '/dashboard/professor/students',
      );
      setStudents(response.students);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load students.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadStudents();
  }, [loadStudents]);

  useEffect(() => {
    const unsubDashboard = subscribeRealtime('dashboard.student_update', () => {
      void loadStudents();
    });
    const unsubPlagiarism = subscribeRealtime('plagiarism.ready', () => {
      void loadStudents();
    });

    return () => {
      unsubDashboard();
      unsubPlagiarism();
    };
  }, [loadStudents]);

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
                    <small style={{ color: 'var(--text-secondary)' }}>
                      {student.student_email ?? 'No email'}
                    </small>
                  </td>
                  <td
                    style={{
                      maxWidth: 220,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {student.thesis_title}
                    <br />
                    <small style={{ color: 'var(--text-secondary)' }}>
                      Alignment: {student.abstract_alignment_verdict.replace(/_/g, ' ')}
                    </small>
                    <br />
                    <small style={{ color: 'var(--text-secondary)' }}>
                      {student.ai_status_note}
                    </small>
                  </td>
                  <td>
                    <span className={`status-pill ${statusTone(student.thesis_status_label)}`}>
                      {student.thesis_status_label}
                    </span>
                  </td>
                  <td>
                    <div>{student.progress_score}%</div>
                    <div className="metric-bar-track" style={{ marginTop: '0.25rem' }}>
                      <div
                        className="metric-bar-fill"
                        style={{ width: `${student.progress_score}%` }}
                      />
                    </div>
                  </td>
                  <td className={student.trend_delta >= 0 ? 'trend-up' : 'trend-down'}>
                    {student.trend_delta >= 0 ? '+' : ''}
                    {student.trend_delta}
                  </td>
                  <td>
                    <span className={`risk-dot ${riskClass(student.risk_level)}`} />
                    <strong
                      style={{
                        color:
                          student.risk_level === 'red'
                            ? 'var(--risk, #dc2626)'
                            : student.risk_level === 'yellow'
                              ? '#d97706'
                              : 'var(--success)',
                      }}
                    >
                      {student.risk_level.toUpperCase()}
                    </strong>
                  </td>
                  <td style={{ fontSize: '0.82rem' }}>
                    {student.risk_reasons.length > 0 ? (
                      <span style={{ color: 'var(--risk, #dc2626)' }}>
                        {student.risk_reasons.join(', ')}
                      </span>
                    ) : (
                      <span style={{ color: 'var(--success)' }}>Stable</span>
                    )}
                  </td>
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
  const [cohorts, setCohorts] = useState<CohortRecord[]>([]);
  const [selectedCohortId, setSelectedCohortId] = useState<string>('all');
  const [drafts, setDrafts] = useState<Record<string, MilestoneDraft>>({});
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [creatingCohort, setCreatingCohort] = useState(false);
  const [cohortName, setCohortName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [createInput, setCreateInput] = useState<CreateMilestoneInput>({
    cohort_id: '',
    title: '',
    stage: 'draft_review',
    due_date: '',
  });

  const loadMilestones = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const [cohortsResponse, milestonesResponse] = await Promise.all([
        apiRequest<{ cohorts: CohortRecord[] }>('/cohorts'),
        apiRequest<MilestonesResponse>('/milestones'),
      ]);

      setCohorts(cohortsResponse.cohorts);
      setMilestones(milestonesResponse.milestones);

      if (cohortsResponse.cohorts.length > 0) {
        const fallbackCohortId = cohortsResponse.cohorts[0].id;
        setCreateInput((previous) => ({
          ...previous,
          cohort_id: previous.cohort_id || fallbackCohortId,
        }));
      }

      const nextDrafts: Record<string, MilestoneDraft> = {};
      for (const milestone of milestonesResponse.milestones) {
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
  }, []);

  useEffect(() => {
    void loadMilestones();
  }, [loadMilestones]);

  async function handleCreate(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setCreating(true);
    setError(null);
    setNotice(null);

    if (!createInput.cohort_id) {
      setCreating(false);
      setError('Select a cohort before creating a milestone.');
      return;
    }

    try {
      await apiRequest<{ milestone: MilestoneRecord }>('/milestones', {
        method: 'POST',
        body: createInput,
      });
      setCreateInput((previous) => ({
        ...previous,
        title: '',
        stage: 'draft_review',
        due_date: '',
      }));
      setNotice('Milestone created.');
      await loadMilestones();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create milestone.');
    } finally {
      setCreating(false);
    }
  }

  async function handleCreateCohort(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const name = cohortName.trim();
    if (!name) {
      setError('Cohort name is required.');
      return;
    }

    setCreatingCohort(true);
    setError(null);
    setNotice(null);
    try {
      await apiRequest<{ cohort: CohortRecord }>('/cohorts', {
        method: 'POST',
        body: {
          name,
          citation_style: 'APA',
        },
      });
      setCohortName('');
      setNotice('Cohort created.');
      await loadMilestones();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create cohort.');
    } finally {
      setCreatingCohort(false);
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

  const visibleMilestones = useMemo(() => {
    if (selectedCohortId === 'all') {
      return milestones;
    }

    return milestones.filter((milestone) => milestone.cohort_id === selectedCohortId);
  }, [milestones, selectedCohortId]);

  return (
    <div className="professor-page-grid">
      <section className="placeholder-card">
        <h2>Create Cohort</h2>
        <form className="professor-form-grid" onSubmit={(event) => void handleCreateCohort(event)}>
          <input
            className="text-field"
            placeholder="Cohort name"
            value={cohortName}
            onChange={(event) => setCohortName(event.target.value)}
          />
          <button type="submit" className="btn btn-muted" disabled={creatingCohort}>
            {creatingCohort ? 'Creating...' : 'Create Cohort'}
          </button>
        </form>
      </section>

      <section className="placeholder-card">
        <h2>Create Milestone</h2>
        <form className="professor-form-grid" onSubmit={(event) => void handleCreate(event)}>
          <select
            className="text-field"
            value={createInput.cohort_id}
            onChange={(event) =>
              setCreateInput((previous) => ({ ...previous, cohort_id: event.target.value }))
            }
          >
            {cohorts.length === 0 ? <option value="">No cohorts available</option> : null}
            {cohorts.map((cohort) => (
              <option key={cohort.id} value={cohort.id}>
                {cohort.name} ({cohort.student_count} students)
              </option>
            ))}
          </select>
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
        <div className="professor-section-header">
          <h2>Your Milestones</h2>
          <select
            className="text-field"
            value={selectedCohortId}
            onChange={(event) => setSelectedCohortId(event.target.value)}
          >
            <option value="all">All Cohorts</option>
            {cohorts.map((cohort) => (
              <option key={cohort.id} value={cohort.id}>
                {cohort.name}
              </option>
            ))}
          </select>
        </div>
        {loading ? (
          <p>Loading milestones...</p>
        ) : visibleMilestones.length === 0 ? (
          <p>No milestones created yet.</p>
        ) : (
          <table className="simple-table">
            <thead>
              <tr>
                <th>Cohort</th>
                <th>Title</th>
                <th>Stage</th>
                <th>Due Date</th>
                <th>Completion</th>
                <th>Due In</th>
                <th>Save</th>
              </tr>
            </thead>
            <tbody>
              {visibleMilestones.map((milestone) => {
                const draft = drafts[milestone.id] ?? {
                  title: milestone.title,
                  stage: milestone.stage,
                  due_date: milestone.due_date,
                };

                return (
                  <tr key={milestone.id}>
                    <td>{milestone.cohort_name}</td>
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
                      <div style={{ fontSize: '0.82rem' }}>
                        {milestone.completion.completed_students}/
                        {milestone.completion.total_students}
                      </div>
                      {milestone.completion.total_students > 0 ? (
                        <div className="metric-bar-track" style={{ marginTop: '0.25rem' }}>
                          <div
                            className="metric-bar-fill"
                            style={{
                              width: `${(milestone.completion.completed_students / milestone.completion.total_students) * 100}%`,
                              background:
                                milestone.completion.completed_students ===
                                milestone.completion.total_students
                                  ? 'var(--success)'
                                  : 'var(--primary)',
                            }}
                          />
                        </div>
                      ) : null}
                    </td>
                    <td
                      style={{
                        color:
                          milestone.due_in_days !== null && milestone.due_in_days < 0
                            ? 'var(--risk, #dc2626)'
                            : milestone.due_in_days !== null && milestone.due_in_days < 3
                              ? '#d97706'
                              : undefined,
                        fontWeight:
                          milestone.due_in_days !== null && milestone.due_in_days < 3
                            ? 700
                            : undefined,
                      }}
                    >
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

  /* ---- derived stats ---- */
  const totalSubmissions = data.submission_activity.reduce((s, e) => s + e.submissions, 0);
  const peakDay =
    data.submission_activity.length > 0
      ? data.submission_activity.reduce((best, e) => (e.submissions > best.submissions ? e : best))
      : null;
  const latestProgress =
    data.progress_trend.length > 0 ? data.progress_trend[data.progress_trend.length - 1] : null;
  const earliestProgress = data.progress_trend.length > 1 ? data.progress_trend[0] : null;
  const progressDelta =
    latestProgress && earliestProgress
      ? latestProgress.average_progress - earliestProgress.average_progress
      : null;

  /* risk percentages */
  const total = data.totals.supervised_students || 1;
  const greenPct = Math.round((data.risk_distribution.green / total) * 100);
  const yellowPct = Math.round((data.risk_distribution.yellow / total) * 100);
  const redPct = Math.round((data.risk_distribution.red / total) * 100);

  return (
    <div className="professor-page-grid">
      {/* ---- Page header ---- */}
      <header style={{ marginBottom: '0.25rem' }}>
        <h1 style={{ fontSize: '1.4rem', margin: 0 }}>Analytics Overview</h1>
        <p
          style={{ color: 'var(--text-secondary, #666)', marginTop: '0.25rem', fontSize: '0.9rem' }}
        >
          Aggregated insights across all supervised students
        </p>
      </header>

      {/* ---- Summary metrics ---- */}
      <section className="workspace-metrics-grid">
        <article className="metric-card metric-primary">
          <h3>Students</h3>
          <p className="metric-value">{data.totals.supervised_students}</p>
          <p>Under supervision</p>
        </article>
        <article className="metric-card">
          <h3>Avg Progress</h3>
          <p className="metric-value">{data.totals.average_progress_score}%</p>
          <div className="metric-bar-track">
            <div
              className="metric-bar-fill"
              style={{ width: `${data.totals.average_progress_score}%` }}
            />
          </div>
          {progressDelta !== null ? (
            <p
              style={{
                color: progressDelta >= 0 ? 'var(--success, #0f9d58)' : 'var(--risk, #dc2626)',
                fontWeight: 600,
                fontSize: '0.82rem',
              }}
            >
              {progressDelta >= 0 ? '+' : ''}
              {progressDelta}% over period
            </p>
          ) : (
            <p>Across all students</p>
          )}
        </article>
        <article className="metric-card">
          <h3>At Risk</h3>
          <p
            className="metric-value"
            style={{
              color: data.totals.at_risk_count > 0 ? 'var(--risk, #dc2626)' : 'var(--success)',
            }}
          >
            {data.totals.at_risk_count}
          </p>
          <p
            style={{
              fontWeight: data.totals.at_risk_count > 0 ? 700 : undefined,
              color: data.totals.at_risk_count > 0 ? 'var(--risk, #dc2626)' : undefined,
            }}
          >
            {data.totals.at_risk_count > 0
              ? `${Math.round((data.totals.at_risk_count / total) * 100)}% of cohort`
              : 'All on track'}
          </p>
        </article>
        <article className="metric-card">
          <h3>Total Submissions</h3>
          <p className="metric-value">{totalSubmissions}</p>
          {peakDay ? (
            <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary, #666)' }}>
              Peak: {peakDay.submissions} on {formatDateOnly(peakDay.date)}
            </p>
          ) : (
            <p>No submissions yet</p>
          )}
        </article>
      </section>

      {/* ---- Risk distribution breakdown ---- */}
      <section className="placeholder-card">
        <h2 style={{ marginBottom: '0.5rem' }}>Risk Distribution</h2>
        <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
              <span className="risk-dot risk-green" />
              <strong>{data.risk_distribution.green}</strong>
              <span style={{ color: 'var(--text-secondary, #666)', fontSize: '0.82rem' }}>
                On Track ({greenPct}%)
              </span>
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
              <span className="risk-dot risk-yellow" />
              <strong>{data.risk_distribution.yellow}</strong>
              <span style={{ color: 'var(--text-secondary, #666)', fontSize: '0.82rem' }}>
                Warning ({yellowPct}%)
              </span>
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
              <span className="risk-dot risk-red" />
              <strong>{data.risk_distribution.red}</strong>
              <span style={{ color: 'var(--text-secondary, #666)', fontSize: '0.82rem' }}>
                At Risk ({redPct}%)
              </span>
            </span>
          </div>
          {data.totals.supervised_students > 0 ? (
            <div style={{ flex: 1, minWidth: '200px' }}>
              <div
                style={{
                  display: 'flex',
                  height: 10,
                  borderRadius: 999,
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    width: `${greenPct}%`,
                    background: '#0f9d58',
                    transition: 'width 0.4s',
                  }}
                />
                <div
                  style={{
                    width: `${yellowPct}%`,
                    background: '#f59e0b',
                    transition: 'width 0.4s',
                  }}
                />
                <div
                  style={{
                    width: `${redPct}%`,
                    background: '#dc2626',
                    transition: 'width 0.4s',
                  }}
                />
              </div>
            </div>
          ) : null}
        </div>
      </section>

      {/* ---- Charts side-by-side ---- */}
      <div className="analytics-chart-row">
        <section className="placeholder-card" style={{ flex: 1, minWidth: 0 }}>
          <h2 style={{ marginBottom: '0.15rem' }}>Progress Trend</h2>
          <p
            style={{
              color: 'var(--text-secondary, #666)',
              fontSize: '0.82rem',
              marginBottom: '0.75rem',
            }}
          >
            Average progress score over time
          </p>
          {data.progress_trend.length === 0 ? (
            <p
              style={{
                color: 'var(--text-secondary, #666)',
                padding: '2rem 0',
                textAlign: 'center',
              }}
            >
              Not enough data to show a trend yet. Progress will appear after multiple submissions.
            </p>
          ) : (
            <>
              <LineChart
                data={data.progress_trend.map((entry, idx) => ({
                  x: idx + 1,
                  y: entry.average_progress,
                  label: `${formatDateOnly(entry.date)}: ${entry.average_progress}% (${entry.samples} samples)`,
                }))}
                height={180}
              />
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontSize: '0.78rem',
                  color: 'var(--text-secondary, #666)',
                  marginTop: '0.5rem',
                  padding: '0 0.25rem',
                }}
              >
                <span>{data.progress_trend.length} data points</span>
                {latestProgress ? (
                  <span>
                    Latest:{' '}
                    <strong style={{ color: 'var(--text-primary, #222)' }}>
                      {latestProgress.average_progress}%
                    </strong>
                  </span>
                ) : null}
              </div>
            </>
          )}
        </section>

        <section className="placeholder-card" style={{ flex: 1, minWidth: 0 }}>
          <h2 style={{ marginBottom: '0.15rem' }}>Submission Activity</h2>
          <p
            style={{
              color: 'var(--text-secondary, #666)',
              fontSize: '0.82rem',
              marginBottom: '0.75rem',
            }}
          >
            Number of submissions per day
          </p>
          {data.submission_activity.length === 0 ? (
            <p
              style={{
                color: 'var(--text-secondary, #666)',
                padding: '2rem 0',
                textAlign: 'center',
              }}
            >
              No submission activity recorded yet. Data will appear as students submit drafts.
            </p>
          ) : (
            <>
              <BarChart
                data={data.submission_activity.map((entry) => ({
                  x: entry.date,
                  y: entry.submissions,
                  label: `${formatDateOnly(entry.date)}: ${entry.submissions} submissions`,
                }))}
                height={180}
              />
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontSize: '0.78rem',
                  color: 'var(--text-secondary, #666)',
                  marginTop: '0.5rem',
                  padding: '0 0.25rem',
                }}
              >
                <span>{totalSubmissions} total submissions</span>
                {peakDay ? (
                  <span>
                    Peak:{' '}
                    <strong style={{ color: 'var(--text-primary, #222)' }}>
                      {peakDay.submissions}
                    </strong>{' '}
                    on {formatDateOnly(peakDay.date)}
                  </span>
                ) : null}
              </div>
            </>
          )}
        </section>
      </div>

      {/* ---- At-risk students table ---- */}
      <section className="placeholder-card">
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'baseline',
            marginBottom: '0.5rem',
          }}
        >
          <h2 style={{ margin: 0 }}>At-Risk Students</h2>
          {data.at_risk_students.length > 0 ? (
            <span className="summary-badge danger">{data.at_risk_students.length}</span>
          ) : null}
        </div>
        {data.at_risk_students.length === 0 ? (
          <div style={{ padding: '2rem 0', textAlign: 'center' }}>
            <p
              style={{ color: 'var(--success, #0f9d58)', fontWeight: 600, marginBottom: '0.25rem' }}
            >
              No at-risk students
            </p>
            <p style={{ color: 'var(--text-secondary, #666)', fontSize: '0.85rem' }}>
              All students are progressing within normal parameters.
            </p>
          </div>
        ) : (
          <table className="simple-table">
            <thead>
              <tr>
                <th>Student</th>
                <th>Thesis</th>
                <th>Risk Level</th>
                <th>Reasons</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {data.at_risk_students.map((student) => {
                const isRed = student.risk_level === 'red';
                return (
                  <tr
                    key={student.thesis_id}
                    style={{ background: isRed ? 'rgba(220,38,38,0.04)' : undefined }}
                  >
                    <td style={{ fontWeight: 600 }}>{student.student_name}</td>
                    <td
                      style={{
                        maxWidth: '220px',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {student.thesis_title}
                    </td>
                    <td>
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.35rem',
                          fontWeight: 600,
                          fontSize: '0.82rem',
                          color: isRed ? '#dc2626' : '#f59e0b',
                        }}
                      >
                        <span className={`risk-dot ${riskClass(student.risk_level)}`} />
                        {student.risk_level.toUpperCase()}
                      </span>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
                        {student.risk_reasons.map((reason, i) => (
                          <span
                            key={i}
                            style={{
                              display: 'inline-block',
                              padding: '0.15rem 0.5rem',
                              borderRadius: '999px',
                              fontSize: '0.75rem',
                              fontWeight: 500,
                              background: isRed ? 'rgba(220,38,38,0.08)' : 'rgba(245,158,11,0.1)',
                              color: isRed ? '#dc2626' : '#b45309',
                            }}
                          >
                            {reason}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td>
                      <Link
                        className="btn btn-muted"
                        to={`/professor/student/${student.thesis_id}`}
                      >
                        Review
                      </Link>
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
    const unsubDashboard = subscribeRealtime<{ studentId?: string }>(
      'dashboard.student_update',
      (payload) => {
        if (detail?.student.id && payload.studentId && payload.studentId !== detail.student.id) {
          return;
        }
        void loadDetail();
      },
    );
    const unsubPlagiarism = subscribeRealtime('plagiarism.ready', () => {
      void loadDetail();
    });

    return () => {
      unsubDashboard();
      unsubPlagiarism();
    };
  }, [detail?.student.id, loadDetail]);

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
          <div className="metric-bar-track">
            <div
              className="metric-bar-fill"
              style={{ width: `${detail.metrics.progress_score}%` }}
            />
          </div>
          <p className={detail.metrics.trend_delta >= 0 ? 'trend-up' : 'trend-down'}>
            {detail.metrics.trend_delta >= 0 ? '+' : ''}
            {detail.metrics.trend_delta} vs previous
          </p>
        </article>
        <article className="metric-card">
          <h3>Citation Health</h3>
          <p className="metric-value">{detail.metrics.citation_health_score}%</p>
          <div className="metric-bar-track">
            <div
              className="metric-bar-fill"
              style={{
                width: `${detail.metrics.citation_health_score}%`,
                background:
                  detail.metrics.citation_health_score >= 80
                    ? 'var(--success)'
                    : detail.metrics.citation_health_score >= 50
                      ? '#d97706'
                      : 'var(--risk, #dc2626)',
              }}
            />
          </div>
          <p>
            {detail.reports.citations.issues_count > 0 ? (
              <strong style={{ color: '#d97706' }}>{detail.reports.citations.issues_count}</strong>
            ) : (
              detail.reports.citations.issues_count
            )}{' '}
            issues detected
          </p>
        </article>
        <article className="metric-card">
          <h3>Plagiarism</h3>
          <p className="metric-value">
            <span className={`risk-dot ${riskClass(detail.reports.plagiarism.risk_level)}`} />
            {detail.metrics.plagiarism_similarity}%
          </p>
          <p>
            Risk:{' '}
            <strong
              style={{
                color:
                  detail.reports.plagiarism.risk_level === 'red'
                    ? 'var(--risk, #dc2626)'
                    : detail.reports.plagiarism.risk_level === 'yellow'
                      ? '#d97706'
                      : 'var(--success)',
              }}
            >
              {detail.reports.plagiarism.risk_level.toUpperCase()}
            </strong>
          </p>
        </article>
        <article className="metric-card">
          <h3>Mock Viva Readiness</h3>
          <p className="metric-value">
            {detail.metrics.readiness_score != null ? `${detail.metrics.readiness_score}%` : 'N/A'}
          </p>
          {detail.metrics.readiness_score != null ? (
            <div className="metric-bar-track">
              <div
                className="metric-bar-fill"
                style={{
                  width: `${detail.metrics.readiness_score}%`,
                  background:
                    detail.metrics.readiness_score >= 70
                      ? 'var(--success)'
                      : detail.metrics.readiness_score >= 40
                        ? '#d97706'
                        : 'var(--risk, #dc2626)',
                }}
              />
            </div>
          ) : null}
          <p>Latest coaching readiness</p>
        </article>
      </section>

      {/* ---- AI Review / Suggested Feedback / Abstract Alignment — 3 columns ---- */}
      <div className="review-columns">
        {/* Column 1: AI Review Summary */}
        <section className="placeholder-card review-col-card">
          <div className="review-col-header">
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="16" x2="8" y1="13" y2="13" />
              <line x1="16" x2="8" y1="17" y2="17" />
              <line x1="10" x2="8" y1="9" y2="9" />
            </svg>
            <h2>AI Review Summary</h2>
          </div>
          {detail.ai_review ? (
            <>
              <div className="review-field">
                <span className="review-field-label">Status</span>
                <p>{detail.ai_review.status_note}</p>
              </div>
              {detail.ai_review.stage_context ? (
                <div className="review-field">
                  <span className="review-field-label">Milestone Context</span>
                  <p>{detail.ai_review.stage_context}</p>
                </div>
              ) : null}
              <div className="review-field">
                <span className="review-field-label">Change Summary</span>
                <p>{detail.ai_review.change_summary}</p>
              </div>
            </>
          ) : (
            <p className="review-empty">AI summary is unavailable for this submission.</p>
          )}
        </section>

        {/* Column 2: Suggested Feedback */}
        <section className="placeholder-card review-col-card">
          <div className="review-col-header">
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
            <h2>Suggested Feedback</h2>
            {detail.ai_review?.recommended_feedback.length ? (
              <span className="summary-badge">{detail.ai_review.recommended_feedback.length}</span>
            ) : null}
          </div>
          {detail.ai_review?.recommended_feedback.length ? (
            <ul className="review-feedback-list">
              {detail.ai_review.recommended_feedback.map((item, index) => (
                <li key={`${index}-${item}`} className="review-feedback-item">
                  <p>{item}</p>
                  <button
                    type="button"
                    className="btn btn-ghost review-use-btn"
                    onClick={() =>
                      setFeedback((prev) =>
                        prev.trim().length ? `${prev}\n- ${item}` : `- ${item}`,
                      )
                    }
                  >
                    + Use
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="review-empty">No suggestions available.</p>
          )}
        </section>

        {/* Column 3: Abstract Alignment */}
        <section className="placeholder-card review-col-card">
          <div className="review-col-header">
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="10" />
              <path d="m9 12 2 2 4-4" />
            </svg>
            <h2>Abstract Alignment</h2>
          </div>
          <div className="review-field">
            <span className="review-field-label">Verdict</span>
            <span
              className={`status-pill ${detail.abstract_alignment.verdict === 'aligned' ? 'status-success' : detail.abstract_alignment.verdict === 'misaligned' ? 'status-danger' : 'status-info'}`}
            >
              {detail.abstract_alignment.verdict.replace(/_/g, ' ')}
            </span>
          </div>
          <div className="review-field">
            <span className="review-field-label">Structural Readiness</span>
            <p>{detail.abstract_alignment.structural_readiness}</p>
          </div>
          {detail.abstract_alignment.key_topic_coverage.length > 0 ? (
            <div className="review-field">
              <span className="review-field-label">Covered Topics</span>
              <div className="review-tag-list">
                {detail.abstract_alignment.key_topic_coverage.map((topic) => (
                  <span key={topic} className="review-tag review-tag-green">
                    {topic}
                  </span>
                ))}
              </div>
            </div>
          ) : null}
          <div className="review-field">
            <span className="review-field-label">Missing Sections</span>
            {detail.abstract_alignment.missing_core_sections.length > 0 ? (
              <div className="review-tag-list">
                {detail.abstract_alignment.missing_core_sections.map((section) => (
                  <span key={section} className="review-tag review-tag-red">
                    {section}
                  </span>
                ))}
              </div>
            ) : (
              <p style={{ color: 'var(--success)', fontWeight: 600, fontSize: '0.88rem' }}>
                None detected
              </p>
            )}
          </div>
        </section>
      </div>

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
                        {row.type === 'removal' ? (
                          renderWordDiff(row.left_text || ' ', row.right_text || ' ', 'left')
                        ) : (
                          <pre className="pr-line-text">{row.left_text || ' '}</pre>
                        )}
                        <span className="pr-line-no" aria-hidden="true">
                          {row.right_line ?? ''}
                        </span>
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
            <>
              <LineChart
                data={detail.history.progress.map((p) => ({
                  x: p.version_number,
                  y: p.progress_score,
                  label: `V${p.version_number}: ${p.progress_score}%`,
                }))}
              />
              <div
                style={{ display: 'flex', gap: '0.75rem', marginTop: '0.5rem', flexWrap: 'wrap' }}
              >
                <span
                  className="metric-card"
                  style={{ padding: '0.4rem 0.75rem', fontSize: '0.8rem' }}
                >
                  Min: {Math.min(...detail.history.progress.map((p) => p.progress_score))}%
                </span>
                <span
                  className="metric-card"
                  style={{ padding: '0.4rem 0.75rem', fontSize: '0.8rem' }}
                >
                  Max: {Math.max(...detail.history.progress.map((p) => p.progress_score))}%
                </span>
                <span
                  className="metric-card"
                  style={{ padding: '0.4rem 0.75rem', fontSize: '0.8rem' }}
                >
                  Latest:{' '}
                  {detail.history.progress[detail.history.progress.length - 1].progress_score}%
                </span>
              </div>
            </>
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
          <VisualTimeline entries={detail.history.timeline} />
        )}
      </section>
    </div>
  );
}

export function ProfessorCohortsPage(): JSX.Element {
  const [cohorts, setCohorts] = useState<CohortRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createInput, setCreateInput] = useState({ name: '', citation_style: 'APA' });
  const [creating, setCreating] = useState(false);
  const [activeCohortId, setActiveCohortId] = useState<string | null>(null);
  const [enrollments, setEnrollments] = useState<Record<string, EnrollmentRecord[]>>({});
  const [enrollmentsLoading, setEnrollmentsLoading] = useState<Record<string, boolean>>({});
  const [supervisedStudents, setSupervisedStudents] = useState<ProfessorStudentRow[]>([]);
  const [enrollInput, setEnrollInput] = useState<Record<string, string>>({});
  const [enrolling, setEnrolling] = useState<Record<string, boolean>>({});

  const loadData = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const [cohortsRes, studentsRes] = await Promise.all([
        apiRequest<CohortsResponse>('/cohorts'),
        apiRequest<{ students: ProfessorStudentRow[] }>('/dashboard/professor/students'),
      ]);
      setCohorts(cohortsRes.cohorts);
      setSupervisedStudents(studentsRes.students);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load cohorts.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const loadEnrollments = async (cohortId: string): Promise<void> => {
    if (enrollments[cohortId]) return;
    setEnrollmentsLoading((prev) => ({ ...prev, [cohortId]: true }));
    try {
      const res = await apiRequest<EnrollmentsResponse>(`/cohorts/${cohortId}/enrollments`);
      setEnrollments((prev) => ({ ...prev, [cohortId]: res.enrollments }));
    } catch {
      setEnrollments((prev) => ({ ...prev, [cohortId]: [] }));
    } finally {
      setEnrollmentsLoading((prev) => ({ ...prev, [cohortId]: false }));
    }
  };

  const handleToggleCohort = async (cohortId: string): Promise<void> => {
    if (activeCohortId === cohortId) {
      setActiveCohortId(null);
      return;
    }
    setActiveCohortId(cohortId);
    await loadEnrollments(cohortId);
  };

  const handleCreateCohort = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (!createInput.name.trim()) return;
    setCreating(true);
    try {
      await apiRequest('/cohorts', { method: 'POST', body: createInput });
      setCreateInput({ name: '', citation_style: 'APA' });
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create cohort.');
    } finally {
      setCreating(false);
    }
  };

  const handleEnroll = async (cohortId: string): Promise<void> => {
    const studentId = enrollInput[cohortId];
    if (!studentId) return;
    setEnrolling((prev) => ({ ...prev, [cohortId]: true }));
    try {
      await apiRequest(`/cohorts/${cohortId}/enrollments`, {
        method: 'POST',
        body: { student_id: studentId },
      });
      setEnrollments((prev) => ({
        ...prev,
        [cohortId]: undefined as unknown as EnrollmentRecord[],
      }));
      setEnrollInput((prev) => ({ ...prev, [cohortId]: '' }));
      await loadEnrollments(cohortId);
      setCohorts((prev) =>
        prev.map((c) => (c.id === cohortId ? { ...c, student_count: c.student_count + 1 } : c)),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to enroll student.');
    } finally {
      setEnrolling((prev) => ({ ...prev, [cohortId]: false }));
    }
  };

  if (loading) return <LoadingCard message="Loading cohorts..." />;
  if (error) return <ErrorCard message={error} />;

  return (
    <div className="professor-page-grid">
      {/* ---- Page header ---- */}
      <header style={{ marginBottom: '0.25rem' }}>
        <h1 style={{ fontSize: '1.4rem', margin: 0 }}>Cohorts</h1>
        <p style={{ color: 'var(--text-secondary)', marginTop: '0.25rem', fontSize: '0.9rem' }}>
          Group students into cohorts with shared citation styles and deadlines
        </p>
      </header>

      {/* ---- Create cohort ---- */}
      <section className="placeholder-card cohort-create-card">
        <div className="cohort-create-header">
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <line x1="19" x2="19" y1="8" y2="14" />
            <line x1="22" x2="16" y1="11" y2="11" />
          </svg>
          <h2 style={{ margin: 0, fontSize: '1rem' }}>Create New Cohort</h2>
        </div>
        <form
          onSubmit={(e) => {
            void handleCreateCohort(e);
          }}
          className="cohort-create-form"
        >
          <div className="cohort-field">
            <label htmlFor="cohort-name">Cohort Name</label>
            <input
              id="cohort-name"
              className="form-input"
              type="text"
              value={createInput.name}
              onChange={(e) => setCreateInput((prev) => ({ ...prev, name: e.target.value }))}
              placeholder="e.g. MSc 2026 Cohort"
              required
            />
          </div>
          <div className="cohort-field">
            <label htmlFor="cohort-style">Citation Style</label>
            <select
              id="cohort-style"
              className="form-input cohort-select"
              value={createInput.citation_style}
              onChange={(e) =>
                setCreateInput((prev) => ({ ...prev, citation_style: e.target.value }))
              }
            >
              {['APA', 'MLA', 'Chicago', 'Harvard', 'IEEE'].map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={creating}
            style={{ alignSelf: 'flex-end' }}
          >
            {creating ? 'Creating...' : 'Create Cohort'}
          </button>
        </form>
      </section>

      {/* ---- Cohort list ---- */}
      {cohorts.length === 0 ? (
        <section
          className="placeholder-card"
          style={{ textAlign: 'center', padding: '2.5rem 1rem' }}
        >
          <svg
            width="40"
            height="40"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--text-secondary)"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ opacity: 0.4, marginBottom: '0.75rem' }}
          >
            <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <line x1="19" x2="19" y1="8" y2="14" />
            <line x1="22" x2="16" y1="11" y2="11" />
          </svg>
          <p style={{ margin: 0, fontWeight: 600 }}>No cohorts yet</p>
          <p style={{ margin: '0.3rem 0 0', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
            Create your first cohort above to start grouping students.
          </p>
        </section>
      ) : (
        <div className="cohort-grid">
          {cohorts.map((cohort) => {
            const isExpanded = activeCohortId === cohort.id;
            const cohortEnrollments = enrollments[cohort.id] ?? [];
            const enrolledIds = new Set(cohortEnrollments.map((e) => e.student_id));
            const availableStudents = supervisedStudents.filter(
              (s) => !enrolledIds.has(s.student_id),
            );

            return (
              <article
                key={cohort.id}
                className={`cohort-card ${isExpanded ? 'cohort-card-expanded' : ''}`}
              >
                {/* Card header */}
                <div className="cohort-card-top">
                  <div className="cohort-card-icon">
                    <svg
                      width="20"
                      height="20"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                      <circle cx="9" cy="7" r="4" />
                      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                    </svg>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <h3 className="cohort-card-name">{cohort.name}</h3>
                    <div className="cohort-card-meta">
                      <span className="cohort-badge">{cohort.citation_style}</span>
                      <span>
                        {cohort.student_count} student{cohort.student_count !== 1 ? 's' : ''}
                      </span>
                      <span>Created {formatDateOnly(cohort.created_at)}</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    className={`btn ${isExpanded ? 'btn-primary' : 'btn-ghost'} cohort-toggle-btn`}
                    onClick={() => {
                      void handleToggleCohort(cohort.id);
                    }}
                  >
                    {isExpanded ? 'Close' : 'Manage'}
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      style={{
                        transition: 'transform 0.2s',
                        transform: isExpanded ? 'rotate(180deg)' : 'rotate(0)',
                      }}
                    >
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  </button>
                </div>

                {/* Student count bar */}
                {cohort.student_count > 0 && !isExpanded ? (
                  <div className="cohort-count-bar">
                    <div className="metric-bar-track" style={{ height: '4px' }}>
                      <div
                        className="metric-bar-fill"
                        style={{
                          width: `${Math.min(100, (cohort.student_count / Math.max(...cohorts.map((c) => c.student_count), 1)) * 100)}%`,
                        }}
                      />
                    </div>
                  </div>
                ) : null}

                {/* Expanded panel */}
                {isExpanded ? (
                  <div className="cohort-expand-panel">
                    {enrollmentsLoading[cohort.id] ? (
                      <div style={{ textAlign: 'center', padding: '1.5rem 0' }}>
                        <span className="loading-spinner" />
                        <p
                          style={{
                            margin: '0.5rem 0 0',
                            fontSize: '0.85rem',
                            color: 'var(--text-secondary)',
                          }}
                        >
                          Loading enrollments...
                        </p>
                      </div>
                    ) : (
                      <>
                        {/* Enrolled students */}
                        <div className="cohort-section">
                          <div className="cohort-section-header">
                            <h4>Enrolled Students</h4>
                            <span className="summary-badge">{cohortEnrollments.length}</span>
                          </div>
                          {cohortEnrollments.length === 0 ? (
                            <p className="cohort-empty-text">
                              No students enrolled yet. Add students below.
                            </p>
                          ) : (
                            <div className="cohort-student-list">
                              {cohortEnrollments.map((e) => (
                                <div key={e.id} className="cohort-student-chip">
                                  <span className="cohort-student-avatar">
                                    {e.student_name.charAt(0).toUpperCase()}
                                  </span>
                                  <div>
                                    <span className="cohort-student-name">{e.student_name}</span>
                                    <span className="cohort-student-email">{e.student_email}</span>
                                  </div>
                                  <span className="cohort-student-date">
                                    {formatDateOnly(e.enrolled_at)}
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>

                        {/* Enroll new student */}
                        <div className="cohort-section cohort-enroll-section">
                          <div className="cohort-section-header">
                            <h4>Add Student</h4>
                          </div>
                          {availableStudents.length === 0 ? (
                            <p className="cohort-empty-text">
                              All supervised students are already enrolled in this cohort.
                            </p>
                          ) : (
                            <div className="cohort-enroll-row">
                              <select
                                className="form-input cohort-select"
                                value={enrollInput[cohort.id] ?? ''}
                                onChange={(e) =>
                                  setEnrollInput((prev) => ({
                                    ...prev,
                                    [cohort.id]: e.target.value,
                                  }))
                                }
                              >
                                <option value="">Select a student...</option>
                                {availableStudents.map((s) => (
                                  <option key={s.student_id} value={s.student_id}>
                                    {s.student_name}
                                  </option>
                                ))}
                              </select>
                              <button
                                type="button"
                                className="btn btn-primary"
                                disabled={!enrollInput[cohort.id] || enrolling[cohort.id]}
                                onClick={() => {
                                  void handleEnroll(cohort.id);
                                }}
                              >
                                {enrolling[cohort.id] ? 'Enrolling...' : 'Enroll'}
                              </button>
                            </div>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
