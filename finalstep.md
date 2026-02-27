# Final Step Plan to Win the Hackathon

## 1) Objective

Ship a judge-winning **AI Exam and Debate Coach** by focusing on the 3 features that map most directly to the challenge brief and scoring criteria:

1. Real-time Azure confidence and sentiment adaptation loop.
2. Inclusive learner profile adaptation.
3. Real-time performance analytics during the session.

This plan is intentionally scoped for hackathon impact, not full long-term product completeness.

---

## 2) Why These Features Matter Most

### Judge Criteria Alignment

- **Innovativeness**
  - Adaptive questioning based on live confidence and sentiment feels like a real examiner, not a static chatbot.
- **Impact and Value**
  - Students get actionable coaching in real time, not just post-session summaries.
- **Sustainability and Feasibility**
  - Built on existing architecture and Azure services you already use.
- **Prototype Quality**
  - Visible live analytics and profile-aware behavior demonstrate robust UX and clear learning outcomes.
- **Presentation Quality**
  - These features create strong demo moments judges can understand in seconds.
- **Bonus Points**
  - Strong and explicit use of Azure Speech + Cognitive + OpenAI.
  - Real-time AI feedback loop.
  - Inclusive learner support.

---

## 3) Current State vs Required State

### Current State (already good)

- Coaching modes exist: `mock_viva`, `argument_defender`, `socratic`.
- STT/TTS pathways exist with Azure and browser fallback.
- Session transcript and end-session readiness scoring exist.

### Gaps to Close

- No full confidence/sentiment-driven adaptation loop per turn.
- No explicit learner profile model with different coaching behavior.
- No real-time in-session scoring dashboard (only end summary).

---

## 4) Feature 1: Real-Time Azure Confidence and Sentiment Adaptation

## Why this feature

This is the core "AI coach that understands learners" requirement. It is your strongest technical differentiation and directly uses Azure services in a visible way.

## What to implement

### 4.1 Add a confidence signal pipeline per turn

For each student response:

1. STT transcript from Azure Speech (already present for voice path).
2. Sentiment and confidence analysis from Azure Cognitive endpoint.
3. Compute normalized confidence score (0-100).
4. Store turn-level metrics.
5. Feed confidence + sentiment into next-question generation.

### 4.2 Adapt question difficulty and tone based on confidence

Rules example:

- `confidence < 40`
  - Simplify question wording.
  - Ask narrower follow-up.
  - Add reassurance in tone.
- `40 <= confidence < 70`
  - Keep moderate depth.
  - Ask one challenge and one clarification.
- `confidence >= 70`
  - Ask deeper defense questions.
  - Increase rigor and counterargument pressure.

### 4.3 Backend changes

- **File:** `packages/api/src/coaching/coaching.service.ts`
  - In `message()` and `voice()`, run confidence analysis and attach to the turn.
  - Use a helper `deriveDifficultyFromConfidence()`.
  - Pass difficulty context to `azureOpenAi.coachResponse()`.

- **File:** `packages/api/src/integrations/azure/`
  - Add `azure-cognitive.service.ts` (or extend `azure-speech.service.ts` if you prefer fewer files).
  - Method example:
    - `analyzeResponse(text: string): Promise<{ sentiment: 'positive' | 'neutral' | 'negative'; confidence: number; hesitationSignals: string[] }>`

- **File:** `packages/api/src/integrations/azure/azure-openai.service.ts`
  - Extend `coachResponse()` prompt context:
    - learner profile
    - confidence score
    - current difficulty band
    - prior weak dimensions

### 4.4 Data model changes

Use `coaching_sessions` with JSONB extension to avoid heavy migration complexity.

Add columns:

- `learner_profile text default 'standard'`
- `turn_metrics jsonb default '[]'`
- `confidence_series jsonb default '[]'`

Each turn metric object:

```json
{
  "turn_index": 3,
  "timestamp": "2026-02-27T10:15:00.000Z",
  "sentiment": "neutral",
  "confidence": 58,
  "difficulty": "medium",
  "hesitation_signals": ["long_pause", "low_assertiveness"]
}
```

### 4.5 Frontend changes

- **File:** `packages/web/src/pages/student/StudentPages.tsx` (`StudentMockVivaPage`)
  - Add live "Confidence Meter".
  - Add "Current Difficulty" badge.
  - Show short adaptation explanation:
    - "Coach adjusted to medium challenge due to confidence trend."

### 4.6 Definition of done

- Every turn has confidence and sentiment metric.
- Difficulty changes can be observed during session.
- UI shows live confidence trend and current difficulty.
- Works in both text and voice paths (voice richer, text fallback heuristic).

---

## 5) Feature 2: Inclusive Learner Profile Adaptation

## Why this feature

Directly targets the bonus criterion for inclusive learner support and makes the system feel pedagogically intentional.

## What to implement

### 5.1 Supported profiles (minimum set)

- `esl_support`
- `anxious_speaker`
- `advanced_researcher`

### 5.2 Behavior matrix

- `esl_support`
  - Simpler sentence structure.
  - Slower question progression.
  - Clarification prompts and term explanations.

- `anxious_speaker`
  - Lower confrontation tone.
  - Confidence-building follow-ups.
  - Break complex questions into smaller steps.

- `advanced_researcher`
  - High rigor.
  - Counterfactual and methodology stress tests.
  - Faster difficulty ramp.

### 5.3 Backend changes

- **DTO update:** `packages/api/src/coaching/dto/start-coaching.dto.ts`
  - Add optional `learner_profile`.

- **Service update:** `packages/api/src/coaching/coaching.service.ts`
  - Persist profile in session record.
  - Pass profile into prompt generation and response generation.

- **Prompt update:** `packages/api/src/integrations/azure/azure-openai.service.ts`
  - Include profile-specific system instructions.
  - Ensure evaluator normalizes scoring fairness by profile.

### 5.4 Frontend changes

- **File:** `packages/web/src/pages/student/StudentPages.tsx`
  - Add profile selector before session start.
  - Add short profile explanation text.
  - Send selected profile with `/coaching/start`.

### 5.5 Definition of done

- User can choose profile before session.
- Question style visibly changes by profile.
- Session report includes profile used and coaching strategy notes.

---

## 6) Feature 3: Real-Time Performance Analytics (In Session)

## Why this feature

Judges need measurable proof of learning impact, not only conversational quality.

## What to implement

### 6.1 Score dimensions per turn

- `argument_strength` (0-100)
- `evidence_quality` (0-100)
- `logical_consistency` (0-100)
- `clarity` (0-100)
- `confidence` (0-100)

### 6.2 Real-time aggregation

Maintain:

- Running average by dimension.
- Trend (improving, stable, declining).
- Turn-by-turn sparkline data points.

### 6.3 Backend changes

- **Service:** `packages/api/src/coaching/coaching.service.ts`
  - After each message, call lightweight scoring routine:
    - GPT rubric scoring or heuristic fallback.
  - Append turn metrics to session.
  - Return `live_metrics` in `/coaching/message` response.

Response shape example:

```json
{
  "session_id": "abc",
  "ai_message": "Good defense. Now explain your sampling bias mitigation.",
  "question_index": 4,
  "total_questions": 10,
  "live_metrics": {
    "turn": 4,
    "scores": {
      "argument_strength": 67,
      "evidence_quality": 61,
      "logical_consistency": 72,
      "clarity": 70,
      "confidence": 58
    },
    "trend": "improving"
  }
}
```

### 6.4 Frontend changes

- **File:** `packages/web/src/pages/student/StudentPages.tsx`
  - Add live analytics panel in `StudentMockVivaPage`.
  - Show:
    - dimension score chips
    - mini trend indicator
    - "focus next" hint

### 6.5 End-of-session report upgrade

Include:

- first-turn vs final-turn comparison
- strongest improved dimension
- weakest persistent dimension
- next 3 targeted actions

### 6.6 Definition of done

- Metrics update every turn in the UI.
- End report clearly reflects improvement trajectory.
- Works without breaking latency budget.

---

## 7) API and Contract Updates

## `POST /coaching/start`

Add request field:

```json
{
  "thesis_id": "uuid",
  "mode": "mock_viva",
  "learner_profile": "esl_support"
}
```

## `POST /coaching/message`

Return `live_metrics` payload each turn.

## `POST /coaching/end`

Return enriched summary:

- overall readiness
- per-dimension summary
- improvement deltas
- personalized action plan

---

## 8) Implementation Sequence (Recommended)

1. Add data model and DTO changes.
2. Implement confidence/sentiment service integration.
3. Wire adaptive difficulty logic in coaching loop.
4. Add learner profile selection and prompt strategies.
5. Add real-time metrics generation and return payload.
6. Build frontend live analytics panel.
7. Upgrade end-session summary.
8. Add fallback and reliability hardening.

---

## 9) Reliability and Fallback Strategy

## Required fallback rules

- If Azure Cognitive fails:
  - Use heuristic confidence scoring from text signals (answer length, hedging terms, uncertainty phrases).
- If STT latency is high:
  - Fall back to browser speech recognition or text input.
- If OpenAI scoring call fails:
  - Use deterministic heuristic scoring for live metrics.

## Rule

Never block session flow because one service fails.

---

## 10) Testing Plan

## Backend tests

- Confidence band mapping logic.
- Profile-specific prompt selection.
- Live metrics schema validity.
- End report aggregation correctness.

## Frontend tests

- Profile selector state and request payload.
- Live analytics panel rendering.
- Trend updates from streamed turns.
- Voice fallback behavior.

## Manual demo tests

- Low-confidence path visibly softens questioning.
- High-confidence path visibly increases rigor.
- ESL profile uses simpler phrasing than advanced profile.

---

## 11) Demo Script (Judge-Optimized)

## 0:00-0:20

Problem framing:
"Students do not get realistic defense practice, and feedback is often delayed."

## 0:20-0:55

Start coaching session:

- choose profile (`anxious_speaker`)
- ask first question
- answer via voice

## 0:55-1:20

Show adaptation:

- confidence dip detected
- system shifts to supportive medium difficulty
- live metrics update

## 1:20-1:45

Switch profile (`advanced_researcher`) quick replay or pre-recorded comparison:

- visibly harder challenge style

## 1:45-2:00

End report:

- measurable improvement
- clear next actions
- Azure services callout

---

## 12) Time-Box Plan

If time is limited:

1. Complete Feature 1 fully.
2. Implement 2 learner profiles only (`anxious_speaker`, `advanced_researcher`) then add ESL copy.
3. Ship simple line trend + 5 score chips instead of heavy charting.

Do not spend time on lower-priority features (citation deepening, milestone-aware scoring) before the 3 core coaching features are demo-ready.

---

## 13) Final Delivery Checklist

- Adaptive confidence loop is visible in live demo.
- Inclusive profile adaptation is selectable and obvious.
- Real-time analytics updates on every turn.
- End report shows measurable progression.
- Azure usage is explicit in slides and spoken narrative.
- Fallbacks are tested to avoid demo failure.
