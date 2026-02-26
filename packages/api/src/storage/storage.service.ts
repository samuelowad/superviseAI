import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable } from '@nestjs/common';

@Injectable()
export class StorageService {
  /** Used for server-side operations (upload, delete) via the internal Docker network. */
  private readonly client: S3Client;
  /**
   * Used exclusively for generating presigned URLs.
   * Configured with the PUBLIC endpoint so the signature is valid when the
   * browser (or any external client) resolves the URL — AWS Signature v4
   * includes the Host header, so signing with the internal hostname and then
   * rewriting it causes a SignatureDoesNotMatch error.
   */
  private readonly presignClient: S3Client;
  private readonly bucket: string;

  constructor() {
    const internalHost = process.env.MINIO_ENDPOINT ?? 'localhost';
    const internalPort = process.env.MINIO_PORT ?? '9000';
    const internalSsl = process.env.MINIO_USE_SSL === 'true';

    this.client = new S3Client({
      region: 'us-east-1',
      endpoint: `${internalSsl ? 'https' : 'http'}://${internalHost}:${internalPort}`,
      forcePathStyle: true,
      credentials: {
        accessKeyId: process.env.MINIO_ACCESS_KEY ?? 'minioadmin',
        secretAccessKey: process.env.MINIO_SECRET_KEY ?? 'minioadmin',
      },
    });

    const publicHost = process.env.MINIO_PUBLIC_ENDPOINT ?? internalHost;
    const publicPort = process.env.MINIO_PUBLIC_PORT ?? internalPort;
    const publicSsl = process.env.MINIO_PUBLIC_USE_SSL === 'true';

    this.presignClient = new S3Client({
      region: 'us-east-1',
      endpoint: `${publicSsl ? 'https' : 'http'}://${publicHost}:${publicPort}`,
      forcePathStyle: true,
      credentials: {
        accessKeyId: process.env.MINIO_ACCESS_KEY ?? 'minioadmin',
        secretAccessKey: process.env.MINIO_SECRET_KEY ?? 'minioadmin',
      },
    });

    this.bucket = process.env.MINIO_BUCKET ?? 'theses';
  }

  async uploadFile(buffer: Buffer, key: string, mimetype: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: buffer,
        ContentType: mimetype,
      }),
    );
  }

  async getSignedUrl(key: string, expiresInSeconds = 900): Promise<string> {
    return getSignedUrl(
      this.presignClient,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ResponseContentDisposition: 'inline',
      }),
      { expiresIn: expiresInSeconds },
    );
  }

  async getFileBuffer(key: string): Promise<{ buffer: Buffer; contentType: string }> {
    const response = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
      }),
    );

    const body = response.Body;
    if (!body) {
      throw new Error('Empty response body from storage.');
    }

    const chunks: Uint8Array[] = [];
    for await (const chunk of body as AsyncIterable<Uint8Array>) {
      chunks.push(chunk);
    }

    return {
      buffer: Buffer.concat(chunks),
      contentType: response.ContentType ?? 'application/octet-stream',
    };
  }

  async deleteFile(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: key,
      }),
    );
  }
}
