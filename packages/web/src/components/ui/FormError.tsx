export function FormError({ message }: { message?: string }): JSX.Element | null {
  if (!message) {
    return null;
  }

  return <p className="form-error">{message}</p>;
}
