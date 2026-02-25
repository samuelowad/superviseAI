import type { UserRole } from '@supervise-ai/shared';

const roles: UserRole[] = ['student', 'professor'];

export default function App(): JSX.Element {
  return (
    <main className="container">
      <h1>SuperviseAI Monorepo Bootstrapped</h1>
      <p>Phase 0 scaffold ready. API and web packages are connected through shared types.</p>
      <p>Supported roles: {roles.join(', ')}</p>
    </main>
  );
}
