import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  async sendPasswordResetEmail(email: string, resetLink: string): Promise<void> {
    // Hackathon-safe mocked mail transport.
    this.logger.log(`Password reset link for ${email}: ${resetLink}`);
  }
}
