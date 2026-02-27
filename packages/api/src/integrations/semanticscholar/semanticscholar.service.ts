import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class SemanticScholarService {
  private readonly logger = new Logger(SemanticScholarService.name);
  private readonly openAlexApiKey: string | null;

  constructor() {
    this.openAlexApiKey = process.env.OPENALEX_API_KEY ?? null;
    this.logger.log(
      `Citation verification using CrossRef + OpenAlex${this.openAlexApiKey ? ' (authenticated)' : ' (polite pool)'}.`,
    );
  }

  /**
   * Layer 3 citation check: verify citations exist via CrossRef and OpenAlex in parallel.
   * All citations are checked concurrently — no sequential delay.
   */
  async checkCitationsExist(
    citations: string[],
  ): Promise<{ verified: string[]; unverified: string[] }> {
    const verified: string[] = [];
    const unverified: string[] = [];
    const toCheck = citations.slice(0, 10);

    this.logger.log(`[Layer 3] Starting citation check for ${toCheck.length} citation(s)`);

    await Promise.all(
      toCheck.map(async (citation) => {
        const found = await this.checkOneCitation(citation);
        if (found) {
          verified.push(citation);
        } else {
          unverified.push(citation);
        }
      }),
    );

    this.logger.log(
      `[Layer 3] Done — verified: ${verified.length}, unverified: ${unverified.length}`,
    );

    return { verified, unverified };
  }

  private async checkOneCitation(citation: string): Promise<boolean> {
    const query = citation
      .replace(/[()[\]]/g, '')
      .slice(0, 150)
      .trim();
    const encoded = encodeURIComponent(query);

    this.logger.log(
      `[Layer 3] Checking: "${citation.slice(0, 80)}${citation.length > 80 ? '…' : ''}"`,
    );

    const [crossRef, openAlex] = await Promise.allSettled([
      this.checkCrossRef(encoded),
      this.checkOpenAlex(encoded),
    ]);

    const crFound = crossRef.status === 'fulfilled' && crossRef.value;
    const oaFound = openAlex.status === 'fulfilled' && openAlex.value;

    this.logger.log(
      `[Layer 3] Result — CrossRef: ${crFound ? '✓' : '✗'}  OpenAlex: ${oaFound ? '✓' : '✗'}`,
    );

    return crFound || oaFound;
  }

  private async checkCrossRef(encodedQuery: string): Promise<boolean> {
    const response = await fetch(
      `https://api.crossref.org/works?query=${encodedQuery}&rows=1&select=DOI`,
      {
        headers: {
          'User-Agent': 'SuperviseAI/1.0 (mailto:support@superviseai.app)',
        },
      },
    );
    if (!response.ok) return false;
    const data = (await response.json()) as { message?: { items?: unknown[] } };
    return (data.message?.items?.length ?? 0) > 0;
  }

  private async checkOpenAlex(encodedQuery: string): Promise<boolean> {
    const url = new URL('https://api.openalex.org/works');
    url.searchParams.set('search', encodedQuery);
    url.searchParams.set('per-page', '1');
    if (this.openAlexApiKey) {
      url.searchParams.set('api_key', this.openAlexApiKey);
    } else {
      url.searchParams.set('mailto', 'support@superviseai.app');
    }

    const response = await fetch(url.toString());
    if (!response.ok) return false;
    const data = (await response.json()) as { results?: unknown[] };
    return (data.results?.length ?? 0) > 0;
  }
}
