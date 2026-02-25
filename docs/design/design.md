# 🎯 SuperviseAI — UI Mapping & Product Design Specification

Version: Hackathon Build Spec
Goal: Polished, production-feeling AI academic platform

---

# 1️⃣ Landing Page — Design Mapping

## Reference Layout

Use the **first screenshot (Weekend UX style hero + sections)** as structural reference:

- Large hero section
- Two-column layout (text left, visual right)
- Stats badges floating
- Services card grid
- Product preview section
- Testimonial section
- Footer

We will keep the **layout structure**, but completely rewrite the content and tone.

---

## 🔹 HERO SECTION

### Layout Reference:

Large bold headline on left
Subtext
Primary + secondary CTA
Visual (mock dashboard preview) on right
Floating stat badges

### Replace With:

### Headline:

AI-Powered Thesis Supervision & Viva Simulation

### Subtext:

Track research progress, validate citations, detect plagiarism, and simulate your defense — all in one intelligent academic platform.

### Primary CTA:

Start Thesis Analysis

### Secondary CTA:

Explore Mock Viva

### Replace Floating Stats With:

- Real-Time Progress Tracking
- AI-Driven Gap Reports
- Citation & Plagiarism Monitoring
- Multi-Version Thesis Comparison

### Visual:

Instead of a smiling student image →
Use a clean screenshot mock of:

Student Dashboard (progress score + citation health + plagiarism badge)

This makes it feel like a real SaaS product.

---

## 🔹 “OUR SERVICES” SECTION

Reference Layout: 3–4 feature cards.

Replace with:

### Section Title:

Core Platform Modules

Cards:

1. ThesisTrack™
   AI-driven thesis structure and progress analysis across versions.

2. Citation Validator
   Multi-layer reference validation with formatting and database checks.

3. Mock Viva Coach
   Simulated academic questioning with structured feedback.

4. Plagiarism Monitor
   Asynchronous originality scoring with webhook updates.

Design:

- White cards
- Soft shadow
- Green accent line on hover
- Minimal icons (outline style)

---

## 🔹 PRODUCT PREVIEW SECTION

Reference: “Most Popular Classes” grid.

Replace with:

### Section Title:

See SuperviseAI in Action

Show:

- Student Dashboard preview
- Professor Dashboard preview
- Mock Viva modal preview

Each in clean card containers.

---

## 🔹 HOW IT WORKS SECTION

Replace course listing with:

1. Upload Your Draft
2. AI Analyzes Structure & Citations
3. Track Progress Across Versions
4. Simulate Your Viva
5. Submit with Confidence

Use horizontal stepper layout.

---

## 🔹 TESTIMONIAL SECTION

Keep layout.

Rewrite content tone:

“As a supervisor, I can now monitor thesis development across my cohort in real time.”

or

“The mock viva simulation helped me identify weaknesses before my defense.”

No playful tone. Academic voice only.

---

# 2️⃣ Global Color Scheme

This must be consistent across entire project.

## 🎨 Primary Palette

Primary Green:
#0E7C66 (deep academic emerald)

Dark Accent:
#0B3D3A (deep teal)

Background Light:
#F7F9F8 (soft academic off-white)

Card Background:
#FFFFFF

Primary Text:
#1F2937 (dark slate)

Secondary Text:
#6B7280 (muted gray)

---

## 🔹 Status Colors

Success (Aligned):
#1F9D72

Warning (Needs attention):
#F59E0B

Risk / Critical:
#DC2626

Info / AI processing:
#2563EB

---

## 🔹 Design Rules

- Green used for:
  - Primary buttons
  - Progress indicators
  - Active nav state

- Avoid neon green
- No heavy gradients
- Soft shadow only
- Border radius: 10–14px consistent
- Use spacing scale (8px base grid)

---

# 3️⃣ Page List + Design Direction + Build Phases

All pages must follow:

- Left sidebar layout
- Top header bar
- Main content grid
- Card-based content
- Clean typography
- No gamification elements

---

### NOTE: all screenshots provided are purely for layout and spacing reference. The actual content, tone, and visual style will be completely redesigned to fit the SuperviseAI brand and product vision. The goal is to use the structure of these references while creating a polished, professional academic platform that feels real from day one.and can be founc in /docs/design/images.

## PHASE 1 — Core Auth + App Shell (Hackathon-Ready “Polished Product”)

### Goal

Ship a clean, modern, consistent experience with **Landing + Auth** that feels production-grade from day one:

- Fast, responsive, accessible UI
- Solid auth flow + guarded routes
- Clear roles (student / professor / admin-ready later)
- Consistent green brand system

---

# 1) UI Design Reference Mapping (Screenshots → Our Product)

## A) Auth Pages Reference (Cyberverdict split-screen)

**Use the “split-screen login” layout as the baseline**:

- **Left panel (40–45% width desktop)**
  - Soft gradient / blurred abstract background
  - Minimal motivational copy (thesis/product aligned)
  - Small logo mark watermark

- **Right panel (55–60% width desktop)**
  - White card (or light surface) with form fields
  - Big headline + short helper text
  - Clear primary CTA button
  - Secondary links below (forgot password, create account, back to login)

- **Mobile**: collapse to single column
  - Background becomes a top banner (shorter height)
  - Form becomes full width

### Pages using this pattern

- `/login`
- `/register`
- `/reset-password` (request reset)
- `/change-password` (token-based new password screen)

---

## B) Landing Page Reference (Modern course-style hero)

Even though your screenshots are “edtech”, the structure works perfectly for **SuperviseAI**:

- Top nav with: **Product / How it Works / Features / Pricing (optional) / Sign in / Create account**
- Hero with:
  - Strong headline + supporting copy
  - Primary CTA + secondary CTA
  - Right-side illustration/shape (we can use abstract blob + student/prof silhouette later)

- Social proof row (logos / “Trusted by…”)
- Feature cards (3)
- “How it works” section (3 steps)
- Testimonials (1–2)
- Footer

**We keep the same modern spacing, rounded cards, soft shadows, and green accents.**

---

# 2) Global Color Scheme (Use Across Entire Project)

## Brand Colors (Green-first)

- **Primary (Green):** `#10B981`
- **Primary Dark:** `#059669`
- **Primary Soft Background:** `#ECFDF5`
- **Accent Mint:** `#34D399`

## Neutrals

- **Text (Primary):** `#0F172A`
- **Text (Secondary):** `#475569`
- **Border:** `#E2E8F0`
- **Background:** `#F8FAFC`
- **Surface/Card:** `#FFFFFF`

## States

- **Success:** `#16A34A`
- **Warning:** `#F59E0B`
- **Error:** `#EF4444`
- **Info:** `#3B82F6`

## Gradients (Auth Left Panel)

- Subtle academic gradient example:
  - `linear-gradient(135deg, #ECFDF5 0%, #D1FAE5 35%, #A7F3D0 100%)`

- Optional “depth” overlay:
  - blurred circles using `rgba(16,185,129,0.12)` and `rgba(59,130,246,0.08)`

---

# 3) PHASE 1 Pages + Detailed UI Requirements

## 3.1 Landing Page (`/`)

**Purpose:** sell the product + drive account creation.

### Layout

- **Header/Nav**
  - Left: SuperviseAI logo
  - Middle: links (How it works, Features, Security, FAQ)
  - Right: `Sign in` (ghost button) + `Create account` (primary green)

### Hero Section

- Headline options (choose one):
  - **“Stay on track. Finish your thesis with confidence.”**
  - **“Your AI co-supervisor for thesis progress, quality, and readiness.”**

- Subtext:
  - “Upload drafts, get actionable feedback, citation checks, originality insights, and viva coaching — all in one place.”

- CTA:
  - Primary: **Create free account**
  - Secondary: **See how it works**

- Right visual:
  - Abstract blob + floating metric cards (like screenshot stats chips):
    - “Progress score”
    - “Citation issues”
    - “Next steps”
    - “Viva readiness”

### Feature Cards (3 cards)

- **Thesis Progress Tracker**
  - “See what improved since last draft and what still needs work.”

- **Citations & Reference Validator**
  - “Detect missing citations, formatting errors, and unverifiable references.”

- **Viva / Defense Coach**
  - “Practice with examiner-style questions and get readiness feedback.”

### How It Works (3 steps)

1. Create account
2. Upload abstract / draft
3. Get insights + coach sessions

### Footer

- Links + “Built for hackathon demo” vibe is fine, but keep it professional.

---

## 3.2 Login Page (`/login`)

**Use split-screen reference.**

### Right panel form fields

- Email
- Password (with show/hide toggle)
- Remember me (optional)
- CTA: **Login**
- Links:
  - Forgot password → `/reset-password`
  - Create account → `/register`

### UX Requirements

- Inline validation (email format, required fields)
- Loading state on submit
- Error handling:
  - “Invalid email or password”

- After login redirect:
  - Student → `/student`
  - Professor → `/professor`
  - Admin (future) → `/admin`

---

## 3.3 Register Page (`/register`)

**Same split-screen layout for consistency.**

### Right panel form fields

- Full name
- Email
- Password
- Role selector:
  - Student
  - Professor

- CTA: **Create account**
- Link: “Already have an account?” → `/login`

### Validation Rules

- Password min 8 chars (recommend: include one number)
- Email unique (backend validation)
- Role required

---

## 3.4 Reset Password Page (`/reset-password`)

**This is “request reset link”, like your screenshot.**

### Right panel

- Email field
- CTA: **Send reset link**
- Link: Back to login

### Response UX

- Always show generic success message:
  - “If an account exists for this email, you’ll receive a reset link.”

---

## 3.5 Change Password Page (`/change-password?token=...`)

(Your screenshot shows “Change Password” screen)

### Right panel

- New password
- Confirm password
- CTA: **Change password**
- Link: Back to login

### Token handling

- Token comes from email link
- If token invalid/expired → show error state + “Request another reset”

---

# 4) App Shell (Minimal but Real)

Even in Phase 1, we want it to feel like a real product.

## After Auth: Route Groups

- `/student/*` → student layout shell (sidebar/topbar)
- `/professor/*` → professor layout shell
- `/admin/*` → placeholder shell (UI exists, features gated)

## Shell UI (simple)

- Topbar: logo + user menu (profile/logout)
- Left nav (desktop):
  - Student: Home, Upload, History, Coach
  - Professor: Dashboard, Students, Milestones, Analytics
  - Admin: Users, Cohorts, Settings (disabled/coming soon)

**Phase 1:** these pages can be placeholders except the auth + landing, but the shell must exist so it feels complete.

---

# 5) Backend (Phase 1 Scope)

## 5.1 Auth Endpoints

### `POST /auth/register`

Body:

- `email`
- `password`
- `full_name`
- `role` = `student | professor` (admin reserved)

Behavior:

- Validate DTO
- Hash password (`bcrypt`)
- Insert into `users`
- Issue JWT access token
- Return:
  - `{ access_token, user }` (no password_hash)

### `POST /auth/login`

Body:

- `email`
- `password`

Behavior:

- Find user by email
- `bcrypt.compare`
- Issue JWT
- Return:
  - `{ access_token, user }`

### `POST /auth/request-password-reset`

Body:

- `email`
  Behavior:
- Create reset token (random + expiry)
- Store hashed token + expiry in DB
- Send email with link: `/change-password?token=...`
- Return generic success

### `POST /auth/reset-password`

Body:

- `token`
- `new_password`
  Behavior:
- Verify token hash + expiry
- Update password_hash
- Invalidate token

## 5.2 JWT + Guards

- `JwtStrategy`
- `JwtAuthGuard`
- `RolesGuard`
- `@Roles()` decorator

JWT payload:

```json
{
  "sub": "userId",
  "email": "user@email.com",
  "role": "student" | "professor"
}
```

## 5.3 Database (Phase 1 tables)

### `users`

- `id uuid pk`
- `email unique not null`
- `password_hash not null`
- `full_name not null`
- `role text not null` (`student|professor` — admin later)
- `created_at timestamptz default now()`

### `password_resets`

- `id uuid pk`
- `user_id uuid fk -> users.id`
- `token_hash text not null`
- `expires_at timestamptz not null`
- `used_at timestamptz null`
- `created_at timestamptz default now()`

---

# 6) Agent Implementation Notes (Frontend + Backend Must Match)

## Frontend requirements

- React + Vite
- Tailwind (recommended) with a shared theme file:
  - colors + spacing + button variants

- Create shared components:
  - `AuthLayoutSplit`
  - `TextField`
  - `PasswordField`
  - `Button`
  - `FormError`

- API client:
  - Axios instance
  - Attach `Authorization: Bearer <token>` automatically if token exists

- Auth storage:
  - Store JWT in `localStorage` for hackathon speed (later can move to httpOnly cookies)

- Route guards:
  - If no token → redirect to `/login`
  - If role mismatch → redirect to correct dashboard

## Backend requirements

- NestJS modules:
  - `AuthModule`
  - `UsersModule`
  - `MailModule` (can be mocked in hackathon if needed)

- Password hashing: bcrypt
- JWT secret from env
- Docker compose ready (postgres + nestjs; minio can be added Phase 2)

---

# 7) Phase 1 Deliverables Checklist (What “Done” Means)

- [ ] Landing page looks polished + responsive
- [ ] Login/Register/Reset/Change password screens match split-screen reference
- [ ] JWT auth works end-to-end
- [ ] Role-based redirect works
- [ ] App shells exist for student/professor/admin (admin can be locked)
- [ ] Basic nav + logout works
- [ ] Clean error states + loading states implemented

---

---

# PHASE 2 — Student Core Experience

Pages:

5. Student Dashboard

Layout:
Sidebar:

- Dashboard
- Submissions
- Mock Viva
- History
- Settings

Main:

- Thesis Progress Score (large)
- Citation Health
- Plagiarism Score (badge)
- Latest Feedback
- Upcoming Milestone
- Start Mock Viva button

Backend:

- submissions
- thesis_analysis
- citation_reports
- plagiarism_reports

---

6. Submit Thesis Page

- Drag & drop upload
- Version detection
- Processing state screen

Backend:

- MinIO storage
- Text extraction
- Analysis pipeline

---

7. Submission Results Page

- Structured report
- Gap analysis
- Version comparison
- Citation report
- Plagiarism report
- AI feedback section

---

8. Mock Viva Page

- Chat layout
- Voice interaction (optional)
- Examiner style UI
- Session summary at end

Backend:

- coaching_sessions
- intent guard
- GPT call

---

# PHASE 3 — Professor Experience (High Impact)

9. Professor Dashboard

This is critical for hackathon scoring.

Layout:

- Cohort overview
- Student list with risk indicators
- Progress trend chart
- At-risk alerts
- Recent submissions

Backend:

- cohorts
- enrollments
- aggregated analytics

---

10. Student Detail (Professor View)

- Progress over time
- Gap highlights
- Plagiarism history
- Version timeline
- Coach readiness score

---

# PHASE 4 — Polish & Real-Time

11. Notifications (optional)
12. Real-time submission updates (WebSocket)
13. Settings Page

---

# Design Consistency Rule

All pages must:

- Use consistent sidebar
- Use green accent
- Use same shadow and radius
- Use data-first UI
- Avoid decorative noise
- Avoid template-looking sections

---

# Build Synchronization Plan (Frontend + Backend)

Phase 1:
Auth + layout shell

Phase 2:
Submission + Analysis pipeline + student dashboard

Phase 3:
Professor analytics + cohort logic

Phase 4:
Real-time updates + refinement
