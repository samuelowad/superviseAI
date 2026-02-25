import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'roles';
export const Roles = (...roles: Array<'student' | 'professor'>): ReturnType<typeof SetMetadata> =>
  SetMetadata(ROLES_KEY, roles);
