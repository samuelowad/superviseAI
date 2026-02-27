import { Injectable, Logger } from '@nestjs/common';

export interface ConfidenceAnalysis {
  sentiment: 'positive' | 'neutral' | 'negative';
  confidence: number; // 0-100
  hesitationSignals: string[];
}

const HEDGING_TERMS = [
  'i think',
  'i believe',
  'maybe',
  'perhaps',
  'possibly',
  'probably',
  "i'm not sure",
  'i am not sure',
  'i guess',
  'kind of',
  'sort of',
  'not certain',
  'might be',
  'could be',
  'i suppose',
  'roughly',
  'approximately',
  "i'm not confident",
  'unsure',
];

const CERTAINTY_TERMS = [
  'clearly',
  'definitely',
  'certainly',
  'absolutely',
  'without doubt',
  'evidently',
  'undoubtedly',
  'demonstrably',
  'specifically',
  'precisely',
];

@Injectable()
export class AzureCognitiveService {
  private readonly logger = new Logger(AzureCognitiveService.name);
  private readonly key: string | null;
  private readonly endpoint: string | null;

  constructor() {
    // Support both naming conventions so existing environments do not break.
    this.key =
      process.env.AZURE_LANGUAGE_KEY ??
      process.env.AZURE_COGNITIVE_KEY ??
      process.env.AZURE_OPENAI_KEY ??
      null;
    this.endpoint =
      process.env.AZURE_LANGUAGE_ENDPOINT ?? process.env.AZURE_COGNITIVE_ENDPOINT ?? null;

    if (this.key && this.endpoint) {
      this.logger.log('Azure Cognitive (Language) Service initialized.');
    } else {
      this.logger.warn('Azure Language not configured — using heuristic confidence scoring.');
    }
  }

  isAvailable(): boolean {
    return Boolean(this.key && this.endpoint);
  }

  async analyzeConfidence(text: string): Promise<ConfidenceAnalysis> {
    const hesitationSignals = this.detectHesitationSignals(text);

    if (this.isAvailable()) {
      const azureResult = await this.callLanguageApi(text);
      if (azureResult) {
        const confidence = this.blendConfidence(azureResult, text, hesitationSignals);
        return { ...azureResult, confidence, hesitationSignals };
      }
    }

    // Heuristic fallback
    return this.heuristicAnalysis(text, hesitationSignals);
  }

  // ─── Private ──────────────────────────────────────────────────────────────

  private async callLanguageApi(
    text: string,
  ): Promise<{ sentiment: 'positive' | 'neutral' | 'negative'; confidence: number } | null> {
    try {
      const url = `${this.endpoint!.replace(/\/$/, '')}/language/:analyze-text?api-version=2023-04-01`;
      const body = {
        kind: 'SentimentAnalysis',
        analysisInput: {
          documents: [{ id: '1', text: text.slice(0, 5120), language: 'en' }],
        },
      };

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Ocp-Apim-Subscription-Key': this.key!,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        this.logger.warn(`Azure Language API error: ${response.status}`);
        return null;
      }

      const data = (await response.json()) as {
        results?: {
          documents?: Array<{
            sentiment: string;
            confidenceScores: { positive: number; neutral: number; negative: number };
          }>;
        };
      };

      const doc = data.results?.documents?.[0];
      if (!doc) return null;

      const { positive, neutral, negative } = doc.confidenceScores;
      // Map Azure sentiment scores to a student-confidence proxy (0-100)
      // Positive answers lean confident; negative lean hesitant; neutral is midpoint
      const rawConfidence = positive * 90 + neutral * 50 + negative * 15;
      const confidence = Math.round(Math.min(100, Math.max(0, rawConfidence)));

      const sentiment = doc.sentiment as 'positive' | 'neutral' | 'negative';
      return { sentiment, confidence };
    } catch (err) {
      this.logger.warn('Azure Language API call failed', err);
      return null;
    }
  }

  /**
   * Blend Azure API confidence with text-signal adjustments.
   */
  private blendConfidence(
    azure: { sentiment: string; confidence: number },
    text: string,
    hesitationSignals: string[],
  ): number {
    const lower = text.toLowerCase();
    const words = lower.split(/\s+/).filter(Boolean);
    const wordCount = words.length;

    // Length bonus (up to +15 for detailed answers)
    const lengthBonus = Math.min(15, Math.round(wordCount / 8));

    // Certainty boost
    const certaintyCount = CERTAINTY_TERMS.filter((t) => lower.includes(t)).length;
    const certaintyBoost = Math.min(10, certaintyCount * 5);

    // Hesitation penalty
    const hesitationPenalty = Math.min(30, hesitationSignals.length * 8);

    const blended = azure.confidence + lengthBonus + certaintyBoost - hesitationPenalty;
    return Math.round(Math.min(100, Math.max(0, blended)));
  }

  private heuristicAnalysis(text: string, hesitationSignals: string[]): ConfidenceAnalysis {
    const lower = text.toLowerCase();
    const words = lower.split(/\s+/).filter(Boolean);
    const wordCount = words.length;

    // Base score from length (longer = more substantive = more confident)
    const base = Math.min(65, 30 + wordCount * 1.2);

    // Certainty boost
    const certaintyCount = CERTAINTY_TERMS.filter((t) => lower.includes(t)).length;
    const certaintyBoost = Math.min(20, certaintyCount * 7);

    // Hesitation penalty
    const hesitationPenalty = Math.min(35, hesitationSignals.length * 10);

    const confidence = Math.round(
      Math.min(100, Math.max(0, base + certaintyBoost - hesitationPenalty)),
    );

    const sentiment: 'positive' | 'neutral' | 'negative' =
      confidence >= 65 ? 'positive' : confidence >= 40 ? 'neutral' : 'negative';

    return { sentiment, confidence, hesitationSignals };
  }

  private detectHesitationSignals(text: string): string[] {
    const lower = text.toLowerCase();
    const signals: string[] = [];

    for (const term of HEDGING_TERMS) {
      if (lower.includes(term)) {
        signals.push(term.replace(/['']/g, "'"));
      }
    }

    // Short answer signal
    const wordCount = lower.split(/\s+/).filter(Boolean).length;
    if (wordCount < 15) signals.push('short_answer');

    // Sentence fragment signal (no verb-like structure)
    if (wordCount < 5) signals.push('very_brief');

    return signals;
  }
}
