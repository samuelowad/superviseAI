import { useState } from 'react';
import { Link, useSearchParams } from '../../lib/router';

import { useAuth } from '../../auth/AuthContext';
import { AuthLayoutSplit } from '../../components/auth/AuthLayoutSplit';
import { Button } from '../../components/ui/Button';
import { FormError } from '../../components/ui/FormError';
import { PasswordField } from '../../components/ui/PasswordField';

const passwordHasNumber = /\d/;

export function ChangePasswordPage(): JSX.Element {
  const [params] = useSearchParams();
  const { resetPassword } = useAuth();

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();

  const token = params.get('token') ?? '';

  async function onSubmit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(undefined);
    setMessage(undefined);

    if (!token) {
      setError('Reset token is missing or invalid. Request another reset link.');
      return;
    }

    if (newPassword.length < 8 || !passwordHasNumber.test(newPassword)) {
      setError('Password must be at least 8 characters and include one number.');
      return;
    }

    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);

    try {
      const responseMessage = await resetPassword(token, newPassword);
      setMessage(responseMessage);
      setNewPassword('');
      setConfirmPassword('');
    } catch {
      setError('Token is invalid or expired. Request another reset link.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthLayoutSplit
      title="Change password"
      subtitle="Create a new secure password for your SuperviseAI account."
      panelQuote="Credential hygiene protects both research data and supervision integrity."
    >
      <form onSubmit={onSubmit} className="auth-form" noValidate>
        <PasswordField
          label="New password"
          autoComplete="new-password"
          value={newPassword}
          onChange={(event) => setNewPassword(event.target.value)}
          required
        />
        <PasswordField
          label="Confirm password"
          autoComplete="new-password"
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
          required
        />

        <FormError message={error} />
        {message ? <p className="form-success">{message}</p> : null}

        <Button fullWidth type="submit" disabled={loading}>
          {loading ? 'Changing password...' : 'Change password'}
        </Button>

        <div className="auth-links-row one-link">
          <Link to="/login">Back to login</Link>
        </div>
      </form>
    </AuthLayoutSplit>
  );
}
