import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class CopyleaksService {
  private readonly logger = new Logger(CopyleaksService.name);
  private readonly email: string | null;
  private readonly apiKey: string | null;

  constructor() {
    this.email = process.env.COPYLEAKS_EMAIL ?? null;
    this.apiKey = process.env.COPYLEAKS_API_KEY ?? null;
    if (this.email && this.apiKey) {
      this.logger.log('Copyleaks Service initialized.');
    } else {
      this.logger.warn('Copyleaks not configured — plagiarism checks will use heuristic fallback.');
    }
  }

  isAvailable(): boolean {
    return Boolean(this.email && this.apiKey);
  }

  private async getAccessToken(): Promise<string | null> {
    try {
      const response = await fetch('https://id.copyleaks.com/v3/account/login/api', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: this.email, key: this.apiKey }),
      });
      if (!response.ok) return null;
      const data = (await response.json()) as { access_token?: string };
      return data.access_token ?? null;
    } catch {
      return null;
    }
  }

  async startScan(opts: {
    text: string;
    submissionId: string;
    webhookBaseUrl: string;
  }): Promise<{ scanId: string } | null> {
    if (!this.isAvailable()) return null;

    const token = await this.getAccessToken();
    if (!token) {
      this.logger.error('Could not obtain Copyleaks access token.');
      return null;
    }

    // Copyleaks scan ID must be alphanumeric and max 32 chars
    const scanId = opts.submissionId.replace(/-/g, '').slice(0, 32);

    try {
      const webhookUrl = `${opts.webhookBaseUrl}/api/v1/webhooks/copyleaks/{STATUS}/${opts.submissionId}`;
      const response = await fetch(
        `https://api.copyleaks.com/v3/businesses/submit/natural-language/${scanId}`,
        {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            base64: Buffer.from(opts.text.slice(0, 50000)).toString('base64'),
            filename: `submission-${opts.submissionId}.txt`,
            webhooks: {
              status: webhookUrl,
            },
            properties: {
              sandbox: process.env.NODE_ENV !== 'production',
            },
          }),
        },
      );

      if (response.status === 201 || response.ok) {
        this.logger.log(`Copyleaks scan started: ${scanId}`);
        return { scanId };
      }

      this.logger.error(`Copyleaks startScan failed: ${response.status}`);
      return null;
    } catch (err) {
      this.logger.error('Copyleaks startScan request failed', err);
      return null;
    }
  }

  parseWebhookResult(payload: Record<string, unknown>): {
    similarityPercent: number;
    riskLevel: 'green' | 'yellow' | 'red';
    flaggedSections: string[];
  } | null {
    try {
      const results = payload.results as Record<string, unknown> | undefined;
      const identical = (results?.identical as number | undefined) ?? 0;
      const similar = (results?.similar as number | undefined) ?? 0;
      const similarityPercent = Math.min(100, Math.round((identical + similar) * 100));

      const riskLevel: 'green' | 'yellow' | 'red' =
        similarityPercent < 20 ? 'green' : similarityPercent < 40 ? 'yellow' : 'red';

      const internet = (results?.internet as Array<{ url?: string }> | undefined) ?? [];
      const flaggedSections = internet.slice(0, 5).map((r) => r.url ?? 'External source match');

      return { similarityPercent, riskLevel, flaggedSections };
    } catch {
      return null;
    }
  }
}
