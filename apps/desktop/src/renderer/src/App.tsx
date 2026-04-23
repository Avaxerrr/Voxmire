import { type ReactElement, useEffect, useMemo, useState } from 'react';
import type {
  EngineAvailability,
  ExportFormat,
  JobWithSource,
  ModelId,
  ModelProfile,
  TranscriptSegment,
  TranscriptionProgressEvent
} from '@voxmire/contracts';

type AppInfo = {
  name: string;
  version: string;
  platform: string;
  arch: string;
};

const exportFormats: ExportFormat[] = ['txt', 'json', 'srt', 'vtt'];

export function App(): ReactElement {
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [engines, setEngines] = useState<EngineAvailability[]>([]);
  const [models, setModels] = useState<ModelProfile[]>([]);
  const [selectedModelId, setSelectedModelId] = useState<ModelId>('large-v3-turbo');
  const [jobs, setJobs] = useState<JobWithSource[]>([]);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [segments, setSegments] = useState<TranscriptSegment[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const selectedJob = useMemo(
    () => jobs.find((entry) => entry.job.id === selectedJobId) ?? jobs[0] ?? null,
    [jobs, selectedJobId]
  );

  useEffect(() => {
    void loadInitialState();

    const unsubscribe = window.voxmire.jobs.onProgress((event) => {
      void handleProgress(event);
    });

    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!selectedJob) {
      setSegments([]);
      return;
    }

    void window.voxmire.transcripts.get(selectedJob.job.id).then(setSegments);
  }, [selectedJob?.job.id]);

  async function loadInitialState(): Promise<void> {
    const [info, engineAvailability, modelProfiles, jobList] = await Promise.all([
      window.voxmire.app.getInfo(),
      window.voxmire.system.getEngineAvailability(),
      window.voxmire.models.list(),
      window.voxmire.jobs.list()
    ]);

    setAppInfo(info);
    setEngines(engineAvailability);
    setModels(modelProfiles);
    setJobs(jobList);
    setSelectedJobId(jobList[0]?.job.id ?? null);
  }

  async function handleProgress(event: TranscriptionProgressEvent): Promise<void> {
    setMessage(event.message);
    const updated = await window.voxmire.jobs.list();
    setJobs(updated);
    setSelectedJobId((current) => current ?? event.jobId);

    if (event.segment || selectedJobId === event.jobId) {
      const updatedSegments = await window.voxmire.transcripts.get(event.jobId);
      setSegments(updatedSegments);
    }
  }

  async function createJob(): Promise<void> {
    setBusy(true);
    setMessage(null);

    try {
      const created = await window.voxmire.jobs.create({ modelId: selectedModelId });
      if (created) {
        const updated = await window.voxmire.jobs.list();
        setJobs(updated);
        setSelectedJobId(created.job.id);
        setMessage('Job created. Local transcription will start automatically.');
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to create transcription job.');
    } finally {
      setBusy(false);
    }
  }

  async function cancelJob(jobId: string): Promise<void> {
    await window.voxmire.jobs.cancel(jobId);
    setJobs(await window.voxmire.jobs.list());
    setMessage('Job canceled.');
  }

  async function exportTranscript(format: ExportFormat): Promise<void> {
    if (!selectedJob) {
      return;
    }

    try {
      const result = await window.voxmire.exports.create(selectedJob.job.id, format);
      setMessage(`Exported ${format.toUpperCase()} to ${result.path}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : `Failed to export ${format}.`);
    }
  }

  const cpuEngine = engines.find((engine) => engine.backend === 'cpu');

  return (
    <main className="app-shell">
      <aside className="sidebar" aria-label="Workspace navigation">
        <div className="brand-block">
          <div className="brand-mark">V</div>
          <div>
            <h1>Voxmire</h1>
            <p>Local transcription</p>
          </div>
        </div>

        <nav className="nav-list" aria-label="Primary">
          <button className="nav-item active" type="button">Jobs</button>
          <button className="nav-item" type="button">Models</button>
          <button className="nav-item" type="button">Exports</button>
          <button className="nav-item" type="button">Settings</button>
        </nav>

        <div className="runtime-card">
          <span>Runtime</span>
          <strong>{appInfo ? `${appInfo.platform} ${appInfo.arch}` : 'Detecting...'}</strong>
          <p>{cpuEngine?.available ? 'CPU engine detected' : 'CPU engine missing'}</p>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">Desktop MVP</p>
            <h2>Transcription Queue</h2>
          </div>
          <div className="toolbar">
            <select value={selectedModelId} onChange={(event) => setSelectedModelId(event.target.value as ModelId)}>
              {models.map((model) => (
                <option key={model.id} value={model.id}>{model.label}</option>
              ))}
            </select>
            <button className="primary-action" disabled={busy} onClick={createJob} type="button">
              {busy ? 'Importing...' : 'Import audio'}
            </button>
          </div>
        </header>

        {message ? <div className="message-bar">{message}</div> : null}

        <section className="content-grid main-grid">
          <article className="panel job-panel">
            <div className="panel-header">
              <h3>Jobs</h3>
              <span>{jobs.length} total</span>
            </div>

            {jobs.length === 0 ? (
              <div className="empty-state">
                <h4>No jobs yet</h4>
                <p>Import an audio or video file to create the first local transcription job.</p>
              </div>
            ) : (
              <div className="job-list">
                {jobs.map((entry) => (
                  <button
                    className={`job-row ${selectedJob?.job.id === entry.job.id ? 'selected' : ''}`}
                    key={entry.job.id}
                    onClick={() => setSelectedJobId(entry.job.id)}
                    type="button"
                  >
                    <div>
                      <strong>{entry.sourceFile.name}</strong>
                      <p>{entry.job.status} · {Math.round(entry.job.progress * 100)}%</p>
                    </div>
                    <span>{entry.job.modelId}</span>
                  </button>
                ))}
              </div>
            )}
          </article>

          <article className="panel transcript-panel">
            <div className="panel-header">
              <div>
                <h3>{selectedJob ? selectedJob.sourceFile.name : 'Transcript'}</h3>
                <span>{selectedJob ? selectedJob.job.status : 'No job selected'}</span>
              </div>
              {selectedJob ? (
                <div className="panel-actions">
                  {selectedJob.job.status === 'transcribing' || selectedJob.job.status === 'queued' || selectedJob.job.status === 'preparing' ? (
                    <button className="secondary-action" onClick={() => void cancelJob(selectedJob.job.id)} type="button">Cancel</button>
                  ) : null}
                  {exportFormats.map((format) => (
                    <button
                      className="secondary-action"
                      disabled={segments.length === 0}
                      key={format}
                      onClick={() => void exportTranscript(format)}
                      type="button"
                    >
                      {format.toUpperCase()}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            {selectedJob ? (
              <>
                <div className="progress-track" aria-label="Progress">
                  <div style={{ width: `${Math.round(selectedJob.job.progress * 100)}%` }} />
                </div>
                {selectedJob.job.errorMessage ? <p className="error-text">{selectedJob.job.errorMessage}</p> : null}
                {segments.length === 0 ? (
                  <div className="empty-state">
                    <h4>Transcript pending</h4>
                    <p>Segments will appear here as the local engine saves them.</p>
                  </div>
                ) : (
                  <div className="segment-list">
                    {segments.map((segment) => (
                      <div className="segment-row" key={segment.id}>
                        <time>{formatTime(segment.startSeconds)} - {formatTime(segment.endSeconds)}</time>
                        <p>{segment.text}</p>
                      </div>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <div className="empty-state">
                <h4>Select or create a job</h4>
                <p>The transcript viewer is ready for the first imported file.</p>
              </div>
            )}
          </article>
        </section>

        <section className="content-grid">
          <article className="panel">
            <div className="panel-header">
              <h3>Engine Availability</h3>
              <span>Local resources</span>
            </div>
            <div className="model-list">
              {engines.map((engine) => (
                <div className="model-row" key={engine.id}>
                  <div>
                    <strong>{engine.label}</strong>
                    <p>{engine.available ? engine.executablePath : engine.reason}</p>
                  </div>
                  <span>{engine.available ? 'Ready' : 'Missing'}</span>
                </div>
              ))}
            </div>
          </article>

          <article className="panel">
            <div className="panel-header">
              <h3>Model Profiles</h3>
              <span>Initial shortlist</span>
            </div>
            <div className="model-list">
              {models.map((model) => (
                <div className="model-row" key={model.id}>
                  <div>
                    <strong>{model.label}</strong>
                    <p>{model.description}</p>
                  </div>
                  <span>{model.purpose}</span>
                </div>
              ))}
            </div>
          </article>
        </section>
      </section>
    </main>
  );
}

function formatTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.floor(seconds % 60);
  return `${minutes}:${remainder.toString().padStart(2, '0')}`;
}
