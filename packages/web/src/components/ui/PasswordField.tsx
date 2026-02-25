import { useState, type InputHTMLAttributes } from 'react';

interface PasswordFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: string;
  error?: string;
}

export function PasswordField({ label, id, error, ...props }: PasswordFieldProps): JSX.Element {
  const [visible, setVisible] = useState(false);
  const inputId = id ?? label.toLowerCase().replace(/\s+/g, '-');

  return (
    <div className="field-wrap">
      <label className="field-label" htmlFor={inputId}>
        {label}
      </label>
      <div className="password-row">
        <input
          id={inputId}
          className={`text-field ${error ? 'is-error' : ''}`}
          type={visible ? 'text' : 'password'}
          {...props}
        />
        <button
          type="button"
          className="password-toggle"
          onClick={() => setVisible((current) => !current)}
          aria-label={visible ? 'Hide password' : 'Show password'}
        >
          {visible ? 'Hide' : 'Show'}
        </button>
      </div>
      {error ? <p className="field-error">{error}</p> : null}
    </div>
  );
}
