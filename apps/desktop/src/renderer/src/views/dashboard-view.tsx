import { type ReactElement, useEffect, useMemo, useState } from 'react';
import { FileAudio, FileVideo, Info, MicVocal, Pencil, Trash2, UploadCloud } from 'lucide-react';
import type { JobWithSource } from '@voxmire/contracts';
import { EmptyState } from '../components/empty-state';
import { ProgressPill } from '../components/progress-pill';
import { SearchField } from '../components/search-field';
import { solverLabelForJob, type SolverLabelsByJobId } from '../lib/engines';
import { formatDate, formatDuration } from '../lib/format';
import { activeStatuses } from '../lib/job-status';
import { mediaKindFromExtension } from '../lib/media-kind';

type ProjectInlineActionsProps = {
  onDelete: () => void;
  onDetails: () => void;
  onRename: () => void;
};

const skeletonRows = [0, 1, 2, 3];

function projectMatchesSearch(entry: JobWithSource, query: string): boolean {
  const terms = query.split(/\s+/).filter(Boolean);
  const searchText = [
    entry.sourceFile.name,
    entry.sourceFile.path,
    entry.sourceFile.extension,
    entry.job.status,
    entry.job.modelId,
    entry.job.engineBackend,
    entry.job.createdAt
  ].join(' ').toLowerCase();

  return terms.every((term) => searchText.includes(term));
}

function ProjectInlineActions({ onDelete, onDetails, onRename }: ProjectInlineActionsProps): ReactElement {
  return (
    <div className="project-inline-actions" aria-label="Project actions">
      <button aria-label="Project details" className="icon-button" onClick={onDetails} title="Details" type="button">
        <Info size={15} />
      </button>
      <button aria-label="Rename project" className="icon-button" onClick={onRename} title="Rename" type="button">
        <Pencil size={15} />
      </button>
      <button aria-label="Delete project" className="icon-button danger-icon-button" onClick={onDelete} title="Delete project" type="button">
        <Trash2 size={15} />
      </button>
    </div>
  );
}

function ProjectSkeletonList(): ReactElement {
  return (
    <div className="project-list project-skeleton-list" aria-busy="true" aria-label="Loading transcript projects">
      {skeletonRows.map((row) => (
        <div className="project-row project-row-skeleton" key={row}>
          <span className="project-icon skeleton-block" />
          <span className="project-main">
            <span className="skeleton-line skeleton-title" />
            <span className="skeleton-line skeleton-meta" />
          </span>
          <span className="skeleton-action skeleton-block" />
          <span className="skeleton-action skeleton-block" />
          <span className="skeleton-action skeleton-block" />
        </div>
      ))}
    </div>
  );
}

type DashboardViewProps = {
  jobs: JobWithSource[];
  onDeleteProject: (project: JobWithSource) => void;
  onDeleteProjects: (projects: JobWithSource[]) => void;
  onDetailsProject: (jobId: string) => void;
  onImport: () => void;
  onOpenJob: (jobId: string) => void;
  onOpenVoice: () => void;
  onRenameProject: (project: JobWithSource) => void;
  setupLabel: string;
  setupLoading: boolean;
  solverLabelsByJobId: SolverLabelsByJobId;
  workspaceLoading: boolean;
};

export function DashboardView({
  jobs,
  onDeleteProject,
  onDeleteProjects,
  onDetailsProject,
  onImport,
  onOpenJob,
  onOpenVoice,
  onRenameProject,
  setupLabel,
  setupLoading,
  solverLabelsByJobId,
  workspaceLoading
}: DashboardViewProps): ReactElement {
  const [projectSearchQuery, setProjectSearchQuery] = useState('');
  const [selectedProjectIds, setSelectedProjectIds] = useState<string[]>([]);
  const normalizedProjectSearchQuery = projectSearchQuery.trim().toLowerCase();
  const visibleJobs = useMemo(
    () =>
      normalizedProjectSearchQuery
        ? jobs.filter((entry) => projectMatchesSearch(entry, normalizedProjectSearchQuery))
        : jobs,
    [jobs, normalizedProjectSearchQuery]
  );
  const hasProjectSearchQuery = normalizedProjectSearchQuery.length > 0;
  const selectedProjectIdSet = useMemo(() => new Set(selectedProjectIds), [selectedProjectIds]);
  const selectedProjects = useMemo(
    () => jobs.filter((entry) => selectedProjectIdSet.has(entry.job.id)),
    [jobs, selectedProjectIdSet]
  );
  const visibleProjectIds = useMemo(() => visibleJobs.map((entry) => entry.job.id), [visibleJobs]);
  const allVisibleProjectsSelected = visibleProjectIds.length > 0 && visibleProjectIds.every((jobId) => selectedProjectIdSet.has(jobId));
  const selectedProjectCount = selectedProjects.length;

  useEffect(() => {
    const jobIds = new Set(jobs.map((entry) => entry.job.id));
    setSelectedProjectIds((current) => current.filter((jobId) => jobIds.has(jobId)));
  }, [jobs]);

  function toggleProjectSelection(jobId: string): void {
    setSelectedProjectIds((current) =>
      current.includes(jobId) ? current.filter((selectedJobId) => selectedJobId !== jobId) : [...current, jobId]
    );
  }

  function toggleVisibleProjects(): void {
    setSelectedProjectIds((current) => {
      const nextSelectedIds = new Set(current);
      if (visibleProjectIds.every((jobId) => nextSelectedIds.has(jobId))) {
        visibleProjectIds.forEach((jobId) => nextSelectedIds.delete(jobId));
      } else {
        visibleProjectIds.forEach((jobId) => nextSelectedIds.add(jobId));
      }

      return Array.from(nextSelectedIds);
    });
  }

  function clearProjectSelection(): void {
    setSelectedProjectIds([]);
  }

  function deleteSelectedProjects(): void {
    if (selectedProjects.length > 0) {
      onDeleteProjects(selectedProjects);
    }
  }

  return (
    <div className="view workspace-page dashboard-view">
      <header className="page-header dashboard-header">
        <div>
          <p className="eyebrow">Library</p>
          <h2>Transcript projects</h2>
        </div>
      </header>

      <div className="dashboard-scroll">
        <section className="quick-actions" aria-label="Quick actions">
          <button aria-busy={setupLoading} className={`action-tile transcribe-tile ${setupLoading ? 'loading' : ''}`} disabled={setupLoading} onClick={onImport} type="button">
            <span className="tile-icon"><UploadCloud size={24} /></span>
            <span className="tile-copy">
              <strong>Transcribe Audio</strong>
              <p>Create a private transcript from an audio or video file.</p>
              <small>{setupLabel}</small>
            </span>
          </button>

          <button className="action-tile voice-tile" onClick={onOpenVoice} type="button">
            <span className="tile-icon"><MicVocal size={24} /></span>
            <span className="tile-copy">
              <strong>Voice Generation</strong>
              <p>Draft speech from text. This workspace is designed, but not connected yet.</p>
              <small>Coming soon</small>
            </span>
          </button>
        </section>

        <section className="library-section">
          <div className="library-toolbar">
            <div>
              <p className="eyebrow">Projects</p>
              <h3>All transcripts</h3>
            </div>
            <div className="library-controls">
              <SearchField
                ariaLabel="Search projects"
                name="projectSearch"
                onChange={setProjectSearchQuery}
                placeholder="Search projects"
                value={projectSearchQuery}
              />
            </div>
          </div>

          {!workspaceLoading && jobs.length > 0 ? (
            <div className="library-selection-bar">
              <label className="selection-toggle">
                <input
                  checked={allVisibleProjectsSelected}
                  disabled={visibleProjectIds.length === 0}
                  onChange={toggleVisibleProjects}
                  type="checkbox"
                />
                <span>{hasProjectSearchQuery ? 'Select results' : 'Select all'}</span>
              </label>
              {selectedProjectCount > 0 ? (
                <>
                  <span className="selection-count">{selectedProjectCount} selected</span>
                  <button className="secondary-action danger" onClick={deleteSelectedProjects} type="button">
                    <Trash2 size={14} />
                    Delete
                  </button>
                  <button className="secondary-action" onClick={clearProjectSelection} type="button">Clear</button>
                </>
              ) : null}
            </div>
          ) : null}

          {workspaceLoading ? (
            <ProjectSkeletonList />
          ) : jobs.length === 0 ? (
            <EmptyState title="No transcript projects yet" body="Import a recording to start building your local library." />
          ) : hasProjectSearchQuery && visibleJobs.length === 0 ? (
            <EmptyState title="No projects match this search" body="Try another file name, status, model, or folder path." />
          ) : (
            <div className="project-list">
              {visibleJobs.map((entry) => {
                const isLive = activeStatuses.includes(entry.job.status);
                const showStatus = entry.job.status !== 'completed';

                const isSelected = selectedProjectIdSet.has(entry.job.id);

                return (
                  <div className={`project-row ${isLive ? 'live' : ''} ${isSelected ? 'selected' : ''}`} key={entry.job.id}>
                    <label className="project-select-control" title="Select project">
                      <input
                        aria-label={`Select ${entry.sourceFile.name}`}
                        checked={isSelected}
                        onChange={() => toggleProjectSelection(entry.job.id)}
                        type="checkbox"
                      />
                    </label>
                    <button className="project-open-button" onClick={() => onOpenJob(entry.job.id)} type="button">
                      <span className="project-icon">{mediaKindFromExtension(entry.sourceFile.extension) === 'video' ? <FileVideo size={17} /> : <FileAudio size={17} />}</span>
                      <span className="project-main">
                        <strong>{entry.sourceFile.name}</strong>
                        <small>{formatDuration(entry.sourceFile.durationSeconds)} / {formatDate(entry.job.createdAt)}</small>
                      </span>
                      {showStatus ? <ProgressPill job={entry} solverLabel={solverLabelForJob(entry, solverLabelsByJobId[entry.job.id])} /> : null}
                    </button>
                    <ProjectInlineActions
                      onDelete={() => onDeleteProject(entry)}
                      onDetails={() => onDetailsProject(entry.job.id)}
                      onRename={() => onRenameProject(entry)}
                    />
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
