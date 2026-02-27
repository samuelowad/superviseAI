import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class AzureSpeechService {
  private readonly logger = new Logger(AzureSpeechService.name);
  private readonly key: string | null;
  private readonly region: string | null;

  constructor() {
    this.key = process.env.AZURE_SPEECH_KEY ?? null;
    this.region = process.env.AZURE_SPEECH_REGION ?? null;
    if (this.key && this.region) {
      this.logger.log('Azure Speech Service initialized.');
    } else {
      this.logger.warn('Azure Speech not configured — voice features will be unavailable.');
    }
  }

  isAvailable(): boolean {
    return Boolean(this.key && this.region);
  }

  async speechToText(audioBuffer: Buffer, contentType = 'audio/wav'): Promise<string | null> {
    if (!this.key || !this.region) return null;

    try {
      const normalizedContentType = this.normalizeSttContentType(contentType);
      const contentTypeAttempts = [normalizedContentType];

      // Azure REST STT can be strict on Content-Type formatting depending on region/runtime.
      if (normalizedContentType.startsWith('audio/webm')) {
        contentTypeAttempts.push('audio/webm');
      }
      if (normalizedContentType.startsWith('audio/ogg')) {
        contentTypeAttempts.push('audio/ogg');
      }

      for (const attemptType of contentTypeAttempts) {
        const transcript = await this.requestTranscript(audioBuffer, attemptType);
        if (transcript) {
          return transcript;
        }
      }

      this.logger.warn(
        `Azure STT returned empty transcript after all attempts (input content-type: ${normalizedContentType}, bytes: ${audioBuffer.length}).`,
      );
      return null;
    } catch (err) {
      this.logger.error('Azure STT request failed', err);
      return null;
    }
  }

  private async requestTranscript(
    audioBuffer: Buffer,
    contentType: string,
  ): Promise<string | null> {
    const url = `https://${this.region}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=en-US&format=simple`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': this.key!,
        'Content-Type': contentType,
      },
      body: audioBuffer,
    });

    if (!response.ok) {
      this.logger.error(
        `Azure STT error: ${response.status} ${response.statusText} (content-type: ${contentType})`,
      );
      return null;
    }

    const data = (await response.json()) as {
      RecognitionStatus?: string;
      DisplayText?: string;
      NBest?: Array<{ Display?: string; Lexical?: string }>;
    };

    if (data.RecognitionStatus !== 'Success') {
      this.logger.warn(
        `Azure STT returned non-success status: ${data.RecognitionStatus ?? 'unknown'} (content-type: ${contentType})`,
      );
      return null;
    }

    if (data.DisplayText?.trim()) {
      return data.DisplayText.trim();
    }

    const fromNBest = data.NBest?.[0]?.Display ?? data.NBest?.[0]?.Lexical ?? null;
    return fromNBest?.trim() || null;
  }

  private normalizeSttContentType(contentType: string): string {
    const normalized = contentType.toLowerCase();
    if (normalized.includes('webm')) {
      return 'audio/webm; codecs=opus';
    }

    if (normalized.includes('ogg')) {
      return 'audio/ogg; codecs=opus';
    }

    if (normalized.includes('wav')) {
      return 'audio/wav; codecs=audio/pcm; samplerate=16000';
    }

    if (normalized.includes('mp3') || normalized.includes('mpeg')) {
      return 'audio/mpeg';
    }

    return contentType;
  }

  async textToSpeech(text: string, voice = 'en-US-JennyNeural'): Promise<Buffer | null> {
    if (!this.key || !this.region) return null;

    try {
      const url = `https://${this.region}.tts.speech.microsoft.com/cognitiveservices/v1`;
      const ssml = `<speak version='1.0' xml:lang='en-US'><voice name='${voice}'>${text.replace(/[<>&'"]/g, ' ').slice(0, 3000)}</voice></speak>`;

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Ocp-Apim-Subscription-Key': this.key,
          'Content-Type': 'application/ssml+xml',
          'X-Microsoft-OutputFormat': 'audio-16khz-128kbitrate-mono-mp3',
        },
        body: ssml,
      });

      if (!response.ok) {
        this.logger.error(`Azure TTS error: ${response.status} ${response.statusText}`);
        return null;
      }

      const arrayBuffer = await response.arrayBuffer();
      return Buffer.from(arrayBuffer);
    } catch (err) {
      this.logger.error('Azure TTS request failed', err);
      return null;
    }
  }
}
