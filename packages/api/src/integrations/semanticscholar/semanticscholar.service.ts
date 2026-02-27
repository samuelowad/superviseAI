import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class SemanticScholarService {
  private readonly logger = new Logger(SemanticScholarService.name);
  private readonly apiKey: string | null;

  constructor() {
    this.apiKey = process.env.SEMANTIC_SCHOLAR_API_KEY ?? null;
  }

  /**
   * Layer 3 citation check: verify citations exist in Semantic Scholar.
   * Rate limited to 1 req/sec on free tier. Checks up to 10 citations.
   */
  async checkCitationsExist(
    citations: string[],
  ): Promise<{ verified: string[]; unverified: string[] }> {
    const verified: string[] = [];
    const unverified: string[] = [];

    const toCheck = citations.slice(0, 10);

    for (const citation of toCheck) {
      try {
        const query = encodeURIComponent(citation.replace(/[()[\]]/g, '').slice(0, 150));
        const headers: Record<string, string> = { Accept: 'application/json' };
        if (this.apiKey) headers['x-api-key'] = this.apiKey;

        const response = await fetch(
          `https://api.semanticscholar.org/graph/v1/paper/search?query=${query}&fields=title&limit=1`,
          { headers },
        );

        if (response.ok) {
          const data = (await response.json()) as { data?: unknown[] };
          if ((data.data?.length ?? 0) > 0) {
            verified.push(citation);
          } else {
            unverified.push(citation);
          }
        }
      } catch (err) {
        this.logger.warn(
          `Semantic Scholar check failed for citation: ${citation.slice(0, 60)}`,
          err,
        );
      }

      // Free tier: respect ~1 req/sec
      await new Promise<void>((resolve) => setTimeout(resolve, 1100));
    }

    return { verified, unverified };
  }
}
