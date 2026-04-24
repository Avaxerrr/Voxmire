import { type ReactElement, useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  AlertTriangle,
  AudioWaveform,
  CheckCircle2,
  PanelLeftClose,
  PanelLeftOpen,
  Clock3,
  Cpu,
  Download,
  FileAudio,
  FileText,
  FolderOpen,
  Home,
  Lock,
  Maximize2,
  MicVocal,
  Minimize2,
  Minus,
  Pause,
  Play,
  Plus,
  Search,
  Settings,
  SkipBack,
  SkipForward,
  SlidersHorizontal,
  Sparkles,
  Square,
  UploadCloud,
  X,
  Zap
} from 'lucide-react';
import type {
  EngineAvailability,
  EngineBackend,
  ExportFormat,
  JobStatus,
  JobWithSource,
  MachineProfile,
  ModelId,
  ModelProfile,
  ResourceStatus,
  TranscriptSegment,
  TranscriptionProgressEvent
} from '@voxmire/contracts';

type AppInfo = {
  name: string;
  version: string;
  platform: string;
  arch: string;
};

type ViewId = 'dashboard' | 'transcript' | 'voice' | 'settings';

type StatusTone = 'ready' | 'active' | 'warning' | 'error';

const exportFormats: ExportFormat[] = ['txt', 'json', 'srt', 'vtt'];
const activeStatuses: JobStatus[] = ['queued', 'preparing', 'transcribing'];

const fallbackModels: ModelProfile[] = [
  {
    id: 'large-v3-turbo',
    label: 'large-v3-turbo',
    purpose: 'default',
    description: 'Recommended default for long recordings with a practical speed and quality balance.',
    recommended: true,
    languages: 'multilingual',
    relativeSpeed: 'balanced',
    relativeQuality: 'better'
  },
  {
    id: 'large-v3',
    label: 'large-v3',
    purpose: 'quality',
    description: 'Higher quality preset for jobs where accuracy matters more than speed.',
    recommended: false,
    languages: 'multilingual',
    relativeSpeed: 'slow',
    relativeQuality: 'best'
  },
  {
    id: 'distil-large-v3.5',
    label: 'distil-large-v3.5',
    purpose: 'fast English',
    description: 'Fast English-focused preset for shorter turnaround on compatible recordings.',
    recommended: false,
    languages: 'english-focused',
    relativeSpeed: 'fast',
    relativeQuality: 'good'
  },
  {
    id: 'medium',
    label: 'medium',
    purpose: 'fallback',
    description: 'Lower resource fallback for older machines.',
    recommended: false,
    languages: 'multilingual',
    relativeSpeed: 'fast',
    relativeQuality: 'good'
  }
];

const waveformBars = Array.from({ length: 104 }, (_, index) => {
  const wave = Math.abs(Math.sin(index * 0.44)) * 42;
  const chatter = (index * 19) % 31;
  const pause = index % 21 < 5 ? 13 : 0;
  return Math.max(12, Math.min(92, Math.round(18 + wave + chatter - pause)));
});

export function App(): ReactElement {
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [engines, setEngines] = useState<EngineAvailability[]>([]);
  const [models, setModels] = useState<ModelProfile[]>(fallbackModels);
  const [resources, setResources] = useState<ResourceStatus[]>([]);
  const [machineProfile, setMachineProfile] = useState<MachineProfile | null>(null);
  const [selectedModelId, setSelectedModelId] = useState<ModelId>('large-v3-turbo');
  const [selectedEngineBackend, setSelectedEngineBackend] = useState<EngineBackend>('cpu');
  const [jobs, setJobs] = useState<JobWithSource[]>([]);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [segments, setSegments] = useState<TranscriptSegment[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [view, setView] = useState<ViewId>('dashboard');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [playing, setPlaying] = useState(false);
  const progressRefreshSequence = useRef(0);
  const selectedJobIdRef = useRef<string | null>(null);
  const api = window.voxmire;

  const selectedJob = useMemo(
    () => jobs.find((entry) => entry.job.id === selectedJobId) ?? jobs[0] ?? null,
    [jobs, selectedJobId]
  );

  const selectedModel = useMemo(
    () => models.find((model) => model.id === selectedModelId) ?? models[0] ?? null,
    [models, selectedModelId]
  );

  const activeJob = useMemo(
    () => jobs.find((entry) => activeStatuses.includes(entry.job.status)) ?? null,
    [jobs]
  );

  const status = useMemo(() => {
    if (!api) {
      return { tone: 'warning' as StatusTone, text: 'Preview mode: desktop features are unavailable in browser.' };
    }

    if (activeJob) {
      return {
        tone: 'active' as StatusTone,
        text: `${activeJob.sourceFile.name} / ${Math.round(activeJob.job.progress * 100)}%`
      };
    }

    if (message) {
      const normalizedMessage = message.toLowerCase();
      const tone: StatusTone = normalizedMessage.includes('failed')
        ? 'error'
        : normalizedMessage.includes('completed')
          ? 'ready'
          : 'active';
      return { tone, text: message };
    }

    const missingRequired = resources.some((resource) => resource.required && !resource.available);
    if (missingRequired) {
      return { tone: 'warning' as StatusTone, text: 'Setup attention needed. Check Settings.' };
    }

    return { tone: 'ready' as StatusTone, text: 'Ready' };
  }, [activeJob, api, message, resources]);

  useEffect(() => {
    if (!api) {
      return;
    }

    void loadInitialState();

    const unsubscribe = api.jobs.onProgress((event) => {
      void handleProgress(event);
    });

    return unsubscribe;
  }, [api]);

  useEffect(() => {
    selectedJobIdRef.current = selectedJobId;
  }, [selectedJobId]);

  useEffect(() => {
    if (!selectedJob || !api) {
      setSegments([]);
      return;
    }

    void api.transcripts.get(selectedJob.job.id).then(setSegments);
  }, [api, selectedJob?.job.id]);

  async function loadInitialState(): Promise<void> {
    if (!api) {
      return;
    }

    const [info, engineAvailability, modelProfiles, resourceStatus, detectedMachineProfile, jobList] = await Promise.all([
      api.app.getInfo(),
      api.system.getEngineAvailability(),
      api.models.list(),
      api.system.getResourceStatus(),
      api.system.getMachineProfile(),
      api.jobs.list()
    ]);

    setAppInfo(info);
    setEngines(engineAvailability);
    setModels(modelProfiles);
    setResources(resourceStatus);
    setMachineProfile(detectedMachineProfile);
    setSelectedEngineBackend(selectUsableBackend(detectedMachineProfile));
    setSelectedModelId(selectUsableModel(detectedMachineProfile.recommendedModelId, resourceStatus));
    setJobs(jobList);
    setSelectedJobId(jobList[0]?.job.id ?? null);
  }

  async function handleProgress(event: TranscriptionProgressEvent): Promise<void> {
    const sequence = ++progressRefreshSequence.current;
    setMessage(event.message);
    if (!api) {
      return;
    }

    const updated = await api.jobs.list();
    if (sequence !== progressRefreshSequence.current) {
      return;
    }

    setJobs(updated);
    setSelectedJobId((current) => current ?? event.jobId);

    if (event.segment || selectedJobIdRef.current === event.jobId) {
      const updatedSegments = await api.transcripts.get(event.jobId);
      if (sequence !== progressRefreshSequence.current) {
        return;
      }

      setSegments(updatedSegments);
    }
  }

  async function createJob(): Promise<void> {
    setBusy(true);
    setMessage(null);

    try {
      if (!api) {
        setMessage('Desktop bridge unavailable. Open Voxmire through Electron to import media.');
        return;
      }

      const created = await api.jobs.create({ modelId: selectedModelId, engineBackend: selectedEngineBackend });
      if (created) {
        const updated = await api.jobs.list();
        setJobs(updated);
        setSelectedJobId(created.job.id);
        setView('transcript');
        setImportOpen(false);
        setMessage('Import started.');
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to create transcription job.');
    } finally {
      setBusy(false);
    }
  }

  async function cancelJob(jobId: string): Promise<void> {
    if (!api) {
      return;
    }

    await api.jobs.cancel(jobId);
    setJobs(await api.jobs.list());
    setMessage('Job canceled.');
  }

  async function pauseJob(jobId: string): Promise<void> {
    if (!api) {
      return;
    }

    await api.jobs.pause(jobId);
    setJobs(await api.jobs.list());
    setMessage('Job paused.');
  }

  async function resumeJob(jobId: string): Promise<void> {
    if (!api) {
      return;
    }

    await api.jobs.resume(jobId);
    setJobs(await api.jobs.list());
    setMessage('Job resumed.');
  }

  async function exportTranscript(format: ExportFormat): Promise<void> {
    if (!selectedJob) {
      return;
    }

    try {
      if (!api) {
        setMessage('Desktop bridge unavailable.');
        return;
      }

      const result = await api.exports.create(selectedJob.job.id, format);
      setMessage(`Exported ${format.toUpperCase()} to ${result.path}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : `Failed to export ${format}.`);
    }
  }

  function openJob(jobId: string): void {
    setSelectedJobId(jobId);
    setView('transcript');
  }

  return (
    <main className={`app-shell ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
      <div className="window-drag-strip" aria-hidden="true" />
      <WindowFrameControls />
      <aside className="sidebar" aria-label="Workspace navigation">

        <div className="brand-block">
          <div className="brand-mark"><AudioWaveform size={18} /></div>
          <div className="brand-copy">
            <h1>VOXMIRE</h1>
            <p>Local transcription studio</p>
          </div>
          <button className="collapse-button" onClick={() => setSidebarCollapsed((collapsed) => !collapsed)} type="button" title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
            {sidebarCollapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
          </button>
        </div>

        <nav className="nav-list" aria-label="Primary">
          <NavButton active={view === 'dashboard'} collapsed={sidebarCollapsed} icon={<Home size={18} />} label="Library" onClick={() => setView('dashboard')} />
          <NavButton active={view === 'transcript'} collapsed={sidebarCollapsed} icon={<FileText size={18} />} label="Transcript" onClick={() => setView('transcript')} />
          <NavButton active={view === 'voice'} collapsed={sidebarCollapsed} icon={<MicVocal size={18} />} label="Voice Studio" onClick={() => setView('voice')} badge="Soon" />
          <NavButton active={view === 'settings'} collapsed={sidebarCollapsed} icon={<Settings size={18} />} label="Settings" onClick={() => setView('settings')} />
        </nav>

      </aside>

      <section className="workspace">
        {message ? (
          <button className="status-toast" onClick={() => setMessage(null)} type="button" title="Dismiss status message">
            <span>{message}</span>
            <X size={14} />
          </button>
        ) : null}

        {view === 'dashboard' ? (
          <DashboardView
            jobs={jobs}
            onImport={() => setImportOpen(true)}
            onOpenJob={openJob}
            onOpenVoice={() => setView('voice')}
            selectedBackend={selectedEngineBackend}
            selectedModel={selectedModel}
          />
        ) : null}

        {view === 'transcript' ? (
          <TranscriptView
            busy={busy}
            exportTranscript={exportTranscript}
            jobs={jobs}
            onCancel={cancelJob}
            onImport={() => setImportOpen(true)}
            onPause={pauseJob}
            onResume={resumeJob}
            onSelectJob={setSelectedJobId}
            playing={playing}
            selectedJob={selectedJob}
            segments={segments}
            setPlaying={setPlaying}
          />
        ) : null}

        {view === 'voice' ? <VoiceStudioView /> : null}

        {view === 'settings' ? (
          <SettingsView
            appInfo={appInfo}
            engines={engines}
            machineProfile={machineProfile}
            models={models}
            resources={resources}
            selectedEngineBackend={selectedEngineBackend}
            selectedModelId={selectedModelId}
            setSelectedEngineBackend={setSelectedEngineBackend}
            setSelectedModelId={setSelectedModelId}
          />
        ) : null}

        <StatusBar status={status} activeJob={activeJob} appInfo={appInfo} />
      </section>

      {importOpen ? (
        <ImportModal
          busy={busy}
          createJob={createJob}
          machineProfile={machineProfile}
          models={models}
          onClose={() => setImportOpen(false)}
          selectedEngineBackend={selectedEngineBackend}
          selectedModelId={selectedModelId}
          setSelectedEngineBackend={setSelectedEngineBackend}
          setSelectedModelId={setSelectedModelId}
        />
      ) : null}
    </main>
  );
}

function WindowFrameControls(): ReactElement {
  const [isMaximized, setIsMaximized] = useState(false);
  const windowApi = window.voxmire?.window;

  useEffect(() => {
    if (!windowApi) {
      return;
    }

    void windowApi.isMaximized().then(setIsMaximized);
  }, [windowApi]);

  async function toggleMaximize(): Promise<void> {
    if (!windowApi) {
      return;
    }

    setIsMaximized(await windowApi.toggleMaximize());
  }

  return (
    <div className="window-frame-controls" aria-label="Window controls">
      <button disabled={!windowApi} onClick={() => void windowApi?.minimize()} title="Minimize" type="button">
        <Minus size={14} />
      </button>
      <button disabled={!windowApi} onClick={() => void toggleMaximize()} title={isMaximized ? 'Restore' : 'Maximize'} type="button">
        {isMaximized ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
      </button>
      <button className="close-control" disabled={!windowApi} onClick={() => void windowApi?.close()} title="Close" type="button">
        <X size={15} />
      </button>
    </div>
  );
}
type NavButtonProps = {
  active: boolean;
  badge?: string;
  collapsed: boolean;
  icon: ReactElement;
  label: string;
  onClick: () => void;
};

function NavButton({ active, badge, collapsed, icon, label, onClick }: NavButtonProps): ReactElement {
  return (
    <button className={`nav-item ${active ? 'active' : ''}`} onClick={onClick} type="button" title={collapsed ? label : undefined}>
      {icon}
      <span>{label}</span>
      {badge ? <small>{badge}</small> : null}
    </button>
  );
}

type DashboardViewProps = {
  jobs: JobWithSource[];
  onImport: () => void;
  onOpenJob: (jobId: string) => void;
  onOpenVoice: () => void;
  selectedBackend: EngineBackend;
  selectedModel: ModelProfile | null;
};

function DashboardView({ jobs, onImport, onOpenJob, onOpenVoice, selectedBackend, selectedModel }: DashboardViewProps): ReactElement {
  return (
    <div className="view dashboard-view">
      <header className="dashboard-header">
        <div>
          <p className="eyebrow">Workspace</p>
          <h2>Good afternoon.</h2>
        </div>
        <button className="primary-action" onClick={onImport} type="button">
          <Plus size={18} />
          New transcript
        </button>
      </header>

      <section className="quick-actions" aria-label="Quick actions">
        <button className="action-tile transcribe-tile" onClick={onImport} type="button">
          <span className="tile-icon"><UploadCloud size={24} /></span>
          <strong>Transcribe Audio</strong>
          <p>Create a private transcript from an audio or video file.</p>
          <small>{selectedModel?.label ?? 'Recommended preset'} / {selectedBackend.toUpperCase()}</small>
        </button>

        <button className="action-tile voice-tile" onClick={onOpenVoice} type="button">
          <span className="tile-icon"><MicVocal size={24} /></span>
          <strong>Voice Generation</strong>
          <p>Draft speech from text. This workspace is designed, but not connected yet.</p>
          <small>Coming soon</small>
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
              <input placeholder="Search projects" type="search" />
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

              return (
                <button className={`project-row ${isLive ? 'live' : ''}`} key={entry.job.id} onClick={() => onOpenJob(entry.job.id)} type="button">
                  <span className="project-icon"><FileAudio size={17} /></span>
                  <span className="project-main">
                    <strong>{entry.sourceFile.name}</strong>
                    <small>{formatDuration(entry.sourceFile.durationSeconds)} / {formatDate(entry.job.createdAt)}</small>
                  </span>
                  <ProgressPill job={entry} />
                </button>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

type TranscriptViewProps = {
  busy: boolean;
  exportTranscript: (format: ExportFormat) => Promise<void>;
  jobs: JobWithSource[];
  onCancel: (jobId: string) => Promise<void>;
  onImport: () => void;
  onPause: (jobId: string) => Promise<void>;
  onResume: (jobId: string) => Promise<void>;
  onSelectJob: (jobId: string) => void;
  playing: boolean;
  selectedJob: JobWithSource | null;
  segments: TranscriptSegment[];
  setPlaying: (playing: boolean) => void;
};

function TranscriptView({
  busy,
  exportTranscript,
  jobs,
  onCancel,
  onImport,
  onPause,
  onResume,
  onSelectJob,
  playing,
  selectedJob,
  segments,
  setPlaying
}: TranscriptViewProps): ReactElement {
  const progress = selectedJob ? Math.round(selectedJob.job.progress * 100) : 0;
  const isCancelable = selectedJob ? activeStatuses.includes(selectedJob.job.status) || selectedJob.job.status === 'paused' : false;
  const isPausable = selectedJob ? activeStatuses.includes(selectedJob.job.status) : false;
  const isResumable = selectedJob?.job.status === 'paused';
  const isWorking = selectedJob ? activeStatuses.includes(selectedJob.job.status) : false;

  return (
    <div className="view transcript-view">
      <header className="transcript-topbar glass-bar">
        <div className="title-stack">
          <p className="eyebrow">Transcript</p>
          {jobs.length > 0 ? (
            <select className="job-select" value={selectedJob?.job.id ?? ''} onChange={(event) => onSelectJob(event.target.value)}>
              {jobs.map((entry) => (
                <option key={entry.job.id} value={entry.job.id}>{entry.sourceFile.name}</option>
              ))}
            </select>
          ) : (
            <h2>No transcript selected</h2>
          )}
          <span>{selectedJob ? `${statusLabel(selectedJob.job.status)} / ${progress}%` : 'Choose a project from Library or import a recording.'}</span>
        </div>

        <div className="transcript-actions">
          <button className="icon-button" title="Search transcript" type="button"><Search size={17} /></button>
          {exportFormats.map((format) => (
            <button
              className="secondary-action"
              disabled={!selectedJob || segments.length === 0}
              key={format}
              onClick={() => void exportTranscript(format)}
              type="button"
            >
              <Download size={14} />
              {format.toUpperCase()}
            </button>
          ))}
          <button className="primary-action compact" disabled={busy} onClick={onImport} type="button">
            <Plus size={16} />
            Import
          </button>
        </div>
      </header>

      <section className="transcript-stage">
        {selectedJob ? (
          <>
            <div className="job-progress-row">
              <div className={`progress-track ${isWorking ? 'working' : ''}`} aria-label="Progress">
                <div style={{ width: `${progress}%` }} />
              </div>
              <div className="job-inline-actions" aria-label="Transcription controls">
                {isPausable ? (
                  <button className="secondary-action" onClick={() => void onPause(selectedJob.job.id)} type="button">
                    <Pause size={14} />
                    Pause
                  </button>
                ) : null}
                {isResumable ? (
                  <button className="secondary-action" onClick={() => void onResume(selectedJob.job.id)} type="button">
                    <Play size={14} />
                    Resume
                  </button>
                ) : null}
                {isCancelable ? (
                  <button className="secondary-action danger" onClick={() => void onCancel(selectedJob.job.id)} type="button">
                    <Square size={14} />
                    Stop
                  </button>
                ) : null}
              </div>
            </div>
            {selectedJob.job.errorMessage ? <div className="error-text"><AlertTriangle size={16} /> {selectedJob.job.errorMessage}</div> : null}
            {segments.length === 0 ? (
              <EmptyState title="Transcript pending" body="Transcript text will appear here as the job progresses." />
            ) : (
              <VirtualizedSegmentList segments={segments} />
            )}
          </>
        ) : (
          <EmptyState title="Open a transcript" body="Use Library for many projects, then edit one transcript here." />
        )}
      </section>

      <AudioDeck
        disabled={!selectedJob || segments.length === 0}
        duration={selectedJob?.sourceFile.durationSeconds ?? null}
        playing={playing}
        progress={progress}
        setPlaying={setPlaying}
      />
    </div>
  );
}

function VoiceStudioView(): ReactElement {
  return (
    <div className="view voice-view">
      <header className="voice-header glass-bar">
        <div>
          <p className="eyebrow">Voice Studio</p>
          <h2>Voice Generation</h2>
          <span>UI preview only. Generation is not connected yet.</span>
        </div>
        <span className="soon-pill"><Lock size={13} /> Coming soon</span>
      </header>

      <div className="voice-layout">
        <section className="script-panel panel-glow">
          <textarea disabled placeholder="Type or paste your script here..." />
          <div className="script-footer">
            <span>0 / 5000 characters</span>
            <button className="primary-action" disabled type="button"><Sparkles size={16} /> Generate Speech</button>
          </div>
        </section>

        <aside className="voice-inspector panel-glow">
          <section>
            <p className="eyebrow">Selected voice</p>
            <button className="voice-card selected" disabled type="button">
              <span className="voice-avatar"><MicVocal size={18} /></span>
              <span>
                <strong>Narrator</strong>
                <small>Clean / Professional</small>
              </span>
              <Play size={18} />
            </button>
            <button className="ghost-button" disabled type="button">Browse Voice Library</button>
          </section>

          <section>
            <p className="eyebrow">Voice tuning</p>
            <TuningSlider label="Stability" value="75" />
            <TuningSlider label="Clarity" value="82" />
          </section>
        </aside>
      </div>
    </div>
  );
}

function TuningSlider({ label, value }: { label: string; value: string }): ReactElement {
  return (
    <label className="tuning-slider">
      <span><strong>{label}</strong><em>{Number(value) / 100}</em></span>
      <input disabled max="100" min="0" type="range" value={value} readOnly />
    </label>
  );
}

type SettingsViewProps = {
  appInfo: AppInfo | null;
  engines: EngineAvailability[];
  machineProfile: MachineProfile | null;
  models: ModelProfile[];
  resources: ResourceStatus[];
  selectedEngineBackend: EngineBackend;
  selectedModelId: ModelId;
  setSelectedEngineBackend: (backend: EngineBackend) => void;
  setSelectedModelId: (modelId: ModelId) => void;
};

function SettingsView({ appInfo, engines, machineProfile, models, resources, selectedEngineBackend, selectedModelId, setSelectedEngineBackend, setSelectedModelId }: SettingsViewProps): ReactElement {
  const readyResources = resources.filter((resource) => resource.available).length;

  return (
    <div className="view settings-view">
      <header className="settings-header">
        <p className="eyebrow">Preferences</p>
        <h2>Settings</h2>
      </header>

      <div className="settings-stack">
        <section className="settings-panel panel-glow">
          <div className="settings-panel-heading">
            <SlidersHorizontal size={18} />
            <div>
              <h3>Transcription defaults</h3>
              <p>Choose the default quality preset used for new imports.</p>
            </div>
          </div>
          <div className="settings-field-grid">
            <label>
              <span className="field-label">Default preset</span>
              <select value={selectedModelId} onChange={(event) => setSelectedModelId(event.target.value as ModelId)}>
                {models.map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}
              </select>
            </label>
            <label>
              <span className="field-label">Backend</span>
              <select value={selectedEngineBackend} onChange={(event) => setSelectedEngineBackend(event.target.value as EngineBackend)}>
                {backendOptions(machineProfile).map((backend) => (
                  <option disabled={!backend.available} key={backend.backend} value={backend.backend}>{backend.label}</option>
                ))}
              </select>
            </label>
          </div>
        </section>

        <section className="settings-panel panel-glow">
          <div className="settings-panel-heading">
            <Cpu size={18} />
            <div>
              <h3>Machine profile</h3>
              <p>{machineProfile ? `${machineProfile.platform} ${machineProfile.arch} / ${machineProfile.logicalCpuCores} CPU threads / ${formatBytes(machineProfile.totalMemoryBytes)} RAM` : 'Detecting local hardware profile.'}</p>
            </div>
          </div>
          {machineProfile ? (
            <div className="machine-profile-grid">
              <div className="machine-recommendation">
                <span>Recommended</span>
                <strong>{machineProfile.recommendedBackend.toUpperCase()} / {modelLabel(models, machineProfile.recommendedModelId)}</strong>
              </div>
              <div className="backend-list">
                {machineProfile.backends.map((backend) => (
                  <div className={`backend-row ${backend.recommended ? 'recommended' : ''}`} key={backend.backend}>
                    <strong>{backend.label}</strong>
                    <span>{backend.executableAvailable && backend.runtimeAvailable ? 'Ready' : backend.executableAvailable ? 'Runtime missing' : 'Binary missing'}</span>
                    <p>{backend.reason ?? 'Available for local transcription.'}</p>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </section>

        <section className="settings-panel panel-glow">
          <div className="settings-panel-heading">
            <MicVocal size={18} />
            <div>
              <h3>Voice Generation</h3>
              <p>Controls will become available when the local voice engine is added.</p>
            </div>
          </div>
          <span className="soon-pill inline"><Lock size={13} /> Coming soon</span>
        </section>

        <section className="settings-panel panel-glow">
          <div className="settings-panel-heading">
            <FolderOpen size={18} />
            <div>
              <h3>Application</h3>
              <p>{appInfo ? `${appInfo.name} ${appInfo.version} / ${appInfo.platform} ${appInfo.arch}` : 'Desktop runtime will appear here.'}</p>
            </div>
          </div>
        </section>

        <details className="advanced-panel panel-glow">
          <summary>
            <span><AlertTriangle size={17} /> Advanced diagnostics</span>
            <small>{readyResources}/{resources.length} resources ready</small>
          </summary>
          <div className="diagnostic-grid">
            <section>
              <h4>Engines</h4>
              {engines.map((engine) => (
                <DiagnosticRow key={engine.id} label={engine.label} status={engine.available ? 'Ready' : 'Missing'} detail={engine.available ? engine.executablePath : engine.reason} />
              ))}
            </section>
            <section>
              <h4>Resources</h4>
              {resources.map((resource) => (
                <DiagnosticRow key={resource.id} label={resource.label} status={resource.available ? 'Ready' : resource.required ? 'Required' : 'Optional'} detail={resource.available ? resource.path : resource.reason} />
              ))}
            </section>
          </div>
        </details>
      </div>
    </div>
  );
}

function DiagnosticRow({ detail, label, status }: { detail: string | null; label: string; status: string }): ReactElement {
  return (
    <div className="diagnostic-row">
      <strong>{label}</strong>
      <span>{status}</span>
      <p>{detail ?? 'No details available.'}</p>
    </div>
  );
}

type ImportModalProps = {
  busy: boolean;
  createJob: () => Promise<void>;
  machineProfile: MachineProfile | null;
  models: ModelProfile[];
  onClose: () => void;
  selectedEngineBackend: EngineBackend;
  selectedModelId: ModelId;
  setSelectedEngineBackend: (backend: EngineBackend) => void;
  setSelectedModelId: (modelId: ModelId) => void;
};

function ImportModal({ busy, createJob, machineProfile, models, onClose, selectedEngineBackend, selectedModelId, setSelectedEngineBackend, setSelectedModelId }: ImportModalProps): ReactElement {
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
            <span className="field-label">Transcription preset</span>
            <select value={selectedModelId} onChange={(event) => setSelectedModelId(event.target.value as ModelId)}>
              {models.map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}
            </select>
          </label>
          <label>
            <span className="field-label">Backend</span>
            <select value={selectedEngineBackend} onChange={(event) => setSelectedEngineBackend(event.target.value as EngineBackend)}>
              {backendOptions(machineProfile).map((backend) => (
                <option disabled={!backend.available} key={backend.backend} value={backend.backend}>{backend.label}</option>
              ))}
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

function VirtualizedSegmentList({ segments }: { segments: TranscriptSegment[] }): ReactElement {
  const scrollParentRef = useRef<HTMLDivElement | null>(null);
  const rowVirtualizer = useVirtualizer({
    count: segments.length,
    estimateSize: () => 108,
    getItemKey: (index) => segments[index]?.id ?? index,
    getScrollElement: () => scrollParentRef.current,
    overscan: 8
  });

  return (
    <div className="segment-list virtualized" ref={scrollParentRef}>
      <div className="segment-list-inner" style={{ height: `${rowVirtualizer.getTotalSize()}px` }}>
        {rowVirtualizer.getVirtualItems().map((virtualRow) => {
          const segment = segments[virtualRow.index];
          if (!segment) {
            return null;
          }

          return (
            <div
              className="segment-virtual-row"
              data-index={virtualRow.index}
              key={virtualRow.key}
              ref={rowVirtualizer.measureElement}
              style={{ transform: `translateY(${virtualRow.start}px)` }}
            >
              <article className={`segment-row ${virtualRow.index === 0 ? 'active' : ''}`}>
                <time>{formatTime(segment.startSeconds)} - {formatTime(segment.endSeconds)}</time>
                <p>{segment.text}</p>
              </article>
            </div>
          );
        })}
      </div>
    </div>
  );
}

type AudioDeckProps = {
  disabled: boolean;
  duration: number | null;
  playing: boolean;
  progress: number;
  setPlaying: (playing: boolean) => void;
};

function AudioDeck({ disabled, duration, playing, progress, setPlaying }: AudioDeckProps): ReactElement {
  const playedBars = Math.round((progress / 100) * waveformBars.length);

  return (
    <section className="audio-deck panel-glow" aria-label="Audio controls">
      <div className="deck-controls">
        <button className="icon-button" disabled={disabled} title="Skip back" type="button"><SkipBack size={18} /></button>
        <button className="play-button" disabled={disabled} onClick={() => setPlaying(!playing)} title={playing ? 'Pause' : 'Play'} type="button">
          {playing ? <Pause size={22} /> : <Play size={22} />}
        </button>
        <button className="icon-button" disabled={disabled} title="Skip forward" type="button"><SkipForward size={18} /></button>
      </div>
      <div className="waveform-wrap">
        <div className="waveform-times">
          <span>{formatTime(duration ? duration * (progress / 100) : 0)}</span>
          <span>{formatDuration(duration)}</span>
        </div>
        <div className="waveform" aria-hidden="true">
          {waveformBars.map((height, index) => (
            <span className={index <= playedBars ? 'played' : ''} key={`${height}-${index}`} style={{ height: `${height}%` }} />
          ))}
        </div>
      </div>
      <div className="deck-meta"><Zap size={15} /><span>1.0x</span></div>
    </section>
  );
}

function StatusBar({ activeJob, appInfo, status }: { activeJob: JobWithSource | null; appInfo: AppInfo | null; status: { tone: StatusTone; text: string } }): ReactElement {
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

function ProgressPill({ job }: { job: JobWithSource }): ReactElement {
  const progress = Math.round(job.job.progress * 100);
  const icon = job.job.status === 'completed' ? <CheckCircle2 size={13} /> : activeStatuses.includes(job.job.status) ? <Clock3 size={13} /> : <FileText size={13} />;

  return <span className={`progress-pill ${statusClass(job.job.status)}`}>{icon}<span>{statusLabel(job.job.status)} / {progress}%</span></span>;
}

function EmptyState({ body, title }: { body: string; title: string }): ReactElement {
  return (
    <div className="empty-state">
      <FileText size={20} />
      <h4>{title}</h4>
      <p>{body}</p>
    </div>
  );
}

type BackendOption = {
  available: boolean;
  backend: EngineBackend;
  label: string;
};

function backendOptions(machineProfile: MachineProfile | null): BackendOption[] {
  if (!machineProfile) {
    return [{ available: true, backend: 'cpu', label: 'CPU' }];
  }

  return machineProfile.backends.map((backend) => ({
    available: backend.executableAvailable && backend.runtimeAvailable,
    backend: backend.backend,
    label: `${backend.backend.toUpperCase()}${backend.recommended ? ' recommended' : ''}`
  }));
}

function selectUsableModel(recommendedModelId: ModelId, resources: ResourceStatus[]): ModelId {
  const recommended = resources.find((resource) => resource.id === `model-${recommendedModelId}`);
  if (recommended?.available) {
    return recommendedModelId;
  }

  const fallback = resources.find((resource) => resource.kind === 'model' && resource.available);
  return fallback ? (fallback.id.replace(/^model-/, '') as ModelId) : 'large-v3-turbo';
}

function selectUsableBackend(machineProfile: MachineProfile): EngineBackend {
  const recommended = machineProfile.backends.find((backend) => backend.backend === machineProfile.recommendedBackend);
  if (recommended?.executableAvailable && recommended.runtimeAvailable) {
    return recommended.backend;
  }

  return 'cpu';
}

function modelLabel(models: ModelProfile[], modelId: ModelId): string {
  return models.find((model) => model.id === modelId)?.label ?? modelId;
}

function formatBytes(value: number): string {
  const gib = value / 1024 / 1024 / 1024;
  return `${gib.toFixed(gib >= 10 ? 0 : 1)} GiB`;
}

function statusClass(status: JobStatus): string {
  if (status === 'completed') return 'ready';
  if (status === 'failed') return 'missing';
  if (status === 'canceled') return 'optional';
  if (activeStatuses.includes(status)) return 'active';
  return 'optional';
}

function statusLabel(status: JobStatus): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function formatTime(seconds: number): string {
  const safeSeconds = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const remainder = Math.floor(safeSeconds % 60);

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${remainder.toString().padStart(2, '0')}`;
  }

  return `${minutes}:${remainder.toString().padStart(2, '0')}`;
}

function formatDuration(seconds: number | null): string {
  return seconds === null ? 'Duration unknown' : formatTime(seconds);
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'Unknown date';
  }

  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date);
}
