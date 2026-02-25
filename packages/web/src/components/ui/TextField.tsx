import type { InputHTMLAttributes } from 'react';

interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
}

export function TextField({ label, id, error, ...props }: TextFieldProps): JSX.Element {
  const inputId = id ?? label.toLowerCase().replace(/\s+/g, '-');

  return (
    <div className="field-wrap">
      <label className="field-label" htmlFor={inputId}>
        {label}
      </label>
      <input id={inputId} className={`text-field ${error ? 'is-error' : ''}`} {...props} />
      {error ? <p className="field-error">{error}</p> : null}
    </div>
  );
}
