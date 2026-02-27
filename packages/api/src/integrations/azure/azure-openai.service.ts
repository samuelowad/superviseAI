import { Injectable, Logger } from '@nestjs/common';
import OpenAI from 'openai';

type ChatRole = 'system' | 'user' | 'assistant';
interface ChatMessage {
  role: ChatRole;
  content: string;
}

interface ThesisChunk {
  index: number;
  start: number;
  end: number;
  text: string;
}

interface RetrievedContext {
  context: string;
  totalChunks: number;
  selectedChunkIndexes: number[];
}

@Injectable()
export class AzureOpenAiService {
  private readonly logger = new Logger(AzureOpenAiService.name);
  private client: OpenAI | null = null;
  private readonly deployment: string;

  constructor() {
    const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
    const apiKey = process.env.AZURE_OPENAI_KEY;
    const deploymentEnv = process.env.AZURE_OPENAI_DEPLOYMENT;
    const resolved = this.resolveAzureOpenAiConfig(endpoint, deploymentEnv);
    this.deployment = resolved.deployment ?? 'gpt-4o';

    if (resolved.baseURL && apiKey) {
      this.client = new OpenAI({
        apiKey,
        baseURL: resolved.baseURL,
      });
      this.logger.log(
        `Azure OpenAI client initialized (baseURL: ${resolved.baseURL}, deployment: ${this.deployment}).`,
      );
    } else {
      this.logger.warn(
        'Azure OpenAI not configured — coaching/analysis will use heuristic fallback.',
      );
    }
  }

  isAvailable(): boolean {
    return this.client !== null;
  }

  async chat(messages: ChatMessage[], maxTokens = 1000): Promise<string | null> {
    if (!this.client) return null;
    try {
      const response = await this.client.chat.completions.create({
        model: this.deployment,
        messages,
        temperature: 0.7,
        max_tokens: maxTokens,
      });
      return response.choices[0]?.message?.content ?? null;
    } catch (err) {
      this.logger.error('Azure OpenAI chat error', err);
      return null;
    }
  }

  private resolveAzureOpenAiConfig(
    endpointRaw?: string,
    deploymentRaw?: string,
  ): { baseURL: string | null; deployment: string | null } {
    const endpoint = endpointRaw?.trim();
    const deploymentFromEnv = deploymentRaw?.trim() || null;
    if (!endpoint) {
      return { baseURL: null, deployment: deploymentFromEnv };
    }

    try {
      const parsed = new URL(endpoint);
      const pathname = parsed.pathname || '/';

      const deploymentFromPathMatch = pathname.match(/\/openai\/deployments\/([^/]+)/i);
      const deploymentFromPath = deploymentFromPathMatch?.[1]
        ? decodeURIComponent(deploymentFromPathMatch[1])
        : null;

      if (pathname.includes('/openai/v1')) {
        const openAiV1Base = `${parsed.origin}/openai/v1/`;
        return {
          baseURL: openAiV1Base,
          deployment: deploymentFromEnv ?? deploymentFromPath,
        };
      }

      if (pathname.includes('/openai/deployments/')) {
        return {
          baseURL: `${parsed.origin}/openai/v1/`,
          deployment: deploymentFromEnv ?? deploymentFromPath,
        };
      }

      return {
        baseURL: `${parsed.origin}/openai/v1/`,
        deployment: deploymentFromEnv ?? deploymentFromPath,
      };
    } catch {
      return {
        baseURL: endpoint,
        deployment: deploymentFromEnv,
      };
    }
  }

  private cleanJson(raw: string): string {
    return raw
      .trim()
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/```\s*$/i, '');
  }

  async analyzeThesis(opts: {
    currentText: string;
    abstract: string | null;
    previousText?: string | null;
    versionNumber: number;
  }): Promise<{
    progress_score: number;
    abstract_alignment_verdict: string;
    key_topic_coverage: string[];
    missing_core_sections: string[];
    structural_readiness: string;
    gap_report: string[];
    next_steps: string[];
    trend_delta: number;
  } | null> {
    if (!this.client) return null;

    const currentCtx = this.retrieveThesisContext(opts.currentText, {
      query:
        'overall thesis objective introduction methodology results discussion conclusion limitations references contributions',
      maxChunks: 8,
      chunkSize: 1800,
      overlap: 250,
      maxChars: 14000,
      ensureCoverage: true,
    });
    const previousCtx = opts.previousText
      ? this.retrieveThesisContext(opts.previousText, {
          query: 'previous thesis draft key arguments methods results limitations',
          maxChunks: 3,
          chunkSize: 1800,
          overlap: 250,
          maxChars: 4500,
          ensureCoverage: true,
        })
      : null;

    const prompt = `You are a thesis evaluation engine. Analyze the following thesis text and return a JSON object.

Abstract: ${opts.abstract ?? 'Not provided'}
Current thesis context (retrieved from full thesis via chunking):
${currentCtx.context}
Current thesis metadata: total_chunks=${currentCtx.totalChunks}, selected_chunks=${currentCtx.selectedChunkIndexes
      .map((i) => i + 1)
      .join(',')}
${previousCtx ? `\nPrevious version context (retrieved from full previous draft):\n${previousCtx.context}\nPrevious version metadata: total_chunks=${previousCtx.totalChunks}, selected_chunks=${previousCtx.selectedChunkIndexes.map((i) => i + 1).join(',')}` : ''}

Return ONLY valid JSON with these exact fields:
{
  "progress_score": <integer 35-95, overall completeness/quality>,
  "abstract_alignment_verdict": <"on_track"|"partially_aligned"|"needs_realignment"|"insufficient_data">,
  "key_topic_coverage": [<up to 4 sections or topics that are well covered>],
  "missing_core_sections": [<sections absent or underdeveloped>],
  "structural_readiness": <"strong"|"moderate"|"developing">,
  "gap_report": [<up to 5 specific weaknesses or gaps>],
  "next_steps": [<up to 4 concrete next actions for the student>],
  "trend_delta": <integer -20 to 20, improvement vs previous version; 0 if first version>
}`;

    const raw = await this.chat(
      [
        {
          role: 'system',
          content: 'You are a precise academic thesis evaluator. Return only valid JSON.',
        },
        { role: 'user', content: prompt },
      ],
      1400,
    );
    if (!raw) return null;

    try {
      return JSON.parse(this.cleanJson(raw)) as ReturnType<
        typeof this.analyzeThesis
      > extends Promise<infer R>
        ? Exclude<R, null>
        : never;
    } catch {
      const fixed = await this.chat(
        [
          { role: 'system', content: 'Return only valid JSON. No markdown, no explanation.' },
          { role: 'user', content: prompt },
          { role: 'assistant', content: raw },
          { role: 'user', content: 'The JSON was invalid. Return only the raw JSON object.' },
        ],
        1400,
      );
      if (!fixed) return null;
      try {
        return JSON.parse(this.cleanJson(fixed)) as ReturnType<
          typeof this.analyzeThesis
        > extends Promise<infer R>
          ? Exclude<R, null>
          : never;
      } catch {
        return null;
      }
    }
  }

  async generateCoachQuestions(opts: {
    thesisText: string;
    abstract: string | null;
    mode: 'mock_viva' | 'argument_defender' | 'socratic';
    count?: number;
    learnerProfile?: 'standard' | 'esl_support' | 'anxious_speaker' | 'advanced_researcher';
  }): Promise<string[]> {
    const count = opts.count ?? 10;
    const learnerProfile = opts.learnerProfile ?? 'standard';

    const modeDesc = {
      mock_viva:
        'challenging viva voce examination questions an examiner panel would ask about this specific thesis',
      argument_defender:
        'specific claims or arguments from this thesis that the student must defend against a critical reviewer',
      socratic:
        'Socratic guiding questions that help the student think deeper about their specific thesis without giving answers',
    }[opts.mode];

    const profileInstructions: Record<string, string> = {
      standard: '',
      esl_support:
        'Use simpler sentence construction and shorter clauses so questions remain clear for ESL learners.',
      anxious_speaker:
        'Use a supportive, confidence-building tone while still preserving academic challenge.',
      advanced_researcher:
        'Use high-rigor academic phrasing and deeper methodological pressure in the questions.',
    };

    const retrieval = this.retrieveThesisContext(opts.thesisText, {
      query: `${opts.mode} thesis methodology evidence limitations contribution findings ${opts.abstract ?? ''}`,
      maxChunks: 7,
      chunkSize: 1800,
      overlap: 250,
      maxChars: 12000,
      ensureCoverage: true,
    });

    const prompt = `Based on this thesis, generate exactly ${count} ${modeDesc}.

Abstract: ${opts.abstract ?? 'Not provided'}
Thesis context (retrieved from full thesis via chunking):
${retrieval.context}
Context metadata: total_chunks=${retrieval.totalChunks}, selected_chunks=${retrieval.selectedChunkIndexes
      .map((i) => i + 1)
      .join(',')}
${profileInstructions[learnerProfile] ? `\nLearner profile guidance: ${profileInstructions[learnerProfile]}` : ''}

Return ONLY a JSON array of exactly ${count} question strings. Be specific to this thesis — reference actual content, not generic questions.
Example: ["Question about their specific method?", "Why did they choose X over Y?"]`;

    const raw = await this.chat(
      [
        {
          role: 'system',
          content:
            'You generate thesis-specific coaching questions. Return only a JSON array of strings.',
        },
        { role: 'user', content: prompt },
      ],
      1600,
    );

    if (!raw) return this.getFallbackQuestions(opts.mode, count);

    try {
      const questions = JSON.parse(this.cleanJson(raw)) as unknown;
      if (Array.isArray(questions) && questions.length > 0) {
        return (questions as string[]).slice(0, count);
      }
    } catch {
      // fall through to fallback
    }
    return this.getFallbackQuestions(opts.mode, count);
  }

  async coachResponse(opts: {
    thesisContext: string;
    abstract: string | null;
    mode: 'mock_viva' | 'argument_defender' | 'socratic';
    transcript: Array<{ role: 'assistant' | 'student'; content: string }>;
    userMessage: string;
    nextQuestion?: string;
    learnerProfile?: 'standard' | 'esl_support' | 'anxious_speaker' | 'advanced_researcher';
    confidence?: number;
    difficultyBand?: 'easy' | 'medium' | 'hard';
  }): Promise<string | null> {
    const profile = opts.learnerProfile ?? 'standard';
    const difficulty = opts.difficultyBand ?? 'medium';
    const confidence = opts.confidence ?? 60;

    const profileInstructions: Record<string, string> = {
      standard: '',
      esl_support:
        'The student may not be a native English speaker. Use simple, clear sentence structures. Avoid idioms. Define any technical terms you use. Allow extra latitude for minor grammar issues.',
      anxious_speaker:
        'The student shows signs of anxiety. Use an encouraging, supportive tone. Break complex questions into smaller steps. Affirm effort before asking follow-ups. Never use confrontational phrasing.',
      advanced_researcher:
        'The student is an experienced researcher. Use precise academic language. Apply maximum critical rigour. Challenge methodology, epistemology, and generalisability without restraint.',
    };

    const difficultyInstructions: Record<string, string> = {
      easy: `Student confidence is low (${confidence}/100). Simplify your question. Ask only one narrow, specific follow-up. Begin with brief encouragement (1 sentence).`,
      medium: `Student confidence is moderate (${confidence}/100). Maintain standard depth. Ask one challenge and one clarification if needed.`,
      hard: `Student confidence is high (${confidence}/100). Push harder — demand deeper evidence, raise counterarguments, stress-test their methodology. Increase intellectual pressure.`,
    };

    const basePrompts: Record<string, string> = {
      mock_viva:
        "You are a strict academic examiner conducting a viva voce. Briefly acknowledge the student's answer (1 sentence), then ask the next question. Be rigorous but fair. Do not give away answers.",
      argument_defender:
        "You are a critical academic reviewer. Challenge the student's claims directly. Demand stronger evidence, expose hidden assumptions, and test the limits of their argument. Never provide answers.",
      socratic:
        'You are a Socratic coach. Ask probing follow-up questions only. Never answer for the student. Every response must end with a question that deepens their thinking.',
    };

    const retrieval = this.retrieveThesisContext(opts.thesisContext, {
      query: `${opts.mode} ${opts.userMessage} ${opts.nextQuestion ?? ''}`,
      maxChunks: 4,
      chunkSize: 1600,
      overlap: 250,
      maxChars: 7000,
      ensureCoverage: false,
    });

    const systemContent = [
      basePrompts[opts.mode],
      '',
      `Thesis context (retrieved from full thesis via chunking):\n${retrieval.context}`,
      `Context metadata: total_chunks=${retrieval.totalChunks}, selected_chunks=${retrieval.selectedChunkIndexes
        .map((i) => i + 1)
        .join(',')}`,
      opts.nextQuestion ? `\nNext question to ask: "${opts.nextQuestion}"` : '',
      '',
      `DIFFICULTY GUIDANCE: ${difficultyInstructions[difficulty]}`,
      profileInstructions[profile] ? `\nLEARNER PROFILE: ${profileInstructions[profile]}` : '',
    ]
      .join('\n')
      .trim();

    const messages: ChatMessage[] = [
      { role: 'system', content: systemContent },
      ...opts.transcript.slice(-8).map((t) => ({
        role: (t.role === 'student' ? 'user' : 'assistant') as ChatRole,
        content: t.content,
      })),
      { role: 'user', content: opts.userMessage },
    ];

    return this.chat(messages, 550);
  }

  async scoreTurn(opts: { studentAnswer: string; question: string; thesisTitle: string }): Promise<{
    argument_strength: number;
    evidence_quality: number;
    logical_consistency: number;
    clarity: number;
    confidence: number;
  } | null> {
    if (!this.client) return null;

    const prompt = `You are an academic assessment engine. Score the following student answer in a thesis coaching session.

Thesis: "${opts.thesisTitle}"
Question asked: "${opts.question.slice(0, 300)}"
Student answer: "${opts.studentAnswer.slice(0, 800)}"

Return ONLY valid JSON with integer scores 0-100 for each dimension:
{
  "argument_strength": <how well-structured and assertive the core argument is>,
  "evidence_quality": <quality and specificity of evidence or examples cited>,
  "logical_consistency": <absence of contradictions and strength of reasoning chain>,
  "clarity": <how clearly the answer is expressed and organised>,
  "confidence": <confidence and assertiveness conveyed in the answer>
}`;

    const raw = await this.chat(
      [
        { role: 'system', content: 'Return only valid JSON. No explanation.' },
        { role: 'user', content: prompt },
      ],
      200,
    );

    if (!raw) return null;
    try {
      const result = JSON.parse(this.cleanJson(raw)) as {
        argument_strength?: number;
        evidence_quality?: number;
        logical_consistency?: number;
        clarity?: number;
        confidence?: number;
      };
      return {
        argument_strength: Math.min(100, Math.max(0, result.argument_strength ?? 50)),
        evidence_quality: Math.min(100, Math.max(0, result.evidence_quality ?? 50)),
        logical_consistency: Math.min(100, Math.max(0, result.logical_consistency ?? 50)),
        clarity: Math.min(100, Math.max(0, result.clarity ?? 50)),
        confidence: Math.min(100, Math.max(0, result.confidence ?? 50)),
      };
    } catch {
      return null;
    }
  }

  async checkIntentGuard(
    userMessage: string,
    thesisTitle: string,
  ): Promise<'on_topic_answer' | 'clarification' | 'off_topic' | 'malicious_or_irrelevant'> {
    if (!this.client) return 'on_topic_answer';

    const raw = await this.chat(
      [
        {
          role: 'system',
          content: `Classify the student's message in a thesis coaching session about "${thesisTitle}". Return ONLY one word: on_topic_answer, clarification, off_topic, or malicious_or_irrelevant`,
        },
        { role: 'user', content: userMessage.slice(0, 500) },
      ],
      10,
    );

    const intent = raw?.trim().toLowerCase() ?? 'on_topic_answer';
    const valid = ['on_topic_answer', 'clarification', 'off_topic', 'malicious_or_irrelevant'];
    return valid.includes(intent)
      ? (intent as 'on_topic_answer' | 'clarification' | 'off_topic' | 'malicious_or_irrelevant')
      : 'on_topic_answer';
  }

  async validateCitationFormats(citations: string[]): Promise<{
    formatting_errors: string[];
  }> {
    if (!this.client || citations.length === 0) return { formatting_errors: [] };

    const sample = citations.slice(0, 25);
    const raw = await this.chat(
      [
        { role: 'system', content: 'You are a citation format validator.' },
        {
          role: 'user',
          content: `Check these citations for formatting problems. Return JSON:\n${sample.join('\n')}\n\nReturn: {"formatting_errors": [<list of problematic citations or descriptions of errors>]}`,
        },
      ],
      600,
    );

    if (!raw) return { formatting_errors: [] };
    try {
      const result = JSON.parse(this.cleanJson(raw)) as { formatting_errors?: unknown[] };
      const rawErrors = result.formatting_errors ?? [];
      const formatting_errors = rawErrors.map((e) => {
        if (typeof e === 'string') return e;
        if (e && typeof e === 'object') {
          const obj = e as Record<string, unknown>;
          if (obj.issue && obj.description) return `${obj.issue}: ${obj.description}`;
          return JSON.stringify(e);
        }
        return String(e);
      });
      return { formatting_errors };
    } catch {
      return { formatting_errors: [] };
    }
  }

  async evaluateSession(opts: {
    transcript: Array<{ role: string; content: string }>;
    thesisTitle: string;
    mode: string;
  }): Promise<{ readiness_score: number; weak_topics: string[]; recommendation: string } | null> {
    if (!this.client) return null;

    const transcriptText = opts.transcript
      .slice(-20)
      .map((t) => `${t.role === 'student' ? 'Student' : 'Coach'}: ${t.content}`)
      .join('\n');

    const raw = await this.chat(
      [
        {
          role: 'system',
          content: `Evaluate student performance in a thesis coaching session (${opts.mode} mode) for "${opts.thesisTitle}".`,
        },
        {
          role: 'user',
          content: `Session:\n${transcriptText}\n\nReturn JSON:\n{"readiness_score": <40-96>, "weak_topics": [<2-4 specific weak areas>], "recommendation": "<1-2 sentences>"}`,
        },
      ],
      500,
    );

    if (!raw) return null;
    try {
      return JSON.parse(this.cleanJson(raw)) as {
        readiness_score: number;
        weak_topics: string[];
        recommendation: string;
      };
    } catch {
      return null;
    }
  }

  private retrieveThesisContext(
    text: string,
    opts: {
      query: string;
      maxChunks: number;
      chunkSize: number;
      overlap: number;
      maxChars: number;
      ensureCoverage: boolean;
    },
  ): RetrievedContext {
    const clean = text.trim();
    if (!clean) {
      return { context: 'No thesis text available.', totalChunks: 0, selectedChunkIndexes: [] };
    }

    const chunks = this.chunkText(clean, opts.chunkSize, opts.overlap);
    if (chunks.length <= opts.maxChunks) {
      return {
        context: this.formatChunkContext(chunks, opts.maxChars),
        totalChunks: chunks.length,
        selectedChunkIndexes: chunks.map((c) => c.index),
      };
    }

    const ranked = this.rankChunks(chunks, opts.query);
    const selected = this.pickChunkIndexes(
      ranked,
      chunks.length,
      opts.maxChunks,
      opts.ensureCoverage,
    );
    const selectedChunks = selected.map((idx) => chunks[idx]).filter(Boolean);

    return {
      context: this.formatChunkContext(selectedChunks, opts.maxChars),
      totalChunks: chunks.length,
      selectedChunkIndexes: selected,
    };
  }

  private chunkText(text: string, chunkSize: number, overlap: number): ThesisChunk[] {
    const chunks: ThesisChunk[] = [];
    const normalized = text.replace(/\r\n/g, '\n').trim();
    if (!normalized) return chunks;

    let start = 0;
    let index = 0;
    while (start < normalized.length) {
      let end = Math.min(start + chunkSize, normalized.length);

      if (end < normalized.length) {
        const softBoundary = Math.max(
          normalized.lastIndexOf('\n', end),
          normalized.lastIndexOf('. ', end),
        );
        if (softBoundary > start + Math.floor(chunkSize * 0.6)) {
          end = softBoundary + 1;
        }
      }

      if (end <= start) end = Math.min(start + chunkSize, normalized.length);

      const chunkText = normalized.slice(start, end).trim();
      if (chunkText) {
        chunks.push({ index, start, end, text: chunkText });
        index += 1;
      }

      if (end >= normalized.length) break;
      start = Math.max(end - overlap, start + 1);
    }

    return chunks;
  }

  private rankChunks(chunks: ThesisChunk[], query: string): Array<{ idx: number; score: number }> {
    const queryTerms = this.extractQueryTerms(query);
    const headings = [
      'introduction',
      'methodology',
      'methods',
      'results',
      'discussion',
      'conclusion',
      'limitations',
      'future work',
      'references',
    ];

    return chunks
      .map((chunk) => {
        const lower = chunk.text.toLowerCase();
        let score = 0;

        for (const term of queryTerms) {
          if (lower.includes(term)) {
            score += term.length >= 7 ? 2 : 1;
          }
        }

        for (const heading of headings) {
          if (lower.includes(heading)) {
            score += 0.35;
          }
        }

        return { idx: chunk.index, score };
      })
      .sort((a, b) => (b.score === a.score ? a.idx - b.idx : b.score - a.score));
  }

  private pickChunkIndexes(
    ranked: Array<{ idx: number; score: number }>,
    totalChunks: number,
    maxChunks: number,
    ensureCoverage: boolean,
  ): number[] {
    const selected: number[] = [];
    const minDistance = totalChunks > 8 ? 2 : 1;
    const scoreMap = new Map<number, number>(ranked.map((r) => [r.idx, r.score]));

    for (const candidate of ranked) {
      if (selected.length >= maxChunks) break;
      if (selected.length === 0) {
        selected.push(candidate.idx);
        continue;
      }
      const farEnough = selected.every((s) => Math.abs(s - candidate.idx) >= minDistance);
      if (farEnough) {
        selected.push(candidate.idx);
      }
    }

    if (selected.length < maxChunks) {
      for (const candidate of ranked) {
        if (selected.length >= maxChunks) break;
        if (!selected.includes(candidate.idx)) selected.push(candidate.idx);
      }
    }

    if (ensureCoverage && totalChunks > 2) {
      const coverageTargets = Array.from(
        new Set([0, Math.floor((totalChunks - 1) / 2), totalChunks - 1]),
      );

      for (const target of coverageTargets) {
        if (selected.includes(target)) continue;
        if (selected.length < maxChunks) {
          selected.push(target);
          continue;
        }

        const replaceIdx = selected
          .filter((idx) => !coverageTargets.includes(idx))
          .sort((a, b) => (scoreMap.get(a) ?? 0) - (scoreMap.get(b) ?? 0))[0];

        if (replaceIdx !== undefined) {
          selected[selected.indexOf(replaceIdx)] = target;
        }
      }
    }

    return Array.from(new Set(selected))
      .sort((a, b) => a - b)
      .slice(0, maxChunks);
  }

  private extractQueryTerms(query: string): string[] {
    const stopwords = new Set([
      'the',
      'and',
      'for',
      'that',
      'with',
      'from',
      'this',
      'into',
      'your',
      'about',
      'what',
      'when',
      'where',
      'which',
      'while',
      'have',
      'will',
      'would',
      'should',
      'could',
      'their',
      'them',
      'they',
      'then',
      'than',
      'only',
    ]);

    return Array.from(
      new Set(
        query
          .toLowerCase()
          .replace(/[^a-z0-9\s]/g, ' ')
          .split(/\s+/)
          .map((t) => t.trim())
          .filter((t) => t.length >= 3 && !stopwords.has(t)),
      ),
    ).slice(0, 36);
  }

  private formatChunkContext(chunks: ThesisChunk[], maxChars: number): string {
    if (chunks.length === 0) return 'No thesis text available.';

    const blocks: string[] = [];
    let remaining = maxChars;

    for (const chunk of chunks) {
      if (remaining <= 60) break;

      const header = `[Chunk ${chunk.index + 1} | chars ${chunk.start + 1}-${chunk.end}]`;
      const headerCost = header.length + 1;
      if (headerCost >= remaining) break;

      const bodyBudget = remaining - headerCost - 2;
      let body = chunk.text;
      if (body.length > bodyBudget) {
        body = `${body.slice(0, Math.max(0, bodyBudget - 3)).trim()}...`;
      }

      blocks.push(`${header}\n${body}`);
      remaining -= header.length + body.length + 2;
    }

    return blocks.join('\n\n');
  }

  private getFallbackQuestions(
    mode: 'mock_viva' | 'argument_defender' | 'socratic',
    count: number,
  ): string[] {
    const banks: Record<string, string[]> = {
      mock_viva: [
        'Summarize your thesis argument for an examiner panel in 60 seconds.',
        'Which methodological choice is most vulnerable to criticism and why did you still choose it?',
        'What is the strongest evidence supporting your core argument?',
        'What counterargument would you raise against your own findings?',
        'Which limitation should examiners care about most?',
        'How does your work extend existing literature beyond replication?',
        'If one result is challenged, how does your conclusion change?',
        'What would be your next research step after this thesis?',
        'Which citation in your work is most critical to defend under pressure?',
        'Why should your thesis matter to practitioners, not only academics?',
      ],
      argument_defender: [
        'Your sample size seems insufficient to support these conclusions — defend your choice.',
        'Why should we trust this methodology over well-established alternatives?',
        'Your literature review appears to miss key recent work in this area.',
        'This argument relies on an assumption you have not tested — justify it.',
        'A critic would say your findings cannot be generalized. Respond.',
        'Your data analysis method has known limitations you have not addressed.',
        'Why is this contribution significant beyond what already exists?',
        'How do you account for potential confounding variables in your results?',
        'Your conclusions seem stronger than your evidence supports — defend them.',
        'What makes your theoretical framework superior to alternatives?',
      ],
      socratic: [
        'What core assumption underlies your main argument?',
        'Why did you choose this particular research approach over others?',
        'What evidence would cause you to revise your conclusion?',
        'How do you define the central concept in your thesis?',
        'Where does your argument break down under scrutiny?',
        'Why does this problem matter in the broader academic context?',
        'How does your approach compare to alternative methods?',
        'What would make your evidence stronger?',
        'What questions does your thesis intentionally leave unanswered?',
        'How would a skeptic challenge your methodology?',
      ],
    };
    return (banks[mode] ?? banks.mock_viva).slice(0, count);
  }
}
