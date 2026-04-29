import { type ReactElement } from 'react';
import { AlertTriangle, Pause, Play, Square } from 'lucide-react';
import type { JobWithSource } from '@voxmire/contracts';
import { activeStatuses, statusLabel } from '../../lib/job-status';

type TranscriptJobStatusProps = {
  job: JobWithSource;
  onCancel: (jobId: string) => Promise<void>;
  onPause: (jobId: string) => Promise<void>;
  onResume: (jobId: string) => Promise<void>;
  progress: number;
  solverLabel: string | null;
};

export function TranscriptJobStatus({ job, onCancel, onPause, onResume, progress, solverLabel }: TranscriptJobStatusProps): ReactElement {
  const isCancelable = activeStatuses.includes(job.job.status) || job.job.status === 'paused';
  const isPausable = activeStatuses.includes(job.job.status);
  const isResumable = job.job.status === 'paused';
  const isWorking = activeStatuses.includes(job.job.status);
  const showJobProgressRow = isWorking || isResumable;

  return (
    <>
      {showJobProgressRow ? (
        <div className="job-progress-row">
          <div className="job-progress-stack">
            <div className="job-progress-meta">
              <span>{statusLabel(job.job.status)} / {progress}%</span>
              {solverLabel ? <strong>{solverLabel}</strong> : null}
            </div>
            <div className={`progress-track ${isWorking ? 'working' : ''}`} aria-label="Progress">
              <div style={{ width: `${progress}%` }} />
            </div>
          </div>
          <div className="job-inline-actions" aria-label="Transcription controls">
            {isPausable ? (
              <button className="secondary-action" onClick={() => void onPause(job.job.id)} type="button">
                <Pause size={14} />
                Pause
              </button>
            ) : null}
            {isResumable ? (
              <button className="secondary-action" onClick={() => void onResume(job.job.id)} type="button">
                <Play size={14} />
                Resume
              </button>
            ) : null}
            {isCancelable ? (
              <button className="secondary-action danger" onClick={() => void onCancel(job.job.id)} type="button">
                <Square size={14} />
                Stop
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
      {job.job.errorMessage ? <div className="error-text"><AlertTriangle size={16} /> {job.job.errorMessage}</div> : null}
    </>
  );
}
