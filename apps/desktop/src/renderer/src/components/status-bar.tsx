import { type ReactElement } from 'react';
import type { JobWithSource } from '@voxmire/contracts';
import { statusLabel } from '../lib/job-status';

type AppInfo = {
  name: string;
  version: string;
  platform: string;
  arch: string;
};

type StatusTone = 'ready' | 'active' | 'warning' | 'error';

type StatusBarProps = {
  activeJob: JobWithSource | null;
  appInfo: AppInfo | null;
  status: {
    tone: StatusTone;
    text: string;
  };
};

export function StatusBar({ activeJob, appInfo, status }: StatusBarProps): ReactElement {
  const isLive = activeJob !== null;

  return (
    <footer className={`status-bar ${isLive ? 'live' : ''}`}>
      <span className={`status-light ${status.tone}`} />
      <strong>{status.text}</strong>
      {activeJob ? <span>{statusLabel(activeJob.job.status)}</span> : null}
      <span className="status-spacer" />
      <span>Local workspace</span>
      {appInfo ? <span>{appInfo.platform}</span> : null}
    </footer>
  );
}
