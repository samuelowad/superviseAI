import type { ButtonHTMLAttributes, PropsWithChildren } from 'react';

type ButtonVariant = 'primary' | 'ghost' | 'muted';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  fullWidth?: boolean;
}

export function Button({
  variant = 'primary',
  fullWidth = false,
  className,
  children,
  ...props
}: PropsWithChildren<ButtonProps>): JSX.Element {
  return (
    <button
      type="button"
      className={['btn', `btn-${variant}`, fullWidth ? 'btn-full' : '', className ?? ''].join(' ')}
      {...props}
    >
      {children}
    </button>
  );
}
