import { useState } from 'react';
import { Link } from '../../lib/router';

import { useAuth } from '../../auth/AuthContext';
import { AuthLayoutSplit } from '../../components/auth/AuthLayoutSplit';
import { Button } from '../../components/ui/Button';
import { FormError } from '../../components/ui/FormError';
import { TextField } from '../../components/ui/TextField';

export function ResetPasswordPage(): JSX.Element {
  const { requestPasswordReset } = useAuth();

  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();

  async function onSubmit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(undefined);
    setMessage(undefined);

    if (!email.trim()) {
      setError('Email is required.');
      return;
    }

    setLoading(true);

    try {
      const responseMessage = await requestPasswordReset(email.trim());
      setMessage(responseMessage);
    } catch {
      setError('Unable to process your request right now. Try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthLayoutSplit
      title="Reset password"
      subtitle="Enter your email address to receive a secure reset link."
      panelQuote="Secure access is mandatory for responsible academic and research workflows."
    >
      <form onSubmit={onSubmit} className="auth-form" noValidate>
        <TextField
          label="Email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
        />

        <FormError message={error} />
        {message ? <p className="form-success">{message}</p> : null}

        <Button fullWidth type="submit" disabled={loading}>
          {loading ? 'Sending link...' : 'Send reset link'}
        </Button>

        <div className="auth-links-row one-link">
          <Link to="/login">Back to login</Link>
        </div>
      </form>
    </AuthLayoutSplit>
  );
}
