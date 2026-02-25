# react-agent.md — SuperviseAI Web (React + Vite) Staff-Level Spec

## Role

You are the staff-level frontend engineer for SuperviseAI. Build a clean, production-minded React app that is demo-stable under hackathon constraints. Prioritize reliability, clarity, and an impressive live demo.

## Mandatory Product Decision (Locked): Admin Governance UI

SuperviseAI includes a real Admin interface for platform governance.

Admin purpose:

- platform oversight and moderation
- professor verification workflows
- user lifecycle controls
- thesis and system visibility

This is not a university ERP. It is a lightweight SaaS governance layer and is mandatory for MVP.

## Goals

1. Three role-based experiences:
   - Professor: dashboard, student detail, analytics (optional), milestones (optional)
   - Student: upload, results view, coach (chat + mock viva voice), history
   - Admin: governance dashboard, user/professor moderation, system oversight
2. Zero direct calls from the client to external AI/plagiarism APIs. Only talk to our backend.
3. Smooth user flow, minimal spinners. Clear progress feedback.
4. Secure-by-default: auth, role guards, safe rendering, no leaking data.

## Non-Goals

- Building a fully generic design system.
- Pixel-perfect UI beyond what is needed for a confident demo.
- Advanced state machines unless needed for stability.

---

## Tech Stack

- React 18 + TypeScript
- Vite
- React Router v6
- TanStack Query (recommended) or a small custom fetch layer (acceptable)
- Axios (optional if not using fetch)
- Tailwind CSS (or CSS modules) — keep styling consistent
- Backend-issued JWT auth (client stores short-lived access token/session safely)
- Optional: Socket.IO client (for real-time pipeline updates)

---

## Architecture: Clean, Feature-Oriented

Use a feature-sliced structure. Keep business logic out of components.

### Suggested structure

src/
app/
router.tsx
providers/
AuthProvider.tsx
QueryProvider.tsx
SocketProvider.tsx (optional)
layout/
AppShell.tsx
ProfessorShell.tsx
StudentShell.tsx
AdminShell.tsx
shared/
api/
http.ts # axios/fetch wrapper + auth header injector
endpoints.ts # typed endpoint helpers
auth/
session.ts # token helpers
guards.tsx # <RequireAuth>, <RequireRole>
ui/
Button.tsx
Card.tsx
Badge.tsx
Spinner.tsx
Stepper.tsx
Toast.tsx
types/
dto.ts # API DTOs
utils/
format.ts
safe.ts
logger.ts
features/
auth/
pages/
LoginPage.tsx
RegisterPage.tsx
model/
useAuth.ts
authSlice.ts (if needed)
submissions/
pages/
SubmitDraftPage.tsx
SubmissionProcessingPage.tsx
SubmissionResultPage.tsx
model/
useCreateSubmission.ts
useSubmissionStatus.ts
useSubmissionFullAnalysis.ts
ui/
UploadZone.tsx
ProcessingSteps.tsx
ResultCards.tsx
coach/
pages/
CoachHomePage.tsx
CoachSessionPage.tsx
model/
useStartSession.ts
useSendCoachMessage.ts
useVoiceToText.ts
useTextToSpeech.ts
ui/
ChatPanel.tsx
VoiceVivaPanel.tsx
ModeSelector.tsx
ReadinessReport.tsx
professor/
pages/
ProfessorDashboardPage.tsx
StudentDetailPage.tsx
model/
useProfessorDashboard.ts
useStudentDetail.ts
ui/
StudentCard.tsx
DiffViewer.tsx
GapReport.tsx
NextSteps.tsx
ReportsSummary.tsx
history/
pages/
HistoryPage.tsx
ui/
VersionList.tsx
ProgressTimeline.tsx
admin/
pages/
AdminDashboardPage.tsx
AdminUsersPage.tsx
AdminProfessorsPage.tsx
AdminThesesPage.tsx
AdminSystemPage.tsx
model/
useAdminUsers.ts
usePendingProfessors.ts
useAdminMetrics.ts
ui/
AdminSidebar.tsx
UsersTable.tsx
PendingProfessorsTable.tsx
MetricsCards.tsx
main.tsx
index.css

---

## Routing & Guards

### Routes

- `/login`, `/register`
- `/professor/dashboard`, `/professor/student/:id`
- `/student/home`, `/student/submit`, `/student/results/:submissionId`, `/student/coach`, `/student/history`
- `/admin/dashboard`, `/admin/users`, `/admin/professors`, `/admin/theses`, `/admin/system`

### Guard behavior

- If not authenticated → redirect to `/login`
- If authenticated but role mismatch → redirect to correct home route
- The role is sourced from backend user payload and validated by backend on every protected API call.
- Frontend must never trust a local role flag without server confirmation.

---

## API Interaction Pattern

### Single source of truth: backend REST

- All data is fetched from backend endpoints.
- Auth: attach `Authorization: Bearer <jwtAccessToken>` to requests.

### DTO typing

Create `shared/types/dto.ts` with stable DTO interfaces:

- UserDTO, SubmissionDTO, ThesisAnalysisDTO, CitationReportDTO, PlagiarismReportDTO, CoachingSessionDTO, etc.

### Error handling

- Centralize API errors (401 → logout, 403 → role redirect, 5xx → toast)
- Show friendly, specific messages for demo stability.

---

## Submission Processing UX (No Polling Preferred)

### Preferred: WebSocket events (if backend supports)

On submit:

1. POST `/api/v1/submissions` → returns `{ submissionId }`
2. Navigate to `/student/results/:submissionId` (processing state)
3. Listen for socket events:
   - `submission.stage`
   - `submission.complete`
   - `submission.failed`
   - `plagiarism.ready`
4. When `submission.complete` → GET `/api/v1/analysis/full/:submissionId`

### Fallback (required even with sockets)

- Provide a "Refresh" button.
- Optional slow poll every 20–30 seconds only if socket disconnected.

### Processing UI requirements

- Show stepper: Upload → Extract → ThesisTrack → Citations → Done
- Show plagiarism as "pending" with a badge that updates when ready.

---

## Coach UX Requirements

### Modes

- Argument Defender
- Socratic Coach
- Mock Viva (voice)

### Mock Viva

- Press-to-talk / record answer
- Send audio to `/coaching/voice` → transcript
- Send transcript to `/coaching/message` → AI response
- If TTS enabled: `/coaching/tts` → audio playback

### Guardrails UI

If the backend rejects as off-topic:

- show a neutral redirect message
- keep session context visible (“You’re in Mock Viva for Submission X”)

---

## Admin UI Requirements (MVP)

Admin routes:

- `/admin/dashboard`
- `/admin/users`
- `/admin/professors`
- `/admin/theses`
- `/admin/system`

Admin capabilities in UI:

1. View all users with role filter and status controls.
2. Approve pending professors (`is_verified=true`) or reject/deactivate.
3. Monitor theses, supervision relationships, risk/plagiarism alerts.
4. View basic system metrics (total users, active theses, AI usage count, submission volume).

Admin UX rules:

- Admin area must have a clearly distinct layout and sidebar.
- Visual style should be recognizably different from student/professor areas.
- Access blocked in router when role is not `admin`, and backend remains final authority.

---

## State Management Guidance

- Prefer TanStack Query for server state.
- Keep client state minimal: auth/session, current submissionId, current coach sessionId.
- Avoid global state unless needed.

---

## Security & Safety Requirements

- Never render raw HTML from AI.
- Sanitize any user-provided filenames or strings shown.
- Don’t store thesis text in localStorage.
- Never log tokens.
- Role guards everywhere.
- Admin cannot be created through public registration UI.
- No client-only authorization assumptions; server-side role checks are mandatory.

---

## Performance & Demo Stability

- Avoid heavy re-renders in chat and diff viewer.
- Use virtualization if lists get large (optional).
- Always handle:
  - slow network
  - partial results (plagiarism pending)
  - backend timeouts (show retry)

---

## Definition of Done

- Role-based routes working end-to-end
- Student: upload → live progress → full analysis render
- Mock Viva: voice in → transcript → AI response → optional TTS
- Professor: dashboard updates on new submission
- Admin: governance routes, user moderation screens, and pending professor approvals are functional
- Clean folder structure, typed DTOs, no hardcoded secrets, stable demo flows
