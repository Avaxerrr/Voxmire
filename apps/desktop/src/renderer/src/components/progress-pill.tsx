import { type ReactElement } from 'react';
import { CheckCircle2, Clock3, FileText } from 'lucide-react';
import type { JobWithSource } from '@voxmire/contracts';
import { activeStatuses, jobProgressLabel, statusClass } from '../lib/job-status';

export function ProgressPill({ job, solverLabel }: { job: JobWithSource; solverLabel?: string | null }): ReactElement {
  const icon = job.job.status === 'completed' ? <CheckCircle2 size={13} /> : activeStatuses.includes(job.job.status) ? <Clock3 size={13} /> : <FileText size={13} />;

  return <span className={`progress-pill ${statusClass(job.job.status)}`}>{icon}<span>{jobProgressLabel(job.job.status, job.job.progress)}</span></span>;
}
