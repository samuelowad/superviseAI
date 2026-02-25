import type { UserRole } from './types';

export function roleHomePath(role: UserRole): string {
  if (role === 'professor') {
    return '/professor';
  }

  if (role === 'admin') {
    return '/admin';
  }

  return '/student';
}
