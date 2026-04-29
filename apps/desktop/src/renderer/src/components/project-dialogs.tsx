import { type ReactElement, useState } from 'react';
import { AlertTriangle, FileAudio, FileVideo, Pencil, RotateCcw, Trash2, UploadCloud, X } from 'lucide-react';
import type { JobWithSource, ModelProfile, ProjectDetails, ResourceStatus, TranscriptionPresetId } from '@voxmire/contracts';
import { EmptyState } from './empty-state';
import { formatDateTime, formatDuration, formatFileSize } from '../lib/format';
import { statusLabel } from '../lib/job-status';
import { mediaKindFromExtension, mediaKindLabel } from '../lib/media-kind';
import { presetModelOptionLabel, visiblePresetOptions, type ResolvedTranscriptionPreset } from '../lib/presets';

type ImportModalProps = {
  busy: boolean;
  createJob: () => Promise<void>;
  models: ModelProfile[];
  resources: ResourceStatus[];
  onClose: () => void;
  selectedPresetId: TranscriptionPresetId;
  selectedPresetResolution: ResolvedTranscriptionPreset;
  setSelectedPresetId: (presetId: TranscriptionPresetId) => void;
};

export function ImportModal({ busy, createJob, models, resources, onClose, selectedPresetId, selectedPresetResolution, setSelectedPresetId }: ImportModalProps): ReactElement {
  return (
    <div className="modal-backdrop" role="presentation">
      <section className="import-modal" aria-labelledby="import-title" role="dialog">
        <div className="modal-glow" />
        <header className="modal-header">
          <div>
            <p className="eyebrow">New transcript</p>
            <h2 id="import-title">Import media</h2>
          </div>
          <button className="icon-button" onClick={onClose} title="Close" type="button"><X size={18} /></button>
        </header>

        <div className="settings-field-grid modal-field-grid">
          <label>
            <span className="field-label">Transcription model</span>
            <select value={selectedPresetId} onChange={(event) => setSelectedPresetId(event.target.value as TranscriptionPresetId)}>
              {visiblePresetOptions(resources).map((preset) => <option key={preset.id} value={preset.id}>{presetModelOptionLabel(models, preset)}</option>)}
            </select>
          </label>
          <label>
            <span className="field-label">Resolved backend</span>
            <select value={selectedPresetResolution.engineBackend} disabled>
              <option value={selectedPresetResolution.engineBackend}>{selectedPresetResolution.engineBackend.toUpperCase()}</option>
            </select>
          </label>
        </div>

        <button className="drop-zone" disabled={busy} onClick={() => void createJob()} type="button">
          <span className="drop-icon"><UploadCloud size={30} /></span>
          <strong>{busy ? 'Opening file picker...' : 'Choose audio or video'}</strong>
          <small>MP3, WAV, M4A, FLAC, OGG, MP4, MOV, and WebM</small>
        </button>
      </section>
    </div>
  );
}

type ProjectDetailsDrawerProps = {
  details: ProjectDetails | null;
  loading: boolean;
  onClose: () => void;
  onDelete: (project: JobWithSource) => void;
  onRename: (project: JobWithSource) => void;
};

export function ProjectDetailsDrawer({ details, loading, onClose, onDelete, onRename }: ProjectDetailsDrawerProps): ReactElement {
  const project = details ? { job: details.job, sourceFile: details.sourceFile } : null;
  const mediaKind = details ? mediaKindFromExtension(details.sourceFile.extension) : 'audio';

  return (
    <div className="details-drawer-layer" onClick={onClose} role="presentation">
      <aside className="project-details-drawer" aria-label="Project details" onClick={(event) => event.stopPropagation()}>
        <header className="modal-header details-header">
          <div>
            <p className="eyebrow">Project</p>
            <h2>Details</h2>
          </div>
          <button className="icon-button" onClick={onClose} title="Close details" type="button"><X size={18} /></button>
        </header>

        {loading ? (
          <EmptyState title="Loading details" body="Reading project metadata from the local workspace." />
        ) : details ? (
          <>
            <section className="details-summary">
              <span className="project-icon">{mediaKind === 'video' ? <FileVideo size={18} /> : <FileAudio size={18} />}</span>
              <div>
                <strong>{details.sourceFile.name}</strong>
                <small>{formatDuration(details.sourceFile.durationSeconds)} {mediaKindLabel(mediaKind)}</small>
              </div>
            </section>

            <dl className="details-grid">
              <div><dt>Status</dt><dd>{statusLabel(details.job.status)}</dd></div>
              <div><dt>Progress</dt><dd>{Math.round(details.job.progress * 100)}%</dd></div>
              <div><dt>Model</dt><dd>{details.job.modelId}</dd></div>
              <div><dt>Backend</dt><dd>{details.job.engineBackend.toUpperCase()}</dd></div>
              <div><dt>Transcript segments</dt><dd>{details.segmentCount.toLocaleString()}</dd></div>
              <div><dt>Prepared chunks</dt><dd>{details.chunkCount.toLocaleString()}</dd></div>
              <div><dt>Media source</dt><dd>{details.mediaAvailable ? 'Available' : 'Missing'}</dd></div>
              <div><dt>Size</dt><dd>{formatFileSize(details.sourceFile.sizeBytes)}</dd></div>
              <div><dt>Imported</dt><dd>{formatDateTime(details.job.createdAt)}</dd></div>
              <div><dt>Updated</dt><dd>{formatDateTime(details.job.updatedAt)}</dd></div>
              {details.job.completedAt ? <div><dt>Completed</dt><dd>{formatDateTime(details.job.completedAt)}</dd></div> : null}
            </dl>

            <section className="details-path">
              <span>Source path</span>
              <p>{details.sourceFile.path}</p>
            </section>

            {details.job.errorMessage ? <div className="error-text details-error"><AlertTriangle size={16} /> {details.job.errorMessage}</div> : null}

            <footer className="details-actions">
              <button className="secondary-action" disabled={!project} onClick={() => project && onRename(project)} type="button">
                <Pencil size={14} />
                Rename
              </button>
              <button className="secondary-action danger" disabled={!project} onClick={() => project && onDelete(project)} type="button">
                <Trash2 size={14} />
                Delete
              </button>
            </footer>
          </>
        ) : (
          <EmptyState title="Project not found" body="This project may have already been deleted." />
        )}
      </aside>
    </div>
  );
}

type RenameProjectModalProps = {
  busy: boolean;
  project: JobWithSource;
  onClose: () => void;
  onRename: (jobId: string, name: string) => Promise<void>;
};

export function RenameProjectModal({ busy, project, onClose, onRename }: RenameProjectModalProps): ReactElement {
  const [name, setName] = useState(project.sourceFile.name);
  const trimmedName = name.trim();

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="import-modal project-modal" aria-labelledby="rename-project-title" role="dialog">
        <div className="modal-glow" />
        <header className="modal-header">
          <div>
            <p className="eyebrow">Project</p>
            <h2 id="rename-project-title">Rename project</h2>
          </div>
          <button className="icon-button" disabled={busy} onClick={onClose} title="Close" type="button"><X size={18} /></button>
        </header>

        <label className="project-name-field">
          <span className="field-label">Display name</span>
          <input
            autoFocus
            maxLength={180}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && trimmedName) {
                void onRename(project.job.id, trimmedName);
              }
            }}
            value={name}
          />
        </label>

        <footer className="modal-actions">
          <button className="secondary-action" disabled={busy} onClick={onClose} type="button">Cancel</button>
          <button className="primary-action compact" disabled={busy || !trimmedName} onClick={() => void onRename(project.job.id, trimmedName)} type="button">
            Save
          </button>
        </footer>
      </section>
    </div>
  );
}

type DeleteProjectModalProps = {
  busy: boolean;
  project: JobWithSource;
  onClose: () => void;
  onDelete: (jobId: string) => Promise<void>;
};

export function DeleteProjectModal({ busy, project, onClose, onDelete }: DeleteProjectModalProps): ReactElement {
  return (
    <div className="modal-backdrop" role="presentation">
      <section className="import-modal project-modal delete-project-modal" aria-labelledby="delete-project-title" role="dialog">
        <div className="modal-glow danger-glow" />
        <header className="modal-header">
          <div>
            <p className="eyebrow">Project</p>
            <h2 id="delete-project-title">Delete project</h2>
          </div>
          <button className="icon-button" disabled={busy} onClick={onClose} title="Close" type="button"><X size={18} /></button>
        </header>

        <p className="delete-copy">
          Delete <strong>{project.sourceFile.name}</strong> from Voxmire. This removes the transcript and job records only. The original media file stays on disk.
        </p>

        <footer className="modal-actions">
          <button className="secondary-action" disabled={busy} onClick={onClose} type="button">Cancel</button>
          <button className="secondary-action danger solid-danger" disabled={busy} onClick={() => void onDelete(project.job.id)} type="button">
            <Trash2 size={14} />
            Delete project
          </button>
        </footer>
      </section>
    </div>
  );
}

type ResetTranscriptModalProps = {
  busy: boolean;
  project: JobWithSource;
  onClose: () => void;
  onReset: () => Promise<void>;
};

export function ResetTranscriptModal({ busy, project, onClose, onReset }: ResetTranscriptModalProps): ReactElement {
  return (
    <div className="modal-backdrop" role="presentation">
      <section className="import-modal project-modal delete-project-modal" aria-labelledby="reset-transcript-title" role="dialog">
        <div className="modal-glow danger-glow" />
        <header className="modal-header">
          <div>
            <p className="eyebrow">Transcript</p>
            <h2 id="reset-transcript-title">Reset transcript</h2>
          </div>
          <button className="icon-button" disabled={busy} onClick={onClose} title="Close" type="button"><X size={18} /></button>
        </header>

        <p className="delete-copy">
          Reset <strong>{project.sourceFile.name}</strong> to the original transcription. This removes transcript edits, splits, merges, and timing changes.
        </p>

        <footer className="modal-actions">
          <button className="secondary-action" disabled={busy} onClick={onClose} type="button">Cancel</button>
          <button className="secondary-action danger solid-danger" disabled={busy} onClick={() => void onReset()} type="button">
            <RotateCcw size={14} />
            Reset transcript
          </button>
        </footer>
      </section>
    </div>
  );
}
