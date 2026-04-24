import { type MutableRefObject, type ReactElement, useEffect, useMemo, useRef, useState } from 'react';
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
  Volume2,
  VolumeX,
  X,
  Zap
} from 'lucide-react';
import {
  resolveTranscriptionPreset,
  transcriptionPresets,
  type ResolvedTranscriptionPreset
} from '@voxmire/core';
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
  TranscriptionPresetId,
  TranscriptionPresetProfile,
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
type WaveformScaleMode = 'actual' | 'boost' | 'db';

const exportFormats: ExportFormat[] = ['txt', 'srt', 'vtt', 'json'];
const activeStatuses: JobStatus[] = ['queued', 'preparing', 'transcribing'];
const waveformScaleModes: WaveformScaleMode[] = ['actual', 'boost', 'db'];
const playbackSpeeds = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;

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
  const [selectedPresetId, setSelectedPresetId] = useState<TranscriptionPresetId>('balanced');
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

  const selectedPresetResolution = useMemo(
    () => resolvePresetSelection(selectedPresetId, machineProfile, resources),
    [machineProfile, resources, selectedPresetId]
  );

  const selectedModel = useMemo(
    () => models.find((model) => model.id === selectedPresetResolution.modelId) ?? models[0] ?? null,
    [models, selectedPresetResolution.modelId]
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
    setSelectedPresetId(selectUsablePreset(detectedMachineProfile.recommendedModelId, resourceStatus));
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

      const created = await api.jobs.create({
        modelId: selectedPresetResolution.modelId,
        engineBackend: selectedPresetResolution.engineBackend
      });
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
            selectedBackend={selectedPresetResolution.engineBackend}
            selectedModel={selectedModel}
          />
        ) : null}

        {view === 'transcript' ? (
          <TranscriptView
            busy={busy}
            exportTranscript={exportTranscript}
            jobs={jobs}
            onCancel={cancelJob}
            onBrowseLibrary={() => setView('dashboard')}
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
            selectedPresetId={selectedPresetId}
            selectedPresetResolution={selectedPresetResolution}
            setSelectedPresetId={setSelectedPresetId}
          />
        ) : null}

        <StatusBar status={status} activeJob={activeJob} appInfo={appInfo} />
      </section>

      {importOpen ? (
        <ImportModal
          busy={busy}
          createJob={createJob}
          models={models}
          resources={resources}
          onClose={() => setImportOpen(false)}
          selectedPresetId={selectedPresetId}
          selectedPresetResolution={selectedPresetResolution}
          setSelectedPresetId={setSelectedPresetId}
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
                  <button className={`project-row ${isLive ? 'live' : ''}`} key={entry.job.id} onClick={() => onOpenJob(entry.job.id)} type="button">
                    <span className="project-icon"><FileAudio size={17} /></span>
                    <span className="project-main">
                      <strong>{entry.sourceFile.name}</strong>
                      <small>{formatDuration(entry.sourceFile.durationSeconds)} / {formatDate(entry.job.createdAt)}</small>
                    </span>
                    {showStatus ? <ProgressPill job={entry} /> : null}
                  </button>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
type TranscriptViewProps = {
  busy: boolean;
  exportTranscript: (format: ExportFormat) => Promise<void>;
  jobs: JobWithSource[];
  onCancel: (jobId: string) => Promise<void>;
  onBrowseLibrary: () => void;
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
  onBrowseLibrary,
  onImport,
  onPause,
  onResume,
  onSelectJob,
  playing,
  selectedJob,
  segments,
  setPlaying,
}: TranscriptViewProps): ReactElement {
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [switcherQuery, setSwitcherQuery] = useState('');
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [playbackTime, setPlaybackTime] = useState(0);
  const [playbackDuration, setPlaybackDuration] = useState<number | null>(null);
  const [waveformPeaks, setWaveformPeaks] = useState<number[]>([]);
  const [waveformLoading, setWaveformLoading] = useState(false);
  const exportMenuRef = useRef<HTMLDivElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const mediaApi = window.voxmire?.media;
  const progress = selectedJob ? Math.round(selectedJob.job.progress * 100) : 0;
  const isCancelable = selectedJob ? activeStatuses.includes(selectedJob.job.status) || selectedJob.job.status === 'paused' : false;
  const isPausable = selectedJob ? activeStatuses.includes(selectedJob.job.status) : false;
  const isResumable = selectedJob?.job.status === 'paused';
  const isWorking = selectedJob ? activeStatuses.includes(selectedJob.job.status) : false;
  const selectedSubtitle = selectedJob ? transcriptSubtitle(selectedJob, progress) : 'Choose a project from Library or import a recording.';
  const activeSegmentIndex = useMemo(() => findActiveSegmentIndex(segments, playbackTime), [playbackTime, segments]);
  const resolvedPlaybackDuration = playbackDuration ?? selectedJob?.sourceFile.durationSeconds ?? null;
  const visibleJobs = useMemo(() => {
    const query = switcherQuery.trim().toLowerCase();

    if (!query) {
      return jobs;
    }

    return jobs.filter((entry) => entry.sourceFile.name.toLowerCase().includes(query));
  }, [jobs, switcherQuery]);

  useEffect(() => {
    if (!switcherOpen && !exportMenuOpen) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        setSwitcherOpen(false);
        setExportMenuOpen(false);
      }
    }

    function handlePointerDown(event: MouseEvent): void {
      if (exportMenuRef.current && !exportMenuRef.current.contains(event.target as Node)) {
        setExportMenuOpen(false);
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('mousedown', handlePointerDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('mousedown', handlePointerDown);
    };
  }, [exportMenuOpen, switcherOpen]);

  useEffect(() => {
    let canceled = false;

    setPlaying(false);
    setPlaybackTime(0);
    setPlaybackDuration(null);
    setMediaError(null);
    setWaveformPeaks([]);
    setWaveformLoading(false);

    if (!selectedJob) {
      setMediaUrl(null);
      return () => {
        canceled = true;
      };
    }

    if (!mediaApi) {
      setMediaUrl(null);
      setMediaError('Audio playback is available in the desktop app.');
      return () => {
        canceled = true;
      };
    }

    void mediaApi.getSourceUrl(selectedJob.job.id)
      .then((url) => {
        if (canceled) {
          return;
        }

        setMediaUrl(url);
        if (!url) {
          setMediaError('Original media source is unavailable.');
        }
      })
      .catch(() => {
        if (!canceled) {
          setMediaUrl(null);
          setMediaError('Audio source could not be prepared.');
        }
      });

    setWaveformLoading(true);
    void mediaApi.getWaveform(selectedJob.job.id)
      .then((waveform) => {
        if (canceled) {
          return;
        }

        setWaveformPeaks(waveform?.peaks ?? []);
        setPlaybackDuration(waveform?.durationSeconds ?? null);
      })
      .catch(() => {
        if (!canceled) {
          setWaveformPeaks([]);
        }
      })
      .finally(() => {
        if (!canceled) {
          setWaveformLoading(false);
        }
      });

    return () => {
      canceled = true;
    };
  }, [mediaApi, selectedJob?.job.id, setPlaying]);

  function seekToSegment(segment: TranscriptSegment): void {
    const nextTime = Math.max(0, segment.startSeconds);
    const audio = audioRef.current;

    setPlaybackTime(nextTime);
    if (audio) {
      audio.currentTime = nextTime;
    }
  }

  return (
    <div className="view transcript-view">
      <header className="transcript-topbar glass-bar">
        <div className="title-stack">
          <p className="eyebrow">Transcript</p>
          <div className="transcript-title-row">
            <h2>{selectedJob?.sourceFile.name ?? 'No transcript selected'}</h2>
            <button
              aria-expanded={switcherOpen}
              aria-label="Switch transcript"
              className={`icon-button transcript-switch-button ${switcherOpen ? 'active' : ''}`}
              onClick={() => setSwitcherOpen((open) => !open)}
              title="Switch transcript"
              type="button"
            >
              <FolderOpen size={15} />
            </button>
          </div>
          <span>{selectedSubtitle}</span>
        </div>

        <div className="transcript-actions">
          <button aria-label="Search transcript" className="icon-button" title="Search transcript" type="button"><Search size={17} /></button>
          <div className="export-menu" ref={exportMenuRef}>
            <button
              aria-expanded={exportMenuOpen}
              aria-label="Export transcript"
              className={`icon-button export-trigger ${exportMenuOpen ? 'active' : ''}`}
              disabled={!selectedJob || segments.length === 0}
              onClick={() => setExportMenuOpen((open) => !open)}
              title="Export transcript"
              type="button"
            >
              <Download size={16} />
            </button>
            {exportMenuOpen ? (
              <div className="export-menu-popover" role="menu">
                {exportFormats.map((format) => (
                  <button
                    key={format}
                    onClick={() => {
                      setExportMenuOpen(false);
                      void exportTranscript(format);
                    }}
                    role="menuitem"
                    type="button"
                  >
                    <Download size={14} />
                    <span>{exportFormatLabel(format)}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <button aria-label="Import transcript" className="primary-action icon-action" disabled={busy} onClick={onImport} title="Import transcript" type="button">
            <Plus size={17} />
          </button>
        </div>
      </header>

      <section className="transcript-layout">
        {switcherOpen ? (
          <div className="transcript-switcher-layer" onClick={() => setSwitcherOpen(false)} role="presentation">
            <aside className="transcript-switcher-drawer" aria-label="Transcript switcher" onClick={(event) => event.stopPropagation()}>
              <div className="switcher-heading">
                <div>
                  <p className="eyebrow">Switch transcript</p>
                  <h3>Transcript projects</h3>
                </div>
                <button className="icon-button" onClick={() => setSwitcherOpen(false)} title="Close transcript switcher" type="button">
                  <X size={15} />
                </button>
              </div>

              <label className="search-field switcher-search">
                <Search size={15} />
                <input
                  aria-label="Find transcript"
                  name="transcriptSwitcherSearch"
                  onChange={(event) => setSwitcherQuery(event.target.value)}
                  placeholder="Find transcript"
                  type="search"
                  value={switcherQuery}
                />
              </label>

              <div className="transcript-switcher-list">
                {jobs.length === 0 ? (
                  <EmptyState title="No transcripts yet" body="Import a recording to create your first transcript." />
                ) : visibleJobs.length === 0 ? (
                  <EmptyState title="No matches" body="Try a different transcript name." />
                ) : (
                  visibleJobs.map((entry) => {
                    const isSelected = entry.job.id === selectedJob?.job.id;
                    const isLive = activeStatuses.includes(entry.job.status);
                    const showStatus = entry.job.status !== 'completed';

                    return (
                      <button
                        className={`transcript-switcher-row ${isSelected ? 'selected' : ''} ${isLive ? 'live' : ''}`}
                        key={entry.job.id}
                        onClick={() => {
                          onSelectJob(entry.job.id);
                          setSwitcherOpen(false);
                        }}
                        type="button"
                      >
                        <span className="project-main">
                          <strong>{entry.sourceFile.name}</strong>
                          <small>{formatDuration(entry.sourceFile.durationSeconds)} / {formatDate(entry.job.createdAt)}</small>
                        </span>
                        {showStatus ? <ProgressPill job={entry} /> : null}
                      </button>
                    );
                  })
                )}
              </div>
            </aside>
          </div>
        ) : null}

        <div className="transcript-main">
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
                  <VirtualizedSegmentList activeSegmentIndex={activeSegmentIndex} onSeek={seekToSegment} segments={segments} />
                )}
              </>
            ) : (
              <div className="empty-state transcript-empty-state">
                <FileText size={20} />
                <h4>Open a transcript</h4>
                <p>Choose a transcript from Library or import a recording.</p>
                <div className="empty-actions">
                  <button className="secondary-action" onClick={onBrowseLibrary} type="button">
                    <FolderOpen size={14} />
                    Browse Library
                  </button>
                  <button className="primary-action compact" disabled={busy} onClick={onImport} type="button">
                    <Plus size={16} />
                    Import
                  </button>
                </div>
              </div>
            )}
          </section>

          <AudioDeck
            audioRef={audioRef}
            currentTime={playbackTime}
            disabled={!selectedJob}
            duration={resolvedPlaybackDuration}
            mediaError={mediaError}
            mediaUrl={mediaUrl}
            onDurationChange={setPlaybackDuration}
            onError={setMediaError}
            onTimeChange={setPlaybackTime}
            playing={playing}
            waveformLoading={waveformLoading}
            waveformPeaks={waveformPeaks}
            setPlaying={setPlaying}
          />
        </div>
      </section>
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
  selectedPresetId: TranscriptionPresetId;
  selectedPresetResolution: ResolvedTranscriptionPreset;
  setSelectedPresetId: (presetId: TranscriptionPresetId) => void;
};

function SettingsView({ appInfo, engines, machineProfile, models, resources, selectedPresetId, selectedPresetResolution, setSelectedPresetId }: SettingsViewProps): ReactElement {
  const readyResources = resources.filter((resource) => resource.available).length;
  const selectablePresets = visiblePresetOptions(resources);
  const installedModels = models.filter((model) => modelInstalled(resources, model.id));

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
              <p>Choose the default local model used for new imports.</p>
            </div>
          </div>
          <div className="settings-field-grid">
            <label>
              <span className="field-label">Default model</span>
              <select value={selectedPresetId} onChange={(event) => setSelectedPresetId(event.target.value as TranscriptionPresetId)}>
                {selectablePresets.map((preset) => <option key={preset.id} value={preset.id}>{presetModelOptionLabel(models, preset)}</option>)}
              </select>
            </label>
            <label>
              <span className="field-label">Resolved backend</span>
              <select value={selectedPresetResolution.engineBackend} disabled>
                <option value={selectedPresetResolution.engineBackend}>{selectedPresetResolution.engineBackend.toUpperCase()}</option>
              </select>
            </label>
          </div>
        </section>

        <section className="settings-panel panel-glow">
          <div className="settings-panel-heading">
            <FileText size={18} />
            <div>
              <h3>Model manager</h3>
              <p>Installed local models available for new transcription jobs.</p>
            </div>
          </div>
          <div className="model-manager-list">
            {installedModels.length === 0 ? (
              <div className="model-row missing">
                <span>
                  <strong>No installed models found</strong>
                  <small>Add a local ggml model file under resources/models.</small>
                </span>
                <em>Missing</em>
              </div>
            ) : installedModels.map((model) => {
              const resource = modelResource(resources, model.id);

              return (
                <div className="model-row installed" key={model.id}>
                  <span>
                    <strong>{model.label}</strong>
                    <small>{model.purpose} / {model.relativeSpeed} / {model.relativeQuality}</small>
                  </span>
                  <em>Installed</em>
                  <p>{resource?.path ?? 'Model path unavailable.'}</p>
                </div>
              );
            })}
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
  models: ModelProfile[];
  resources: ResourceStatus[];
  onClose: () => void;
  selectedPresetId: TranscriptionPresetId;
  selectedPresetResolution: ResolvedTranscriptionPreset;
  setSelectedPresetId: (presetId: TranscriptionPresetId) => void;
};

function ImportModal({ busy, createJob, models, resources, onClose, selectedPresetId, selectedPresetResolution, setSelectedPresetId }: ImportModalProps): ReactElement {
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

type VirtualizedSegmentListProps = {
  activeSegmentIndex: number;
  onSeek: (segment: TranscriptSegment) => void;
  segments: TranscriptSegment[];
};

function VirtualizedSegmentList({ activeSegmentIndex, onSeek, segments }: VirtualizedSegmentListProps): ReactElement {
  const scrollParentRef = useRef<HTMLDivElement | null>(null);
  const rowVirtualizer = useVirtualizer({
    count: segments.length,
    estimateSize: () => 108,
    getItemKey: (index) => segments[index]?.id ?? index,
    getScrollElement: () => scrollParentRef.current,
    overscan: 8
  });

  useEffect(() => {
    if (activeSegmentIndex >= 0) {
      rowVirtualizer.scrollToIndex(activeSegmentIndex, { align: 'center' });
    }
  }, [activeSegmentIndex]);

  return (
    <div className="segment-list virtualized" ref={scrollParentRef}>
      <div className="segment-list-inner" style={{ height: `${rowVirtualizer.getTotalSize()}px` }}>
        {rowVirtualizer.getVirtualItems().map((virtualRow) => {
          const segment = segments[virtualRow.index];
          if (!segment) {
            return null;
          }

          const active = virtualRow.index === activeSegmentIndex;

          return (
            <div
              className="segment-virtual-row"
              data-index={virtualRow.index}
              key={virtualRow.key}
              ref={rowVirtualizer.measureElement}
              style={{ transform: `translateY(${virtualRow.start}px)` }}
            >
              <button className={`segment-row ${active ? 'active' : ''}`} onClick={() => onSeek(segment)} type="button">
                <time>{formatTime(segment.startSeconds)} - {formatTime(segment.endSeconds)}</time>
                <p>{segment.text}</p>
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

type WaveformGraphProps = {
  loading: boolean;
  peaks: number[];
  progress: number;
  scaleMode: WaveformScaleMode;
};

function WaveformGraph({ loading, peaks, progress, scaleMode }: WaveformGraphProps): ReactElement {
  const rawPeaks = peaks.length > 0 ? peaks : waveformBars.map((height) => height / 100);
  const displayPeaks = rawPeaks.map((peak) => scaleWaveformPeak(peak, scaleMode));
  const playedCount = Math.round(progress * displayPeaks.length);
  const width = 1200;
  const height = 96;
  const barWidth = Math.max(1, width / displayPeaks.length);

  return (
    <svg
      aria-hidden="true"
      className={`waveform ${loading ? 'loading' : ''}`}
      focusable="false"
      preserveAspectRatio="none"
      viewBox={`0 0 ${width} ${height}`}
    >
      {displayPeaks.map((peak, index) => {
        const clampedPeak = Math.max(0, Math.min(1, peak));
        const barHeight = Math.max(2, clampedPeak * height);
        const x = index * barWidth;
        const y = (height - barHeight) / 2;

        return (
          <rect
            className={index <= playedCount ? 'played' : ''}
            height={barHeight}
            key={`wave-${index}-${peak.toFixed(3)}`}
            rx={1.6}
            width={Math.max(1, barWidth * 0.62)}
            x={x}
            y={y}
          />
        );
      })}
    </svg>
  );
}

type AudioDeckProps = {
  audioRef: MutableRefObject<HTMLAudioElement | null>;
  currentTime: number;
  disabled: boolean;
  duration: number | null;
  mediaError: string | null;
  mediaUrl: string | null;
  onDurationChange: (duration: number | null) => void;
  onError: (message: string | null) => void;
  onTimeChange: (time: number) => void;
  playing: boolean;
  setPlaying: (playing: boolean) => void;
  waveformLoading: boolean;
  waveformPeaks: number[];
};

function AudioDeck({
  audioRef,
  currentTime,
  disabled,
  duration,
  mediaError,
  mediaUrl,
  onDurationChange,
  onError,
  onTimeChange,
  playing,
  setPlaying,
  waveformLoading,
  waveformPeaks
}: AudioDeckProps): ReactElement {
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [volumeOpen, setVolumeOpen] = useState(false);
  const [speedOpen, setSpeedOpen] = useState(false);
  const [scaleOpen, setScaleOpen] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [waveformScaleMode, setWaveformScaleMode] = useState<WaveformScaleMode>('actual');
  const resolvedDuration = duration && Number.isFinite(duration) && duration > 0 ? duration : null;
  const currentProgress = resolvedDuration ? Math.min(1, Math.max(0, currentTime / resolvedDuration)) : 0;
  const canPlay = !disabled && Boolean(mediaUrl) && !mediaError;
  const volumePercent = Math.round((muted ? 0 : volume) * 100);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }

    if (!canPlay) {
      audio.pause();
      if (playing) {
        setPlaying(false);
      }
      return;
    }

    if (playing) {
      void audio.play().catch(() => {
        setPlaying(false);
        onError('Audio playback could not start.');
      });
    } else {
      audio.pause();
    }
  }, [audioRef, canPlay, onError, playing, setPlaying]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }

    audio.volume = volume;
    audio.muted = muted;
  }, [audioRef, muted, volume]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }

    audio.playbackRate = playbackSpeed;
  }, [audioRef, playbackSpeed]);

  function skipBy(seconds: number): void {
    const audio = audioRef.current;
    if (!audio || !canPlay) {
      return;
    }

    const unclamped = audio.currentTime + seconds;
    const nextTime = resolvedDuration ? Math.min(resolvedDuration, Math.max(0, unclamped)) : Math.max(0, unclamped);
    audio.currentTime = nextTime;
    onTimeChange(nextTime);
  }

  function seekTo(seconds: number): void {
    const audio = audioRef.current;
    if (!audio || !canPlay || !resolvedDuration) {
      return;
    }

    const nextTime = Math.min(resolvedDuration, Math.max(0, seconds));
    audio.currentTime = nextTime;
    onTimeChange(nextTime);
  }

  return (
    <section className="audio-deck panel-glow" aria-label="Audio controls">
      <audio
        onDurationChange={(event) => {
          const nextDuration = event.currentTarget.duration;
          onDurationChange(Number.isFinite(nextDuration) ? nextDuration : null);
        }}
        onEnded={(event) => {
          onTimeChange(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : event.currentTarget.currentTime);
          setPlaying(false);
        }}
        onError={() => {
          setPlaying(false);
          onError('Audio source could not be loaded.');
        }}
        onLoadedMetadata={(event) => {
          const nextDuration = event.currentTarget.duration;
          event.currentTarget.playbackRate = playbackSpeed;
          onDurationChange(Number.isFinite(nextDuration) ? nextDuration : null);
          onTimeChange(event.currentTarget.currentTime);
        }}
        onPause={() => setPlaying(false)}
        onPlay={() => setPlaying(true)}
        onSeeked={(event) => onTimeChange(event.currentTarget.currentTime)}
        onTimeUpdate={(event) => onTimeChange(event.currentTarget.currentTime)}
        preload="metadata"
        ref={audioRef}
        src={mediaUrl ?? undefined}
      />
      {mediaError ? (
        <div className="deck-error">
          <Zap size={15} />
          <span>{mediaError}</span>
        </div>
      ) : (
        <>
          <div className="deck-controls">
            <button className="icon-button" disabled={!canPlay} onClick={() => skipBy(-10)} title="Skip back 10 seconds" type="button"><SkipBack size={18} /></button>
            <button className="play-button" disabled={!canPlay} onClick={() => setPlaying(!playing)} title={playing ? 'Pause' : 'Play'} type="button">
              {playing ? <Pause size={22} /> : <Play size={22} />}
            </button>
            <button className="icon-button" disabled={!canPlay} onClick={() => skipBy(10)} title="Skip forward 10 seconds" type="button"><SkipForward size={18} /></button>
          </div>
          <div className="deck-time-group" aria-label="Playback time">
            <span className="deck-time current">{formatTime(currentTime)}</span>
            <span className="deck-time-divider">/</span>
            <span className="deck-time">{formatDuration(resolvedDuration)}</span>
          </div>
          <div className="waveform-wrap">
            <div className="waveform-control">
              <WaveformGraph loading={waveformLoading} peaks={waveformPeaks} progress={currentProgress} scaleMode={waveformScaleMode} />
              <input
                aria-label="Seek audio"
                className="audio-seek"
                disabled={!canPlay || !resolvedDuration}
                max={resolvedDuration ?? 0}
                min={0}
                onChange={(event) => seekTo(Number(event.target.value))}
                step={0.01}
                type="range"
                value={resolvedDuration ? Math.min(currentTime, resolvedDuration) : 0}
              />
            </div>
          </div>
          <div className="deck-option-group">
            <div className="volume-control">
              <button
                aria-expanded={volumeOpen}
                className={`volume-button ${volumeOpen ? 'active' : ''}`}
                disabled={!mediaUrl}
                onClick={() => {
                  setVolumeOpen((open) => !open);
                  setScaleOpen(false);
                  setSpeedOpen(false);
                }}
                title="Volume"
                type="button"
              >
                {muted || volume === 0 ? <VolumeX size={15} /> : <Volume2 size={15} />}
              </button>
              {volumeOpen ? (
                <div className="volume-popover">
                  <button className="volume-mute-button" onClick={() => setMuted((value) => !value)} title={muted || volume === 0 ? 'Unmute' : 'Mute'} type="button">
                    {muted || volume === 0 ? <VolumeX size={14} /> : <Volume2 size={14} />}
                  </button>
                  <input
                    aria-label="Volume"
                    className="volume-slider"
                    disabled={!mediaUrl}
                    max={1}
                    min={0}
                    onChange={(event) => {
                      const nextVolume = Number(event.target.value);
                      setVolume(nextVolume);
                      setMuted(nextVolume === 0);
                    }}
                    step={0.01}
                    type="range"
                    value={muted ? 0 : volume}
                  />
                  <span>{volumePercent}%</span>
                </div>
              ) : null}
            </div>
            <div className="speed-control">
              <button
                aria-expanded={speedOpen}
                className={`speed-button ${speedOpen ? 'active' : ''}`}
                disabled={!mediaUrl}
                onClick={() => {
                  setSpeedOpen((open) => !open);
                  setScaleOpen(false);
                  setVolumeOpen(false);
                }}
                title="Playback speed"
                type="button"
              >
                {formatPlaybackSpeed(playbackSpeed)}
              </button>
              {speedOpen ? (
                <div className="speed-popover">
                  {playbackSpeeds.map((speed) => (
                    <button
                      className={speed === playbackSpeed ? 'active' : ''}
                      key={speed}
                      onClick={() => {
                        setPlaybackSpeed(speed);
                        setSpeedOpen(false);
                      }}
                      type="button"
                    >
                      {formatPlaybackSpeed(speed)}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            <div className="waveform-scale-control">
              <button
                aria-expanded={scaleOpen}
                className={`option-button ${scaleOpen ? 'active' : ''}`}
                disabled={!mediaUrl}
                onClick={() => {
                  setScaleOpen((open) => !open);
                  setSpeedOpen(false);
                  setVolumeOpen(false);
                }}
                title={`Waveform scale: ${waveformScaleLabel(waveformScaleMode)}`}
                type="button"
              >
                <SlidersHorizontal size={15} />
              </button>
              {scaleOpen ? (
                <div className="waveform-scale-popover" aria-label="Waveform scale">
                  {waveformScaleModes.map((mode) => (
                    <button
                      className={mode === waveformScaleMode ? 'active' : ''}
                      key={mode}
                      onClick={() => {
                        setWaveformScaleMode(mode);
                        setScaleOpen(false);
                      }}
                      title={waveformScaleDescription(mode)}
                      type="button"
                    >
                      {waveformScaleLabel(mode)}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        </>
      )}
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

function modelResource(resources: ResourceStatus[], modelId: ModelId): ResourceStatus | null {
  return resources.find((resource) => resource.id === `model-${modelId}`) ?? null;
}

function modelInstalled(resources: ResourceStatus[], modelId: ModelId): boolean {
  return modelResource(resources, modelId)?.available ?? false;
}

function presetUsable(resources: ResourceStatus[], preset: TranscriptionPresetProfile): boolean {
  return modelInstalled(resources, preset.modelId);
}

function visiblePresetOptions(resources: ResourceStatus[]): readonly TranscriptionPresetProfile[] {
  const installed = transcriptionPresets.filter((preset) => presetUsable(resources, preset));
  if (installed.length > 0) {
    return installed;
  }

  return transcriptionPresets.filter((preset) => preset.recommended);
}

function presetModelOptionLabel(models: ModelProfile[], preset: TranscriptionPresetProfile): string {
  return models.find((model) => model.id === preset.modelId)?.label
    ?? fallbackModels.find((model) => model.id === preset.modelId)?.label
    ?? preset.modelId;
}

function selectUsablePreset(recommendedModelId: ModelId, resources: ResourceStatus[]): TranscriptionPresetId {
  const matchingRecommended = transcriptionPresets.find((preset) => preset.modelId === recommendedModelId && presetUsable(resources, preset));
  if (matchingRecommended) {
    return matchingRecommended.id;
  }

  const recommended = transcriptionPresets.find((preset) => preset.recommended && presetUsable(resources, preset));
  if (recommended) {
    return recommended.id;
  }

  return transcriptionPresets.find((preset) => presetUsable(resources, preset))?.id ?? 'balanced';
}

function resolvePresetSelection(
  presetId: TranscriptionPresetId,
  machineProfile: MachineProfile | null,
  resources: ResourceStatus[]
): ResolvedTranscriptionPreset {
  const fallbackPresetId = presetUsable(resources, resolveTranscriptionPreset(presetId).preset)
    ? presetId
    : selectUsablePreset('large-v3-turbo', resources);
  const fallbackBackend = machineProfile ? selectUsableBackend(machineProfile) : 'cpu';
  const resolved = resolveTranscriptionPreset(fallbackPresetId, {
    ...(machineProfile ? { machineProfile } : {}),
    fallbackBackend
  });
  const backend = backendOptions(machineProfile).find((option) => option.backend === resolved.engineBackend);

  return {
    ...resolved,
    engineBackend: backend?.available ? resolved.engineBackend : fallbackBackend
  };
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

function findActiveSegmentIndex(segments: TranscriptSegment[], time: number): number {
  if (segments.length === 0 || !Number.isFinite(time)) {
    return -1;
  }

  const firstSegment = segments[0];
  if (!firstSegment || time < firstSegment.startSeconds) {
    return -1;
  }

  let low = 0;
  let high = segments.length - 1;
  let candidate = -1;

  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const segment = segments[middle];

    if (!segment || segment.startSeconds > time) {
      high = middle - 1;
      continue;
    }

    candidate = middle;
    low = middle + 1;
  }

  return candidate;
}

function scaleWaveformPeak(peak: number, mode: WaveformScaleMode): number {
  const clampedPeak = Math.max(0, Math.min(1, peak));

  if (mode === 'actual') {
    return clampedPeak;
  }

  if (mode === 'boost') {
    return Math.pow(clampedPeak, 0.72);
  }

  const floorDb = -60;
  const db = 20 * Math.log10(Math.max(clampedPeak, 0.001));
  return Math.max(0, Math.min(1, (db - floorDb) / Math.abs(floorDb)));
}

function formatPlaybackSpeed(speed: number): string {
  return Number.isInteger(speed) ? `${speed}x` : `${speed.toFixed(2).replace(/0$/, '')}x`;
}

function waveformScaleLabel(mode: WaveformScaleMode): string {
  switch (mode) {
    case 'actual':
      return 'Actual';
    case 'boost':
      return 'Boost';
    case 'db':
      return 'dB';
    default:
      return mode;
  }
}

function waveformScaleDescription(mode: WaveformScaleMode): string {
  switch (mode) {
    case 'actual':
      return 'Linear full-scale peaks. Most truthful for quiet vs loud audio.';
    case 'boost':
      return 'Visual boost for inspecting quiet audio without normalizing to the loudest peak.';
    case 'db':
      return 'Logarithmic dB-style peak view for low-level detail.';
    default:
      return String(mode);
  }
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

function transcriptSubtitle(job: JobWithSource, progress: number): string {
  if (activeStatuses.includes(job.job.status) || job.job.status === 'paused') {
    return `${statusLabel(job.job.status)} / ${progress}%`;
  }

  if (job.job.status === 'failed') {
    return 'Failed. Check the job error below.';
  }

  if (job.job.status === 'canceled') {
    return 'Canceled';
  }

  return `${formatDuration(job.sourceFile.durationSeconds)} audio`;
}

function exportFormatLabel(format: ExportFormat): string {
  switch (format) {
    case 'txt':
      return 'Text (.txt)';
    case 'srt':
      return 'SubRip subtitles (.srt)';
    case 'vtt':
      return 'WebVTT (.vtt)';
    case 'json':
      return 'JSON (.json)';
    default:
      return String(format).toUpperCase();
  }
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
