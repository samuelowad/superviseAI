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

# PHASE 1 — Core Auth + Shell

Pages:

1. Landing Page
2. Login Page
3. Register Page
4. Reset Password Page

Design:
Use clean split-screen layout (like Cyberverdict login)
Left side: subtle academic gradient
Right side: form

Backend:

- JWT auth
- bcrypt
- Postgres user table

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
