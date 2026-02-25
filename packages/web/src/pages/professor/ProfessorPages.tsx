function Placeholder({ title, description }: { title: string; description: string }): JSX.Element {
  return (
    <section className="placeholder-card">
      <h2>{title}</h2>
      <p>{description}</p>
    </section>
  );
}

export function ProfessorDashboardPage(): JSX.Element {
  return (
    <Placeholder
      title="Professor Dashboard"
      description="Phase 1 shell is complete. Student analytics and cohort insights land in the next phase."
    />
  );
}

export function ProfessorStudentsPage(): JSX.Element {
  return (
    <Placeholder
      title="Students"
      description="Student detail and progress risk cards are planned after auth/shell milestone."
    />
  );
}

export function ProfessorMilestonesPage(): JSX.Element {
  return (
    <Placeholder
      title="Milestones"
      description="Milestone planning and deadline controls are scheduled for later phases."
    />
  );
}

export function ProfessorAnalyticsPage(): JSX.Element {
  return (
    <Placeholder
      title="Analytics"
      description="Data visualizations and trend tracking will be implemented after core submission pipeline."
    />
  );
}
