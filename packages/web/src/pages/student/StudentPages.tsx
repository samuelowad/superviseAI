function Placeholder({ title, description }: { title: string; description: string }): JSX.Element {
  return (
    <section className="placeholder-card">
      <h2>{title}</h2>
      <p>{description}</p>
    </section>
  );
}

export function StudentHomePage(): JSX.Element {
  return (
    <Placeholder
      title="Student Home"
      description="Phase 1 shell is active. Phase 2 will add live submission metrics and analysis cards."
    />
  );
}

export function StudentUploadPage(): JSX.Element {
  return (
    <Placeholder
      title="Upload Draft"
      description="Upload flow arrives in Phase 2. Navigation and shell are production-ready now."
    />
  );
}

export function StudentHistoryPage(): JSX.Element {
  return (
    <Placeholder
      title="Submission History"
      description="Version timeline and diff views are queued for the next phase."
    />
  );
}

export function StudentCoachPage(): JSX.Element {
  return (
    <Placeholder
      title="Mock Viva Coach"
      description="Argument defender and viva session UI are planned for Phase 2."
    />
  );
}
