import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react';

import { apiRequest } from '../lib/api';
import { connectRealtime, disconnectRealtime } from '../lib/socket';
import {
  clearAuthStorage,
  getAccessToken,
  getStoredUser,
  setAccessToken,
  setStoredUser,
} from './storage';
import type { AuthUser, UserRole } from './types';

interface LoginPayload {
  email: string;
  password: string;
}

interface RegisterPayload {
  email: string;
  password: string;
  full_name: string;
  role: Extract<UserRole, 'student' | 'professor'>;
}

interface AuthContextValue {
  user: AuthUser | null;
  initializing: boolean;
  login: (payload: LoginPayload) => Promise<AuthUser>;
  register: (payload: RegisterPayload) => Promise<AuthUser>;
  logout: () => void;
  requestPasswordReset: (email: string) => Promise<string>;
  resetPassword: (token: string, newPassword: string) => Promise<string>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: PropsWithChildren): JSX.Element {
  const [user, setUser] = useState<AuthUser | null>(getStoredUser());
  const [initializing, setInitializing] = useState<boolean>(true);

  useEffect(() => {
    let mounted = true;

    const bootstrap = async (): Promise<void> => {
      const token = getAccessToken();
      if (!token) {
        disconnectRealtime();
        if (mounted) {
          setInitializing(false);
        }
        return;
      }

      try {
        const data = await apiRequest<{ user: AuthUser }>('/auth/me');
        if (!mounted) {
          return;
        }

        setUser(data.user);
        setStoredUser(data.user);
        connectRealtime(token);
      } catch {
        disconnectRealtime();
        clearAuthStorage();
        if (mounted) {
          setUser(null);
        }
      } finally {
        if (mounted) {
          setInitializing(false);
        }
      }
    };

    bootstrap();

    return () => {
      mounted = false;
      disconnectRealtime();
    };
  }, []);

  const login = useCallback(async (payload: LoginPayload): Promise<AuthUser> => {
    const data = await apiRequest<{ access_token: string; user: AuthUser }>('/auth/login', {
      method: 'POST',
      body: payload,
    });

    setAccessToken(data.access_token);
    setStoredUser(data.user);
    setUser(data.user);
    connectRealtime(data.access_token);

    return data.user;
  }, []);

  const register = useCallback(async (payload: RegisterPayload): Promise<AuthUser> => {
    const data = await apiRequest<{ access_token: string; user: AuthUser }>('/auth/register', {
      method: 'POST',
      body: payload,
    });

    setAccessToken(data.access_token);
    setStoredUser(data.user);
    setUser(data.user);
    connectRealtime(data.access_token);

    return data.user;
  }, []);

  const logout = useCallback(() => {
    disconnectRealtime();
    clearAuthStorage();
    setUser(null);
  }, []);

  const requestPasswordReset = useCallback(async (email: string): Promise<string> => {
    const data = await apiRequest<{ message: string }>('/auth/request-password-reset', {
      method: 'POST',
      body: { email },
    });
    return data.message;
  }, []);

  const resetPassword = useCallback(async (token: string, newPassword: string): Promise<string> => {
    const data = await apiRequest<{ message: string }>('/auth/reset-password', {
      method: 'POST',
      body: {
        token,
        new_password: newPassword,
      },
    });
    return data.message;
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      initializing,
      login,
      register,
      logout,
      requestPasswordReset,
      resetPassword,
    }),
    [initializing, login, logout, register, requestPasswordReset, resetPassword, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider.');
  }

  return context;
}
