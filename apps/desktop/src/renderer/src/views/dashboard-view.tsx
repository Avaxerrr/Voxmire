import { type ReactElement } from 'react';
import { FileAudio, FileVideo, Info, MicVocal, Pencil, Search, Trash2, UploadCloud } from 'lucide-react';
import type { EngineBackend, JobWithSource, ModelProfile } from '@voxmire/contracts';
import { EmptyState } from '../components/empty-state';
import { ProgressPill } from '../components/progress-pill';
import { formatDate, formatDuration } from '../lib/format';
import { activeStatuses } from '../lib/job-status';
import { mediaKindFromExtension } from '../lib/media-kind';

type ProjectInlineActionsProps = {
  onDelete: () => void;
  onDetails: () => void;
  onRename: () => void;
};

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

type DashboardViewProps = {
  jobs: JobWithSource[];
  onDeleteProject: (project: JobWithSource) => void;
  onDetailsProject: (jobId: string) => void;
  onImport: () => void;
  onOpenJob: (jobId: string) => void;
  onOpenVoice: () => void;
  onRenameProject: (project: JobWithSource) => void;
  selectedBackend: EngineBackend;
  selectedModel: ModelProfile | null;
};

export function DashboardView({
  jobs,
  onDeleteProject,
  onDetailsProject,
  onImport,
  onOpenJob,
  onOpenVoice,
  onRenameProject,
  selectedBackend,
  selectedModel
}: DashboardViewProps): ReactElement {
  return (
    <div className="view workspace-page dashboard-view">
      <header className="page-header dashboard-header">
        <div>
          <p className="eyebrow">Workspace</p>
          <h2>Good afternoon.</h2>
        </div>
      </header>

      <div className="dashboard-scroll">
        <section className="quick-actions" aria-label="Quick actions">
          <button className="action-tile transcribe-tile" onClick={onImport} type="button">
            <span className="tile-icon"><UploadCloud size={24} /></span>
            <span className="tile-copy">
              <strong>Transcribe Audio</strong>
              <p>Create a private transcript from an audio or video file.</p>
              <small>{selectedModel?.label ?? 'Recommended preset'} / {selectedBackend.toUpperCase()}</small>
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
              <p className="eyebrow">Library</p>
              <h3>Transcript projects</h3>
            </div>
            <div className="library-controls">
              <label className="search-field">
                <Search size={15} />
                <input aria-label="Search projects" name="projectSearch" placeholder="Search projects" type="search" />
              </label>
              <button className="secondary-action" type="button">All</button>
              <button className="secondary-action" type="button">Active</button>
            </div>
          </div>

          {jobs.length === 0 ? (
            <EmptyState title="No transcript projects yet" body="Import a recording to start building your local library." />
          ) : (
            <div className="project-list">
              {jobs.map((entry) => {
                const isLive = activeStatuses.includes(entry.job.status);
                const showStatus = entry.job.status !== 'completed';

                return (
                  <div className={`project-row ${isLive ? 'live' : ''}`} key={entry.job.id}>
                    <button className="project-open-button" onClick={() => onOpenJob(entry.job.id)} type="button">
                      <span className="project-icon">{mediaKindFromExtension(entry.sourceFile.extension) === 'video' ? <FileVideo size={17} /> : <FileAudio size={17} />}</span>
                      <span className="project-main">
                        <strong>{entry.sourceFile.name}</strong>
                        <small>{formatDuration(entry.sourceFile.durationSeconds)} / {formatDate(entry.job.createdAt)}</small>
                      </span>
                      {showStatus ? <ProgressPill job={entry} /> : null}
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
