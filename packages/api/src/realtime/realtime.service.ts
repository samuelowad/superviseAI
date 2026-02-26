import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { Server as HttpServer } from 'http';
import { Server, type Socket } from 'socket.io';

import type { JwtPayload } from '../auth/auth.types';

interface SocketUserData {
  userId?: string;
  role?: 'student' | 'professor' | 'admin';
}

@Injectable()
export class RealtimeService implements OnModuleDestroy {
  private readonly logger = new Logger(RealtimeService.name);
  private io: Server | null = null;

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  initialize(httpServer: HttpServer): void {
    if (this.io) {
      return;
    }

    const origin = this.configService
      .get<string>('CORS_ORIGIN', 'http://localhost:5173')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean) ?? ['http://localhost:5173'];

    this.io = new Server(httpServer, {
      cors: {
        origin,
        credentials: true,
      },
    });

    this.io.use(async (socket: Socket, next) => {
      try {
        const token = this.extractToken(socket);
        if (!token) {
          next(new Error('Unauthorized'));
          return;
        }

        const payload = await this.jwtService.verifyAsync<JwtPayload>(token, {
          secret: this.configService.get<string>('JWT_SECRET', 'dev_secret'),
        });

        const data = socket.data as SocketUserData;
        data.userId = payload.sub;
        data.role = payload.role;
        next();
      } catch {
        next(new Error('Unauthorized'));
      }
    });

    this.io.on('connection', (socket: Socket) => {
      const data = socket.data as SocketUserData;
      if (!data.userId) {
        socket.disconnect(true);
        return;
      }

      socket.join(this.userRoom(data.userId));
      if (data.role === 'professor') {
        socket.join(this.professorRoom(data.userId));
      }
    });

    this.logger.log('Realtime Socket.IO server initialized.');
  }

  emitToUser(userId: string, event: string, payload: Record<string, unknown>): void {
    this.io?.to(this.userRoom(userId)).emit(event, payload);
  }

  emitToProfessor(professorId: string, event: string, payload: Record<string, unknown>): void {
    this.io?.to(this.professorRoom(professorId)).emit(event, payload);
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.io) {
      return;
    }

    await this.io.close();
    this.io = null;
  }

  private extractToken(socket: Socket): string | null {
    const fromAuth = socket.handshake.auth?.token;
    if (typeof fromAuth === 'string' && fromAuth.length > 0) {
      return fromAuth;
    }

    const headerValue = socket.handshake.headers.authorization;
    if (typeof headerValue === 'string' && headerValue.startsWith('Bearer ')) {
      return headerValue.slice(7).trim();
    }

    return null;
  }

  private userRoom(userId: string): string {
    return `user:${userId}`;
  }

  private professorRoom(professorId: string): string {
    return `professor:${professorId}`;
  }
}
