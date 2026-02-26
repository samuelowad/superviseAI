import { useState } from 'react';
import { Link, useNavigate } from '../../lib/router';

import { useAuth } from '../../auth/AuthContext';
import { roleHomePath } from '../../auth/routes';
import { AuthLayoutSplit } from '../../components/auth/AuthLayoutSplit';
import { Button } from '../../components/ui/Button';
import { FormError } from '../../components/ui/FormError';
import { PasswordField } from '../../components/ui/PasswordField';
import { TextField } from '../../components/ui/TextField';

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function LoginPage(): JSX.Element {
  const navigate = useNavigate();
  const { login } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [formError, setFormError] = useState<string>();
  const [emailError, setEmailError] = useState<string>();
  const [passwordError, setPasswordError] = useState<string>();

  async function onSubmit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    setEmailError(undefined);
    setPasswordError(undefined);
    setFormError(undefined);

    let hasError = false;

    if (!emailPattern.test(email)) {
      setEmailError('Enter a valid email address.');
      hasError = true;
    }

    if (!password) {
      setPasswordError('Password is required.');
      hasError = true;
    }

    if (hasError) {
      return;
    }

    setLoading(true);

    try {
      const user = await login({ email, password });
      navigate(roleHomePath(user.role), { replace: true });
    } catch {
      setFormError('Invalid email or password.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthLayoutSplit
      title="Welcome back"
      subtitle="Sign in to your SuperviseAI account."
      panelQuote="Consistent, structured feedback helps students arrive at defence with confidence."
    >
      <form onSubmit={onSubmit} className="auth-form" noValidate>
        <TextField
          label="Email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          error={emailError}
          required
        />
        <PasswordField
          label="Password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          error={passwordError}
          required
        />

        <FormError message={formError} />

        <Button fullWidth type="submit" disabled={loading}>
          {loading ? 'Logging in...' : 'Login'}
        </Button>

        <div className="auth-links-row">
          <Link to="/reset-password">Forgot password?</Link>
          <Link to="/register">Create account</Link>
        </div>
      </form>
    </AuthLayoutSplit>
  );
}
