import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';

import { UsersService } from '../users/users.service';
import { User, UserRole } from '../users/user.entity';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { AuthUser, JwtPayload } from './auth.types';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
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
    });

    const payload: JwtPayload = {
      sub: created.id,
      email: created.email,
      role: created.role as 'student' | 'professor',
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

    const match = await bcrypt.compare(dto.password, user.passwordHash);
    if (!match) {
      throw new UnauthorizedException('Invalid credentials.');
    }

    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role as 'student' | 'professor',
    };

    return {
      access_token: await this.jwtService.signAsync(payload),
      user: this.toAuthUser(user),
    };
  }

  private toAuthUser(user: User): AuthUser {
    return {
      id: user.id,
      email: user.email,
      full_name: user.fullName,
      role: user.role as 'student' | 'professor',
      created_at: user.createdAt.toISOString(),
    };
  }
}
