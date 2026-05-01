import { type ReactElement, useMemo } from 'react';
import { Search, X } from 'lucide-react';
import type { JobWithSource } from '@voxmire/contracts';
import { EmptyState } from '../../components/empty-state';
import { ProgressPill } from '../../components/progress-pill';
import { ProjectActionsMenu } from '../../components/project-actions-menu';
import { solverLabelForJob, type SolverLabelsByJobId } from '../../lib/engines';
import { formatDate, formatDuration } from '../../lib/format';
import { activeStatuses } from '../../lib/job-status';

type TranscriptSwitcherDrawerProps = {
  jobs: JobWithSource[];
  onClose: () => void;
  onDeleteProject: (project: JobWithSource) => void;
  onDetailsProject: (jobId: string) => void;
  onRenameProject: (project: JobWithSource) => void;
  onSelectJob: (jobId: string) => void;
  query: string;
  selectedJobId: string | null;
  setQuery: (query: string) => void;
  solverLabelsByJobId: SolverLabelsByJobId;
};

export function TranscriptSwitcherDrawer({
  jobs,
  onClose,
  onDeleteProject,
  onDetailsProject,
  onRenameProject,
  onSelectJob,
  query,
  selectedJobId,
  setQuery,
  solverLabelsByJobId
}: TranscriptSwitcherDrawerProps): ReactElement {
  const visibleJobs = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    if (!normalizedQuery) {
      return jobs;
    }

    return jobs.filter((entry) => entry.sourceFile.name.toLowerCase().includes(normalizedQuery));
  }, [jobs, query]);

  return (
    <div className="transcript-switcher-layer" onClick={onClose} role="presentation">
      <aside className="transcript-switcher-drawer" aria-label="Transcript switcher" onClick={(event) => event.stopPropagation()}>
        <div className="switcher-heading">
          <div>
            <p className="eyebrow">Switch transcript</p>
            <h3>Transcript projects</h3>
          </div>
          <button className="icon-button" onClick={onClose} title="Close transcript switcher" type="button">
            <X size={15} />
          </button>
        </div>

        <label className="search-field switcher-search">
          <Search size={15} />
          <input
            aria-label="Find transcript"
            name="transcriptSwitcherSearch"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Find transcript"
            type="search"
            value={query}
          />
        </label>

        <div className="transcript-switcher-list">
          {jobs.length === 0 ? (
            <EmptyState title="No transcripts yet" body="Import a recording to create your first transcript." />
          ) : visibleJobs.length === 0 ? (
            <EmptyState title="No matches" body="Try a different transcript name." />
          ) : (
            visibleJobs.map((entry) => {
              const isSelected = entry.job.id === selectedJobId;
              const isLive = activeStatuses.includes(entry.job.status);
              const showStatus = entry.job.status !== 'completed';

              return (
                <div
                  className={`transcript-switcher-row ${isSelected ? 'selected' : ''} ${isLive ? 'live' : ''}`}
                  key={entry.job.id}
                >
                  <button
                    className="transcript-switcher-open"
                    onClick={() => {
                      onSelectJob(entry.job.id);
                      onClose();
                    }}
                    type="button"
                  >
                    <span className="project-main">
                      <strong>{entry.sourceFile.name}</strong>
                      <small>{formatDuration(entry.sourceFile.durationSeconds)} / {formatDate(entry.job.createdAt)}</small>
                    </span>
                    {showStatus ? <ProgressPill job={entry} solverLabel={solverLabelForJob(entry, solverLabelsByJobId[entry.job.id])} /> : null}
                  </button>
                  <ProjectActionsMenu
                    onDelete={() => {
                      onClose();
                      onDeleteProject(entry);
                    }}
                    onDetails={() => {
                      onClose();
                      onDetailsProject(entry.job.id);
                    }}
                    onRename={() => {
                      onClose();
                      onRenameProject(entry);
                    }}
                    renderInPortal
                  />
                </div>
              );
            })
          )}
        </div>
      </aside>
    </div>
  );
}
