export type UserRole = 'student' | 'professor' | 'admin';

export interface User {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  isActive: boolean;
  isVerified: boolean;
  createdAt: string;
}

export type SubmissionStatus = 'processing' | 'complete' | 'failed';

export interface Submission {
  id: string;
  studentId: string;
  status: SubmissionStatus;
  fileKey: string;
  extractedText?: string;
  createdAt: string;
}

export interface ThesisAnalysis {
  id: string;
  submissionId: string;
  progressScore: number;
  directionAligned: boolean;
  gapReport: string[];
  nextSteps: string[];
  createdAt: string;
}

export interface CitationIssue {
  type: 'missing_reference' | 'unused_reference' | 'format_error' | 'unverifiable_source';
  message: string;
}

export interface CitationReport {
  id: string;
  submissionId: string;
  issues: CitationIssue[];
  createdAt: string;
}

export interface PlagiarismMatch {
  source: string;
  similarityPercent: number;
  excerpt: string;
}

export interface PlagiarismReport {
  id: string;
  submissionId: string;
  originalityScore: number;
  matches: PlagiarismMatch[];
  createdAt: string;
}

export type CoachingMode = 'argument_defender' | 'socratic' | 'mock_viva';

export interface CoachingSession {
  id: string;
  submissionId: string;
  mode: CoachingMode;
  readinessScore?: number;
  createdAt: string;
}

export interface Milestone {
  id: string;
  title: string;
  dueDate: string;
  cohortId?: string;
}
