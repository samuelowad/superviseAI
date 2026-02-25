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
const passwordHasNumber = /\d/;

export function RegisterPage(): JSX.Element {
  const navigate = useNavigate();
  const { register } = useAuth();

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'student' | 'professor'>('student');
  const [loading, setLoading] = useState(false);
  const [formError, setFormError] = useState<string>();

  async function onSubmit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setFormError(undefined);

    if (fullName.trim().length < 2) {
      setFormError('Full name is required.');
      return;
    }

    if (!emailPattern.test(email)) {
      setFormError('Please enter a valid email address.');
      return;
    }

    if (password.length < 8 || !passwordHasNumber.test(password)) {
      setFormError('Password must be at least 8 characters and include one number.');
      return;
    }

    setLoading(true);

    try {
      const user = await register({
        email,
        password,
        full_name: fullName.trim(),
        role,
      });
      navigate(roleHomePath(user.role), { replace: true });
    } catch (error: unknown) {
      setFormError(
        error instanceof Error ? error.message : 'Unable to create account with these details.',
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthLayoutSplit
      title="Create your account"
      subtitle="Start tracking thesis progress with structured AI supervision workflows."
      panelQuote="High-quality supervision starts with clear milestones, consistent review, and fast iteration."
    >
      <form onSubmit={onSubmit} className="auth-form" noValidate>
        <TextField
          label="Full name"
          value={fullName}
          autoComplete="name"
          onChange={(event) => setFullName(event.target.value)}
          required
        />
        <TextField
          label="Email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
        />
        <PasswordField
          label="Password"
          autoComplete="new-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
        />

        <div className="field-wrap">
          <label className="field-label" htmlFor="role">
            Role
          </label>
          <select
            id="role"
            className="text-field"
            value={role}
            onChange={(event) => setRole(event.target.value as 'student' | 'professor')}
          >
            <option value="student">Student</option>
            <option value="professor">Professor</option>
          </select>
        </div>

        <FormError message={formError} />

        <Button fullWidth type="submit" disabled={loading}>
          {loading ? 'Creating account...' : 'Create account'}
        </Button>

        <div className="auth-links-row one-link">
          <span>Already have an account?</span>
          <Link to="/login">Login</Link>
        </div>
      </form>
    </AuthLayoutSplit>
  );
}
