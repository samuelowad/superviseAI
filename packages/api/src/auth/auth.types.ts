export interface JwtPayload {
  sub: string;
  email: string;
  role: 'student' | 'professor';
}

export interface AuthUser {
  id: string;
  email: string;
  full_name: string;
  role: 'student' | 'professor';
  created_at: string;
}
