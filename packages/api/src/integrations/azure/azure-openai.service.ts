import { Injectable, Logger } from '@nestjs/common';
import OpenAI from 'openai';

type ChatRole = 'system' | 'user' | 'assistant';
interface ChatMessage {
  role: ChatRole;
  content: string;
}

@Injectable()
export class AzureOpenAiService {
  private readonly logger = new Logger(AzureOpenAiService.name);
  private client: OpenAI | null = null;
  private readonly deployment: string;

  constructor() {
    const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
    const apiKey = process.env.AZURE_OPENAI_KEY;
    this.deployment = process.env.AZURE_OPENAI_DEPLOYMENT ?? 'gpt-4o';

    if (endpoint && apiKey) {
      this.client = new OpenAI({
        apiKey,
        baseURL: `${endpoint.replace(/\/$/, '')}/openai/deployments/${this.deployment}`,
        defaultQuery: { 'api-version': '2024-02-01' },
        defaultHeaders: { 'api-key': apiKey },
      });
      this.logger.log('Azure OpenAI client initialized.');
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
        max_tokens: maxTokens,
        temperature: 0.7,
      });
      return response.choices[0]?.message?.content ?? null;
    } catch (err) {
      this.logger.error('Azure OpenAI chat error', err);
      return null;
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

    const prompt = `You are a thesis evaluation engine. Analyze the following thesis text and return a JSON object.

Abstract: ${opts.abstract ?? 'Not provided'}
Thesis text (first 8000 chars): ${opts.currentText.slice(0, 8000)}
${opts.previousText ? `Previous version excerpt: ${opts.previousText.slice(0, 2000)}` : ''}

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
  }): Promise<string[]> {
    const count = opts.count ?? 10;

    const modeDesc = {
      mock_viva: `${count} challenging viva voce examination questions an examiner panel would ask about this specific thesis`,
      argument_defender: `${count} specific claims or arguments from this thesis that the student must defend against a critical reviewer`,
      socratic: `${count} Socratic guiding questions that help the student think deeper about their specific thesis without giving answers`,
    }[opts.mode];

    const prompt = `Based on this thesis, generate exactly ${count} ${modeDesc}.

Abstract: ${opts.abstract ?? 'Not provided'}
Thesis content (first 6000 chars): ${opts.thesisText.slice(0, 6000)}

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
  }): Promise<string | null> {
    const systemPrompts: Record<string, string> = {
      mock_viva: `You are a strict academic examiner conducting a viva voce for this thesis. Briefly acknowledge the student's answer (1 sentence), then ask the next question. Do not give away answers. Be rigorous but fair.\n\nThesis context: ${opts.thesisContext.slice(0, 3000)}${opts.nextQuestion ? `\n\nNext question to ask: "${opts.nextQuestion}"` : ''}`,

      argument_defender: `You are a critical academic reviewer challenging the student's thesis. Push back on weaknesses, demand stronger evidence, challenge assumptions. Never provide answers. Be specific to their thesis content.\n\nThesis context: ${opts.thesisContext.slice(0, 3000)}`,

      socratic: `You are a Socratic coach. Ask probing follow-up questions based on the student's response. Never answer for the student — only ask questions that deepen their thinking. Reference their specific thesis content.\n\nThesis context: ${opts.thesisContext.slice(0, 3000)}`,
    };

    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompts[opts.mode] },
      ...opts.transcript.slice(-8).map((t) => ({
        role: (t.role === 'student' ? 'user' : 'assistant') as ChatRole,
        content: t.content,
      })),
      { role: 'user', content: opts.userMessage },
    ];

    return this.chat(messages, 500);
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
      const result = JSON.parse(this.cleanJson(raw)) as { formatting_errors?: string[] };
      return { formatting_errors: result.formatting_errors ?? [] };
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
