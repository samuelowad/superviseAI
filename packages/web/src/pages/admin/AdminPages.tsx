function Placeholder({ title, description }: { title: string; description: string }): JSX.Element {
  return (
    <section className="placeholder-card">
      <h2>{title}</h2>
      <p>{description}</p>
    </section>
  );
}

export function AdminUsersPage(): JSX.Element {
  return (
    <Placeholder
      title="Admin Users"
      description="Admin governance surface is scaffolded. User moderation tools will be expanded next."
    />
  );
}

export function AdminCohortsPage(): JSX.Element {
  return (
    <Placeholder
      title="Admin Cohorts"
      description="Institution-level cohort controls are intentionally scoped for a later increment."
    />
  );
}

export function AdminSettingsPage(): JSX.Element {
  return (
    <Placeholder
      title="Admin Settings"
      description="Platform-wide settings and controls will be enabled with the governance module rollout."
    />
  );
}
