import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { randomBytes, createHash } from 'crypto';
import { IsNull, Repository } from 'typeorm';

import { MailService } from '../mail/mail.service';
import { UsersService } from '../users/users.service';
import { User, UserRole } from '../users/user.entity';
import { LoginDto } from './dto/login.dto';
import { RequestPasswordResetDto } from './dto/request-password-reset.dto';
import { RegisterDto } from './dto/register.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { PasswordReset } from './entities/password-reset.entity';
import { AuthUser, JwtPayload } from './auth.types';

@Injectable()
export class AuthService {
  private readonly resetMessage =
    "If an account exists for this email, you'll receive a reset link.";

  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly mailService: MailService,
    @InjectRepository(PasswordReset)
    private readonly passwordResetRepository: Repository<PasswordReset>,
  ) {}

  async register(dto: RegisterDto): Promise<{ access_token: string; user: AuthUser }> {
    const existing = await this.usersService.findByEmail(dto.email);
    if (existing) {
      throw new BadRequestException('Email is already registered.');
    }

    const passwordHash = await bcrypt.hash(dto.password, 10);
    const created = await this.usersService.create({
      email: dto.email,
      passwordHash,
      fullName: dto.full_name,
      role: dto.role === 'student' ? UserRole.STUDENT : UserRole.PROFESSOR,
      isActive: true,
      isVerified: dto.role === 'student',
    });

    const payload: JwtPayload = {
      sub: created.id,
      email: created.email,
      role: created.role as 'student' | 'professor' | 'admin',
    };

    return {
      access_token: await this.jwtService.signAsync(payload),
      user: this.toAuthUser(created),
    };
  }

  async login(dto: LoginDto): Promise<{ access_token: string; user: AuthUser }> {
    const user = await this.usersService.findByEmail(dto.email, true);
    if (!user?.passwordHash) {
      throw new UnauthorizedException('Invalid credentials.');
    }

    if (!user.isActive) {
      throw new UnauthorizedException('Account is deactivated.');
    }

    const match = await bcrypt.compare(dto.password, user.passwordHash);
    if (!match) {
      throw new UnauthorizedException('Invalid credentials.');
    }

    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role as 'student' | 'professor' | 'admin',
    };

    return {
      access_token: await this.jwtService.signAsync(payload),
      user: this.toAuthUser(user),
    };
  }

  async requestPasswordReset(dto: RequestPasswordResetDto): Promise<{ message: string }> {
    const user = await this.usersService.findByEmail(dto.email);
    if (!user || !user.isActive) {
      return { message: this.resetMessage };
    }

    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = this.hashResetToken(rawToken);
    const expiresAt = new Date(Date.now() + this.getResetTtlMs());

    const passwordReset = this.passwordResetRepository.create({
      userId: user.id,
      tokenHash,
      expiresAt,
      usedAt: null,
    });
    await this.passwordResetRepository.save(passwordReset);

    const frontendBase = process.env.FRONTEND_URL ?? 'http://localhost:5173';
    const resetLink = `${frontendBase}/change-password?token=${rawToken}`;
    await this.mailService.sendPasswordResetEmail(user.email, resetLink);

    return { message: this.resetMessage };
  }

  async resetPassword(dto: ResetPasswordDto): Promise<{ message: string }> {
    const tokenHash = this.hashResetToken(dto.token);
    const now = new Date();

    const tokenRecord = await this.passwordResetRepository.findOne({
      where: { tokenHash, usedAt: IsNull() },
    });

    if (!tokenRecord || tokenRecord.expiresAt.getTime() <= now.getTime()) {
      throw new BadRequestException('Invalid or expired reset token.');
    }

    const newPasswordHash = await bcrypt.hash(dto.new_password, 10);
    await this.usersService.updatePasswordHash(tokenRecord.userId, newPasswordHash);

    tokenRecord.usedAt = new Date();
    await this.passwordResetRepository.save(tokenRecord);

    return { message: 'Password changed successfully.' };
  }

  async me(userId: string): Promise<{ user: AuthUser }> {
    const user = await this.usersService.findById(userId);
    if (!user) {
      throw new UnauthorizedException('User not found.');
    }

    return { user: this.toAuthUser(user) };
  }

  private toAuthUser(user: User): AuthUser {
    return {
      id: user.id,
      email: user.email,
      full_name: user.fullName,
      role: user.role as 'student' | 'professor' | 'admin',
      is_active: user.isActive,
      is_verified: user.isVerified,
      created_at: user.createdAt.toISOString(),
    };
  }

  private hashResetToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private getResetTtlMs(): number {
    const minutes = Number(process.env.RESET_TOKEN_TTL_MINUTES ?? 30);
    return minutes * 60 * 1000;
  }
}
