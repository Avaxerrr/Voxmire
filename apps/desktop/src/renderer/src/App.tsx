import { type CSSProperties, type FocusEvent as ReactFocusEvent, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type MutableRefObject, type PointerEvent as ReactPointerEvent, type ReactElement, memo, useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  AlertTriangle,
  AudioWaveform,
  ChevronDown,
  CheckCircle2,
  PanelLeftClose,
  PanelLeftOpen,
  Clock3,
  Cpu,
  Download,
  FileAudio,
  FileText,
  FileVideo,
  FolderOpen,
  Home,
  Info,
  Keyboard,
  Lock,
  Maximize2,
  MicVocal,
  Minimize2,
  Minus,
  MoreHorizontal,
  Pause,
  Pencil,
  Play,
  Plus,
  Search,
  Settings,
  SkipBack,
  SkipForward,
  SlidersHorizontal,
  Scissors,
  Merge,
  Sparkles,
  Square,
  Trash2,
  UploadCloud,
  Video,
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
  ExportTextMode,
  JobStatus,
  JobWithSource,
  MachineProfile,
  ModelId,
  ModelProfile,
  ProjectDetails,
  ResourceStatus,
  TranscriptSegment,
  TranscriptSegmentListResult,
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
type MediaKind = 'audio' | 'video';
type WaveformScaleMode = 'actual' | 'boost' | 'db';
type VideoPreviewDock = 'top' | 'side';

type MediaInfo = {
  contentType: string;
  hasAudio: boolean;
  hasVideo: boolean;
  kind: MediaKind;
};

type ExportOption = {
  format: ExportFormat;
  label: string;
  textMode?: ExportTextMode;
};

const exportOptions: ExportOption[] = [
  { format: 'txt', label: 'Text only', textMode: 'plain' },
  { format: 'txt', label: 'Text with timestamps', textMode: 'timestamps' },
  { format: 'srt', label: 'SubRip captions' },
  { format: 'vtt', label: 'WebVTT captions' },
  { format: 'json', label: 'JSON data' }
];
const activeStatuses: JobStatus[] = ['queued', 'preparing', 'transcribing'];
const waveformScaleModes: WaveformScaleMode[] = ['actual', 'boost', 'db'];
const playbackSpeeds = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;
const playbackSyncIntervalMs = 250;
const audioSeekThrottleMs = 50;
const videoSeekThrottleMs = 140;
const videoPreviewPreferenceKey = 'voxmire:videoPreviewPreference';
const defaultVideoPreviewWidth = 320;
const minVideoPreviewWidth = 180;
const maxTopVideoPreviewWidth = 420;
const maxSideVideoPreviewWidth = 360;
const sidePreviewBreakpoint = 1180;
const transcriptShortcuts = [
  { keys: 'Enter', action: 'Split segment at the cursor' },
  { keys: 'Shift+Enter', action: 'Insert a line break inside the segment' },
  { keys: 'Backspace', action: 'At segment start, merge with previous' },
  { keys: 'Delete', action: 'At segment end, merge with next' },
  { keys: 'Tab', action: 'Save and move to next segment' },
  { keys: 'Shift+Tab', action: 'Save and move to previous segment' },
  { keys: 'Esc', action: 'Cancel the active edit' },
  { keys: 'Ctrl/Cmd+S', action: 'Save the active segment' }
];

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
  const [detailsJobId, setDetailsJobId] = useState<string | null>(null);
  const [details, setDetails] = useState<ProjectDetails | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [renameTarget, setRenameTarget] = useState<JobWithSource | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<JobWithSource | null>(null);
  const [projectBusy, setProjectBusy] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [exportDirectory, setExportDirectory] = useState<string | null>(null);
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
    if (!detailsJobId || !api) {
      setDetails(null);
      setDetailsLoading(false);
      return;
    }

    let canceled = false;
    setDetailsLoading(true);
    void api.projects.getDetails(detailsJobId)
      .then((projectDetails) => {
        if (!canceled) {
          setDetails(projectDetails);
        }
      })
      .catch((error) => {
        if (!canceled) {
          setDetails(null);
          setMessage(error instanceof Error ? error.message : 'Failed to load project details.');
        }
      })
      .finally(() => {
        if (!canceled) {
          setDetailsLoading(false);
        }
      });

    return () => {
      canceled = true;
    };
  }, [api, detailsJobId]);

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

    const [info, engineAvailability, modelProfiles, resourceStatus, detectedMachineProfile, jobList, resolvedExportDirectory] = await Promise.all([
      api.app.getInfo(),
      api.system.getEngineAvailability(),
      api.models.list(),
      api.system.getResourceStatus(),
      api.system.getMachineProfile(),
      api.jobs.list(),
      api.exports.getDirectory()
    ]);

    setAppInfo(info);
    setEngines(engineAvailability);
    setModels(modelProfiles);
    setResources(resourceStatus);
    setMachineProfile(detectedMachineProfile);
    setSelectedPresetId(selectUsablePreset(detectedMachineProfile.recommendedModelId, resourceStatus));
    setJobs(jobList);
    setSelectedJobId(jobList[0]?.job.id ?? null);
    setExportDirectory(resolvedExportDirectory);
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

  async function exportTranscript(format: ExportFormat, textMode: ExportTextMode = 'plain'): Promise<void> {
    if (!selectedJob) {
      return;
    }

    try {
      if (!api) {
        setMessage('Desktop bridge unavailable.');
        return;
      }

      const result = await api.exports.create(selectedJob.job.id, format, textMode);
      if (!result) {
        setMessage('Export canceled.');
        return;
      }

      setExportDirectory(extractDirectoryPath(result.path));
      setMessage(`Exported ${exportResultLabel(result.format, result.textMode)} to ${result.path}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : `Failed to export ${format}.`);
    }
  }

  async function chooseExportDirectory(): Promise<void> {
    if (!api) {
      setMessage('Desktop bridge unavailable.');
      return;
    }

    const selectedDirectory = await api.exports.chooseDirectory();
    if (selectedDirectory) {
      setExportDirectory(selectedDirectory);
      setMessage(`Default export folder set to ${selectedDirectory}`);
    }
  }

  async function resetExportDirectory(): Promise<void> {
    if (!api) {
      setMessage('Desktop bridge unavailable.');
      return;
    }

    const defaultDirectory = await api.exports.resetDirectory();
    setExportDirectory(defaultDirectory);
    setMessage(`Default export folder reset to ${defaultDirectory}`);
  }

  async function updateTranscriptSegment(segmentId: string, text: string): Promise<TranscriptSegment | null> {
    if (!selectedJob) {
      return null;
    }

    if (!api) {
      setMessage('Desktop bridge unavailable.');
      return null;
    }

    try {
      const updatedSegment = await api.transcripts.updateSegment(selectedJob.job.id, segmentId, text);
      if (!updatedSegment) {
        setMessage('Transcript segment not found.');
        return null;
      }

      setSegments((currentSegments) =>
        currentSegments.map((segment) => (segment.id === updatedSegment.id ? updatedSegment : segment))
      );
      setMessage('Transcript updated.');
      return updatedSegment;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to update transcript segment.');
      return null;
    }
  }

  async function splitTranscriptSegment(segmentId: string, offset: number): Promise<TranscriptSegment[] | null> {
    if (!selectedJob) {
      return null;
    }

    if (!api) {
      setMessage('Desktop bridge unavailable.');
      return null;
    }

    try {
      const updatedSegments = await api.transcripts.splitSegment(selectedJob.job.id, segmentId, offset);
      setSegments(updatedSegments);
      setMessage('Transcript segment split.');
      return updatedSegments;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to split transcript segment.');
      return null;
    }
  }

  async function updateTranscriptSegmentTiming(
    segmentId: string,
    startSeconds: number,
    endSeconds: number
  ): Promise<TranscriptSegmentListResult | null> {
    if (!selectedJob) {
      return null;
    }

    if (!api) {
      setMessage('Desktop bridge unavailable.');
      return null;
    }

    try {
      const result = await api.transcripts.updateTiming(selectedJob.job.id, segmentId, startSeconds, endSeconds);
      setSegments(result.segments);
      setMessage(result.error ?? 'Transcript timing updated.');
      return result;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to update transcript timing.');
      return null;
    }
  }

  async function mergeTranscriptSegment(segmentId: string, direction: 'previous' | 'next'): Promise<TranscriptSegment[] | null> {
    if (!selectedJob) {
      return null;
    }

    if (!api) {
      setMessage('Desktop bridge unavailable.');
      return null;
    }

    try {
      const updatedSegments = await api.transcripts.mergeSegment(selectedJob.job.id, segmentId, direction);
      setSegments(updatedSegments);
      setMessage('Transcript segments merged.');
      return updatedSegments;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to merge transcript segments.');
      return null;
    }
  }

  function openProjectDetails(jobId: string): void {
    setDetailsJobId(jobId);
  }

  async function renameProject(jobId: string, name: string): Promise<void> {
    const nextName = name.trim();
    if (!nextName) {
      setMessage('Project name cannot be empty.');
      return;
    }

    if (!api) {
      setMessage('Desktop bridge unavailable.');
      return;
    }

    setProjectBusy(true);
    try {
      const renamed = await api.projects.rename(jobId, nextName);
      if (!renamed) {
        setMessage('Project not found.');
        return;
      }

      const updated = await api.jobs.list();
      setJobs(updated);
      if (detailsJobId === jobId) {
        setDetails(await api.projects.getDetails(jobId));
      }
      setRenameTarget(null);
      setMessage('Project renamed.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to rename project.');
    } finally {
      setProjectBusy(false);
    }
  }

  async function deleteProject(jobId: string): Promise<void> {
    if (!api) {
      setMessage('Desktop bridge unavailable.');
      return;
    }

    setProjectBusy(true);
    try {
      const result = await api.projects.delete(jobId);
      if (!result.deleted) {
        setMessage('Project not found.');
        return;
      }

      const updated = await api.jobs.list();
      const nextSelectedId =
        selectedJobIdRef.current === jobId
          ? updated[0]?.job.id ?? null
          : selectedJobIdRef.current;
      setJobs(updated);
      setSelectedJobId(nextSelectedId);
      if (selectedJobIdRef.current === jobId) {
        setSegments([]);
        setPlaying(false);
        if (!nextSelectedId) {
          setView('dashboard');
        }
      }
      if (detailsJobId === jobId) {
        setDetailsJobId(null);
      }
      setDeleteTarget(null);
      setMessage('Project deleted. Original media file was not deleted.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to delete project.');
    } finally {
      setProjectBusy(false);
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
            onDeleteProject={setDeleteTarget}
            onDetailsProject={openProjectDetails}
            onImport={() => setImportOpen(true)}
            onOpenJob={openJob}
            onOpenVoice={() => setView('voice')}
            onRenameProject={setRenameTarget}
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
            onDeleteProject={setDeleteTarget}
            onDetailsProject={openProjectDetails}
            onImport={() => setImportOpen(true)}
            onPause={pauseJob}
            onRenameProject={setRenameTarget}
            onResume={resumeJob}
            onSelectJob={setSelectedJobId}
            playing={playing}
            selectedJob={selectedJob}
            segments={segments}
            setPlaying={setPlaying}
            splitSegment={splitTranscriptSegment}
            mergeSegment={mergeTranscriptSegment}
            updateSegmentTiming={updateTranscriptSegmentTiming}
            updateSegment={updateTranscriptSegment}
          />
        ) : null}

        {view === 'voice' ? <VoiceStudioView /> : null}

        {view === 'settings' ? (
          <SettingsView
            appInfo={appInfo}
            engines={engines}
            exportDirectory={exportDirectory}
            machineProfile={machineProfile}
            models={models}
            onChooseExportDirectory={() => void chooseExportDirectory()}
            onResetExportDirectory={() => void resetExportDirectory()}
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

      {detailsJobId ? (
        <ProjectDetailsDrawer
          details={details}
          loading={detailsLoading}
          onClose={() => setDetailsJobId(null)}
          onDelete={(project) => setDeleteTarget(project)}
          onRename={(project) => setRenameTarget(project)}
        />
      ) : null}

      {renameTarget ? (
        <RenameProjectModal
          busy={projectBusy}
          project={renameTarget}
          onClose={() => setRenameTarget(null)}
          onRename={renameProject}
        />
      ) : null}

      {deleteTarget ? (
        <DeleteProjectModal
          busy={projectBusy}
          project={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onDelete={deleteProject}
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
  onDeleteProject: (project: JobWithSource) => void;
  onDetailsProject: (jobId: string) => void;
  onImport: () => void;
  onOpenJob: (jobId: string) => void;
  onOpenVoice: () => void;
  onRenameProject: (project: JobWithSource) => void;
  selectedBackend: EngineBackend;
  selectedModel: ModelProfile | null;
};

function DashboardView({
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
type TranscriptViewProps = {
  busy: boolean;
  exportTranscript: (format: ExportFormat, textMode?: ExportTextMode) => Promise<void>;
  jobs: JobWithSource[];
  onCancel: (jobId: string) => Promise<void>;
  onBrowseLibrary: () => void;
  onDeleteProject: (project: JobWithSource) => void;
  onDetailsProject: (jobId: string) => void;
  onImport: () => void;
  onPause: (jobId: string) => Promise<void>;
  onRenameProject: (project: JobWithSource) => void;
  onResume: (jobId: string) => Promise<void>;
  onSelectJob: (jobId: string) => void;
  playing: boolean;
  selectedJob: JobWithSource | null;
  segments: TranscriptSegment[];
  setPlaying: (playing: boolean) => void;
  splitSegment: (segmentId: string, offset: number) => Promise<TranscriptSegment[] | null>;
  mergeSegment: (segmentId: string, direction: 'previous' | 'next') => Promise<TranscriptSegment[] | null>;
  updateSegmentTiming: (segmentId: string, startSeconds: number, endSeconds: number) => Promise<TranscriptSegmentListResult | null>;
  updateSegment: (segmentId: string, text: string) => Promise<TranscriptSegment | null>;
};

function TranscriptView({
  busy,
  exportTranscript,
  jobs,
  onCancel,
  onBrowseLibrary,
  onDeleteProject,
  onDetailsProject,
  onImport,
  onPause,
  onRenameProject,
  onResume,
  onSelectJob,
  playing,
  selectedJob,
  segments,
  setPlaying,
  splitSegment,
  mergeSegment,
  updateSegmentTiming,
  updateSegment,
}: TranscriptViewProps): ReactElement {
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [switcherQuery, setSwitcherQuery] = useState('');
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [findPanelOpen, setFindPanelOpen] = useState(false);
  const [findQuery, setFindQuery] = useState('');
  const [replacePanelOpen, setReplacePanelOpen] = useState(false);
  const [replaceQuery, setReplaceQuery] = useState('');
  const [activeFindIndex, setActiveFindIndex] = useState(0);
  const [replacingText, setReplacingText] = useState(false);
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [mediaInfo, setMediaInfo] = useState<MediaInfo | null>(null);
  const [playbackTime, setPlaybackTime] = useState(0);
  const [playbackDuration, setPlaybackDuration] = useState<number | null>(null);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [externalSeekSignal, setExternalSeekSignal] = useState(0);
  const [videoPreviewHidden, setVideoPreviewHidden] = useState(() => loadVideoPreviewPreference().hidden);
  const [videoPreviewDock, setVideoPreviewDock] = useState<VideoPreviewDock>(() => loadVideoPreviewPreference().dock);
  const [videoPreviewWidth, setVideoPreviewWidth] = useState(() => loadVideoPreviewPreference().width);
  const [viewportSize, setViewportSize] = useState(() => ({ height: window.innerHeight, width: window.innerWidth }));
  const [waveformPeaks, setWaveformPeaks] = useState<number[]>([]);
  const [waveformLoading, setWaveformLoading] = useState(false);
  const exportMenuRef = useRef<HTMLDivElement | null>(null);
  const audioRef = useRef<HTMLMediaElement | null>(null);
  const mediaApi = window.voxmire?.media;
  const progress = selectedJob ? Math.round(selectedJob.job.progress * 100) : 0;
  const isCancelable = selectedJob ? activeStatuses.includes(selectedJob.job.status) || selectedJob.job.status === 'paused' : false;
  const isPausable = selectedJob ? activeStatuses.includes(selectedJob.job.status) : false;
  const isResumable = selectedJob?.job.status === 'paused';
  const isWorking = selectedJob ? activeStatuses.includes(selectedJob.job.status) : false;
  const selectedMediaKind = selectedJob ? mediaInfo?.kind ?? mediaKindFromExtension(selectedJob.sourceFile.extension) : 'audio';
  const selectedSubtitle = selectedJob ? transcriptSubtitle(selectedJob, progress, selectedMediaKind) : 'Choose a project from Library or import a recording.';
  const activeSegmentIndex = useMemo(() => findActiveSegmentIndex(segments, playbackTime), [playbackTime, segments]);
  const resolvedPlaybackDuration = playbackDuration ?? selectedJob?.sourceFile.durationSeconds ?? null;
  const visibleJobs = useMemo(() => {
    const query = switcherQuery.trim().toLowerCase();

    if (!query) {
      return jobs;
    }

    return jobs.filter((entry) => entry.sourceFile.name.toLowerCase().includes(query));
  }, [jobs, switcherQuery]);
  const findMatchCount = useMemo(() => countTranscriptMatches(segments, findQuery), [findQuery, segments]);
  const findMatchIndexes = useMemo(() => findTranscriptMatchIndexes(segments, findQuery), [findQuery, segments]);
  const activeFindSegment = findMatchIndexes.length > 0 ? segments[findMatchIndexes[Math.min(activeFindIndex, findMatchIndexes.length - 1)] ?? -1] ?? null : null;

  useEffect(() => {
    setActiveFindIndex(0);
  }, [findQuery]);

  useEffect(() => {
    if (!switcherOpen && !exportMenuOpen && !findPanelOpen) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        setSwitcherOpen(false);
        setExportMenuOpen(false);
        setFindPanelOpen(false);
        setReplacePanelOpen(false);
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
  }, [exportMenuOpen, findPanelOpen, switcherOpen]);

  useEffect(() => {
    function handleResize(): void {
      setViewportSize({ height: window.innerHeight, width: window.innerWidth });
    }

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    saveVideoPreviewPreference({ dock: videoPreviewDock, hidden: videoPreviewHidden, width: videoPreviewWidth });
  }, [videoPreviewDock, videoPreviewHidden, videoPreviewWidth]);

  useEffect(() => {
    let canceled = false;

    setPlaying(false);
    setPlaybackTime(0);
    setPlaybackDuration(null);
    setMediaError(null);
    setMediaInfo(null);
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
      setMediaError('Media playback is available in the desktop app.');
      return () => {
        canceled = true;
      };
    }

    void mediaApi.getInfo(selectedJob.job.id)
      .then((info) => {
        if (!canceled) {
          setMediaInfo(info);
        }
      })
      .catch(() => {
        if (!canceled) {
          setMediaInfo(null);
        }
      });

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
          setMediaError('Media source could not be prepared.');
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
    setExternalSeekSignal((value) => value + 1);
    if (audio) {
      applyMediaSeek(audio, nextTime, false);
    }
  }

  function jumpToFindMatch(direction: 'previous' | 'next'): void {
    if (findMatchIndexes.length === 0) {
      return;
    }

    const nextIndex =
      direction === 'next'
        ? (activeFindIndex + 1) % findMatchIndexes.length
        : (activeFindIndex - 1 + findMatchIndexes.length) % findMatchIndexes.length;
    const segment = segments[findMatchIndexes[nextIndex] ?? -1];
    setActiveFindIndex(nextIndex);
    if (segment) {
      seekToSegment(segment);
    }
  }

  function toggleFindPanel(): void {
    if (findPanelOpen) {
      setReplacePanelOpen(false);
    }

    setFindPanelOpen((open) => !open);
  }

  async function replaceAllTranscriptMatches(): Promise<void> {
    const query = findQuery.trim();
    if (!query || replacingText) {
      return;
    }

    const matcher = new RegExp(escapeRegExp(query), 'gi');
    const matchingSegments = segments.filter((segment) => {
      matcher.lastIndex = 0;
      return matcher.test(segment.text);
    });
    if (matchingSegments.length === 0) {
      return;
    }

    setReplacingText(true);
    try {
      for (const segment of matchingSegments) {
        matcher.lastIndex = 0;
        const nextText = segment.text.replace(matcher, replaceQuery);
        if (nextText !== segment.text) {
          await updateSegment(segment.id, nextText);
        }
      }
    } finally {
      setReplacingText(false);
    }
  }

  return (
    <div className="view transcript-view">
      <header className="transcript-topbar glass-bar">
        <div className="title-stack">
          <p className="eyebrow">Transcript</p>
          <div className="transcript-title-row">
            <h2 className="transcript-title-heading">
              <button
                aria-expanded={switcherOpen}
                aria-haspopup="dialog"
                aria-label="Switch transcript"
                className={`transcript-title-switcher ${switcherOpen ? 'active' : ''}`}
                disabled={jobs.length === 0}
                onClick={() => setSwitcherOpen((open) => !open)}
                title="Switch transcript"
                type="button"
              >
                <span className="transcript-title-text">{selectedJob?.sourceFile.name ?? 'No transcript selected'}</span>
                <ChevronDown size={16} />
              </button>
            </h2>
            {selectedJob ? (
              <ProjectActionsMenu
                onDelete={() => onDeleteProject(selectedJob)}
                onDetails={() => onDetailsProject(selectedJob.job.id)}
                onRename={() => onRenameProject(selectedJob)}
              />
            ) : null}
          </div>
          <span>{selectedSubtitle}</span>
        </div>

        <div className="transcript-actions">
          <button
            aria-expanded={findPanelOpen}
            aria-label="Find and replace transcript"
            className={`icon-button ${findPanelOpen ? 'active' : ''}`}
            onClick={toggleFindPanel}
            title="Find and replace"
            type="button"
          >
            <Search size={17} />
          </button>
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
                {exportOptions.map((option) => (
                  <button
                    key={`${option.format}-${option.textMode ?? 'default'}`}
                    onClick={() => {
                      setExportMenuOpen(false);
                      void exportTranscript(option.format, option.textMode ?? 'plain');
                    }}
                    role="menuitem"
                    type="button"
                  >
                    <Download size={14} />
                    <span>{option.label}</span>
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

        {findPanelOpen ? (
          <div className="find-replace-panel">
            <label className="search-field compact-find-field">
              <Search size={14} />
              <input
                aria-label="Find transcript text"
                onChange={(event) => setFindQuery(event.target.value)}
                placeholder="Find"
                type="search"
                value={findQuery}
              />
            </label>
            <div className="find-nav-controls" aria-label="Find result navigation">
              <button
                aria-label="Previous match"
                disabled={findMatchIndexes.length === 0}
                onClick={() => jumpToFindMatch('previous')}
                type="button"
              >
                <SkipBack size={14} />
              </button>
              <button
                aria-label="Next match"
                disabled={findMatchIndexes.length === 0}
                onClick={() => jumpToFindMatch('next')}
                type="button"
              >
                <SkipForward size={14} />
              </button>
            </div>
            <span className="find-count">{findQuery.trim() ? `${findMatchIndexes.length === 0 ? 0 : activeFindIndex + 1}/${findMatchCount}` : 'Find text'}</span>
            <button
              aria-expanded={replacePanelOpen}
              className={`secondary-action replace-toggle ${replacePanelOpen ? 'active' : ''}`}
              onClick={() => setReplacePanelOpen((open) => !open)}
              type="button"
            >
              <Pencil size={14} />
              Replace
            </button>
            {replacePanelOpen ? (
              <>
                <input
                  aria-label="Replace transcript text"
                  className="replace-field"
                  onChange={(event) => setReplaceQuery(event.target.value)}
                  placeholder="Replace"
                  type="text"
                  value={replaceQuery}
                />
                <button
                  className="secondary-action"
                  disabled={!findQuery.trim() || findMatchCount === 0 || replacingText}
                  onClick={() => void replaceAllTranscriptMatches()}
                  type="button"
                >
                  Replace all
                </button>
              </>
            ) : null}
          </div>
        ) : null}

        <div className="transcript-main">
          <section className={'transcript-stage ' + (selectedMediaKind === 'video' && mediaUrl ? 'has-video-preview preview-' + (videoPreviewHidden ? 'hidden' : videoPreviewDock) : '')}>
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
                {selectedMediaKind === 'video' && mediaUrl ? (
                  <div className={'transcript-content-with-preview ' + (videoPreviewHidden ? 'hidden' : videoPreviewDock)}>
                    {videoPreviewHidden ? (
                      <button className="show-video-preview" onClick={() => setVideoPreviewHidden(false)} type="button">
                        <Video size={14} />
                        Show video preview
                      </button>
                    ) : null}
                    <VideoPreview
                      currentTime={playbackTime}
                      dock={videoPreviewDock}
                      duration={resolvedPlaybackDuration}
                      hidden={videoPreviewHidden}
                      mediaRef={audioRef}
                      mediaUrl={mediaUrl}
                      onDurationChange={setPlaybackDuration}
                      onError={setMediaError}
                      onHide={() => setVideoPreviewHidden(true)}
                      onTimeChange={setPlaybackTime}
                      onWidthChange={setVideoPreviewWidth}
                      playbackSpeed={playbackSpeed}
                      playing={playing}
                      setDock={setVideoPreviewDock}
                      setPlaying={setPlaying}
                      viewportHeight={viewportSize.height}
                      viewportWidth={viewportSize.width}
                      width={videoPreviewWidth}
                    />
                    {segments.length === 0 ? (
                      <EmptyState title="Transcript pending" body="Transcript text will appear here as the job progresses." />
                    ) : (
                      <VirtualizedSegmentList
                        activeSegmentIndex={activeSegmentIndex}
                        onMergeSegment={mergeSegment}
                        onSeek={seekToSegment}
                        onSplitSegment={splitSegment}
                        onUpdateTiming={updateSegmentTiming}
                        onUpdateSegment={updateSegment}
                        activeSearchSegmentId={activeFindSegment?.id ?? null}
                        playbackTime={playbackTime}
                        searchQuery={findQuery}
                        segments={segments}
                      />
                    )}
                  </div>
                ) : segments.length === 0 ? (
                  <EmptyState title="Transcript pending" body="Transcript text will appear here as the job progresses." />
                ) : (
                  <VirtualizedSegmentList
                    activeSegmentIndex={activeSegmentIndex}
                    onMergeSegment={mergeSegment}
                    onSeek={seekToSegment}
                    onSplitSegment={splitSegment}
                    onUpdateTiming={updateSegmentTiming}
                    onUpdateSegment={updateSegment}
                    activeSearchSegmentId={activeFindSegment?.id ?? null}
                    playbackTime={playbackTime}
                    searchQuery={findQuery}
                    segments={segments}
                  />
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
            externalSeekSignal={externalSeekSignal}
            mediaError={mediaError}
            mediaKind={selectedMediaKind}
            mediaUrl={mediaUrl}
            onDurationChange={setPlaybackDuration}
            onError={setMediaError}
            onTimeChange={setPlaybackTime}
            playbackSpeed={playbackSpeed}
            playing={playing}
            setPlaybackSpeed={setPlaybackSpeed}
            waveformLoading={waveformLoading}
            waveformPeaks={waveformPeaks}
            setPlaying={setPlaying}
          />
        </div>
      </section>
    </div>
  );
}

type ProjectActionsMenuProps = {
  onDelete: () => void;
  onDetails: () => void;
  onRename: () => void;
};

function ProjectInlineActions({ onDelete, onDetails, onRename }: ProjectActionsMenuProps): ReactElement {
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

function ProjectActionsMenu({ onDelete, onDetails, onRename }: ProjectActionsMenuProps): ReactElement {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    }

    function handlePointerDown(event: MouseEvent): void {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('mousedown', handlePointerDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('mousedown', handlePointerDown);
    };
  }, [open]);

  return (
    <div className="project-action-menu" ref={menuRef}>
      <button
        aria-expanded={open}
        aria-label="Project actions"
        className={`icon-button project-action-trigger ${open ? 'active' : ''}`}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((current) => !current);
        }}
        title="Project actions"
        type="button"
      >
        <MoreHorizontal size={16} />
      </button>
      {open ? (
        <div className="project-action-popover" role="menu">
          <button
            onClick={() => {
              setOpen(false);
              onDetails();
            }}
            role="menuitem"
            type="button"
          >
            <Info size={14} />
            <span>Details</span>
          </button>
          <button
            onClick={() => {
              setOpen(false);
              onRename();
            }}
            role="menuitem"
            type="button"
          >
            <Pencil size={14} />
            <span>Rename</span>
          </button>
          <button
            className="danger-menu-item"
            onClick={() => {
              setOpen(false);
              onDelete();
            }}
            role="menuitem"
            type="button"
          >
            <Trash2 size={14} />
            <span>Delete project</span>
          </button>
        </div>
      ) : null}
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
  exportDirectory: string | null;
  machineProfile: MachineProfile | null;
  models: ModelProfile[];
  onChooseExportDirectory: () => void;
  onResetExportDirectory: () => void;
  resources: ResourceStatus[];
  selectedPresetId: TranscriptionPresetId;
  selectedPresetResolution: ResolvedTranscriptionPreset;
  setSelectedPresetId: (presetId: TranscriptionPresetId) => void;
};

function SettingsView({ appInfo, engines, exportDirectory, machineProfile, models, onChooseExportDirectory, onResetExportDirectory, resources, selectedPresetId, selectedPresetResolution, setSelectedPresetId }: SettingsViewProps): ReactElement {
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
            <Keyboard size={18} />
            <div>
              <h3>Transcript shortcuts</h3>
              <p>Keyboard controls available while editing transcript text.</p>
            </div>
          </div>
          <div className="shortcut-grid">
            {transcriptShortcuts.map((shortcut) => (
              <div className="shortcut-row" key={shortcut.keys}>
                <kbd>{shortcut.keys}</kbd>
                <span>{shortcut.action}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="settings-panel panel-glow">
          <div className="settings-panel-heading">
            <FolderOpen size={18} />
            <div>
              <h3>Export folder</h3>
              <p>Choose the folder used as the starting location for export Save dialogs.</p>
            </div>
          </div>
          <div className="export-folder-setting">
            <p>{exportDirectory ?? 'Default export folder unavailable.'}</p>
            <div>
              <button className="secondary-action" onClick={onChooseExportDirectory} type="button">Change folder</button>
              <button className="secondary-action" onClick={onResetExportDirectory} type="button">Reset</button>
            </div>
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

type ProjectDetailsDrawerProps = {
  details: ProjectDetails | null;
  loading: boolean;
  onClose: () => void;
  onDelete: (project: JobWithSource) => void;
  onRename: (project: JobWithSource) => void;
};

function ProjectDetailsDrawer({ details, loading, onClose, onDelete, onRename }: ProjectDetailsDrawerProps): ReactElement {
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

function RenameProjectModal({ busy, project, onClose, onRename }: RenameProjectModalProps): ReactElement {
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

function DeleteProjectModal({ busy, project, onClose, onDelete }: DeleteProjectModalProps): ReactElement {
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

type VirtualizedSegmentListProps = {
  activeSegmentIndex: number;
  onMergeSegment: (segmentId: string, direction: 'previous' | 'next') => Promise<TranscriptSegment[] | null>;
  onSeek: (segment: TranscriptSegment) => void;
  onSplitSegment: (segmentId: string, offset: number) => Promise<TranscriptSegment[] | null>;
  onUpdateTiming: (segmentId: string, startSeconds: number, endSeconds: number) => Promise<TranscriptSegmentListResult | null>;
  onUpdateSegment: (segmentId: string, text: string) => Promise<TranscriptSegment | null>;
  activeSearchSegmentId: string | null;
  playbackTime: number;
  searchQuery: string;
  segments: TranscriptSegment[];
};

function VirtualizedSegmentList({
  activeSegmentIndex,
  onMergeSegment,
  onSeek,
  onSplitSegment,
  onUpdateTiming,
  onUpdateSegment,
  activeSearchSegmentId,
  playbackTime,
  searchQuery,
  segments
}: VirtualizedSegmentListProps): ReactElement {
  const [editingSegmentId, setEditingSegmentId] = useState<string | null>(null);
  const [draftText, setDraftText] = useState('');
  const [savingSegmentId, setSavingSegmentId] = useState<string | null>(null);
  const [savingTimingSegmentId, setSavingTimingSegmentId] = useState<string | null>(null);
  const [saveErrorSegmentId, setSaveErrorSegmentId] = useState<string | null>(null);
  const [cursorOffset, setCursorOffset] = useState(0);
  const scrollParentRef = useRef<HTMLDivElement | null>(null);
  const rowVirtualizer = useVirtualizer({
    count: segments.length,
    estimateSize: () => 108,
    getItemKey: (index) => segments[index]?.id ?? index,
    getScrollElement: () => scrollParentRef.current,
    overscan: 8
  });

  useEffect(() => {
    if (activeSegmentIndex >= 0 && !editingSegmentId) {
      rowVirtualizer.scrollToIndex(activeSegmentIndex, { align: 'center' });
    }
  }, [activeSegmentIndex, editingSegmentId]);

  useEffect(() => {
    if (!activeSearchSegmentId) {
      return;
    }

    const index = segments.findIndex((segment) => segment.id === activeSearchSegmentId);
    if (index >= 0) {
      rowVirtualizer.scrollToIndex(index, { align: 'center' });
    }
  }, [activeSearchSegmentId, segments]);

  function startEditing(segment: TranscriptSegment): void {
    setSaveErrorSegmentId(null);
    setEditingSegmentId(segment.id);
    setDraftText(segment.text);
    setCursorOffset(segment.text.length);
    onSeek(segment);
  }

  function cancelEditing(): void {
    setEditingSegmentId(null);
    setDraftText('');
    setCursorOffset(0);
  }

  async function saveSegmentText(segment: TranscriptSegment, nextText: string): Promise<boolean> {
    const normalizedText = nextText.trimEnd();
    if (normalizedText === segment.text) {
      setSaveErrorSegmentId(null);
      return true;
    }

    setSavingSegmentId(segment.id);
    setSaveErrorSegmentId(null);
    try {
      const updated = await onUpdateSegment(segment.id, normalizedText);
      if (!updated) {
        setSaveErrorSegmentId(segment.id);
        return false;
      }

      return true;
    } finally {
      setSavingSegmentId(null);
    }
  }

  async function saveAndClose(segment: TranscriptSegment, nextText: string): Promise<void> {
    const saved = await saveSegmentText(segment, nextText);
    if (saved && editingSegmentId === segment.id) {
      cancelEditing();
    }
  }

  async function saveAndMoveToNext(segment: TranscriptSegment, nextText: string, currentIndex: number): Promise<boolean> {
    const saved = await saveSegmentText(segment, nextText);
    if (!saved) {
      return false;
    }

    const nextSegment = segments[currentIndex + 1];
    if (!nextSegment) {
      cancelEditing();
      return true;
    }

    setEditingSegmentId(nextSegment.id);
    setDraftText(nextSegment.text);
    setCursorOffset(nextSegment.text.length);
    onSeek(nextSegment);
    rowVirtualizer.scrollToIndex(currentIndex + 1, { align: 'center' });
    return true;
  }

  async function saveAndMoveToPrevious(segment: TranscriptSegment, nextText: string, currentIndex: number): Promise<boolean> {
    const saved = await saveSegmentText(segment, nextText);
    if (!saved) {
      return false;
    }

    const previousSegment = segments[currentIndex - 1];
    if (!previousSegment) {
      return true;
    }

    setEditingSegmentId(previousSegment.id);
    setDraftText(previousSegment.text);
    setCursorOffset(previousSegment.text.length);
    onSeek(previousSegment);
    rowVirtualizer.scrollToIndex(currentIndex - 1, { align: 'center' });
    return true;
  }

  async function splitSegment(segment: TranscriptSegment, offset: number, currentIndex: number): Promise<void> {
    const text = segment.id === editingSegmentId ? draftText : segment.text;
    const saved = await saveSegmentText(segment, text);
    if (!saved) {
      return;
    }

    const splitOffset = Math.max(1, Math.min(offset, text.trimEnd().length - 1));
    const updatedSegments = await onSplitSegment(segment.id, splitOffset);
    if (!updatedSegments) {
      setSaveErrorSegmentId(segment.id);
      return;
    }

    const nextSegment = updatedSegments[currentIndex + 1] ?? updatedSegments[currentIndex];
    if (nextSegment) {
      setEditingSegmentId(nextSegment.id);
      setDraftText(nextSegment.text);
      setCursorOffset(0);
      onSeek(nextSegment);
      rowVirtualizer.scrollToIndex(Math.min(currentIndex + 1, updatedSegments.length - 1), { align: 'center' });
    }
  }

  async function mergeSegment(segment: TranscriptSegment, direction: 'previous' | 'next', currentIndex: number): Promise<void> {
    const text = segment.id === editingSegmentId ? draftText : segment.text;
    const saved = await saveSegmentText(segment, text);
    if (!saved) {
      return;
    }

    const updatedSegments = await onMergeSegment(segment.id, direction);
    if (!updatedSegments) {
      setSaveErrorSegmentId(segment.id);
      return;
    }

    const nextIndex = direction === 'previous' ? Math.max(currentIndex - 1, 0) : currentIndex;
    const mergedSegment = updatedSegments[nextIndex];
    if (mergedSegment) {
      setEditingSegmentId(mergedSegment.id);
      setDraftText(mergedSegment.text);
      setCursorOffset(mergedSegment.text.length);
      onSeek(mergedSegment);
      rowVirtualizer.scrollToIndex(nextIndex, { align: 'center' });
    }
  }

  async function saveSegmentTiming(segment: TranscriptSegment, startSeconds: number, endSeconds: number): Promise<boolean> {
    if (startSeconds === segment.startSeconds && endSeconds === segment.endSeconds) {
      setSaveErrorSegmentId(null);
      return true;
    }

    setSavingTimingSegmentId(segment.id);
    setSaveErrorSegmentId(null);
    try {
      const result = await onUpdateTiming(segment.id, startSeconds, endSeconds);
      if (!result || result.error) {
        setSaveErrorSegmentId(segment.id);
        return false;
      }

      return true;
    } finally {
      setSavingTimingSegmentId(null);
    }
  }

  useEffect(() => {
    if (!editingSegmentId) {
      return;
    }

    const segment = segments.find((candidate) => candidate.id === editingSegmentId);
    if (!segment || draftText.trimEnd() === segment.text || savingSegmentId === editingSegmentId) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      void saveSegmentText(segment, draftText);
    }, 1200);

    return () => window.clearTimeout(timeoutId);
  }, [draftText, editingSegmentId, savingSegmentId, segments]);

  return (
    <div className="segment-list virtualized" ref={scrollParentRef}>
      <div className="segment-list-inner" style={{ height: `${rowVirtualizer.getTotalSize()}px` }}>
        {rowVirtualizer.getVirtualItems().map((virtualRow) => {
          const segment = segments[virtualRow.index];
          if (!segment) {
            return null;
          }

          const active = virtualRow.index === activeSegmentIndex;
          const editing = segment.id === editingSegmentId;
          const saving = segment.id === savingSegmentId;
          const savingTiming = segment.id === savingTimingSegmentId;
          const saveError = segment.id === saveErrorSegmentId;
          const searchMatch = searchQuery.trim() ? segment.text.toLowerCase().includes(searchQuery.trim().toLowerCase()) : false;
          const activeSearchMatch = segment.id === activeSearchSegmentId;
          const playbackWordRange = active ? currentPlaybackWordRange(segment, playbackTime) : null;

          return (
            <div
              className="segment-virtual-row"
              data-index={virtualRow.index}
              key={virtualRow.key}
              ref={rowVirtualizer.measureElement}
              style={{ transform: `translateY(${virtualRow.start}px)` }}
            >
              <EditableSegmentRow
                active={active}
                searchMatch={searchMatch}
                activeSearchMatch={activeSearchMatch}
                canMergeNext={virtualRow.index < segments.length - 1}
                canMergePrevious={virtualRow.index > 0}
                cursorOffset={cursorOffset}
                draftText={draftText}
                editing={editing}
                onCancel={cancelEditing}
                onDraftChange={setDraftText}
                onCursorOffsetChange={setCursorOffset}
                onFocus={() => startEditing(segment)}
                onMergeNext={() => mergeSegment(segment, 'next', virtualRow.index)}
                onMergePrevious={() => mergeSegment(segment, 'previous', virtualRow.index)}
                onSave={(nextText) => saveSegmentText(segment, nextText)}
                onSaveAndClose={(nextText) => saveAndClose(segment, nextText)}
                onSaveAndMoveNext={(nextText) => saveAndMoveToNext(segment, nextText, virtualRow.index)}
                onSaveAndMovePrevious={(nextText) => saveAndMoveToPrevious(segment, nextText, virtualRow.index)}
                onSaveTiming={(startSeconds, endSeconds) => saveSegmentTiming(segment, startSeconds, endSeconds)}
                onSelectSegment={() => onSeek(segment)}
                onSplit={(offset) => splitSegment(segment, offset, virtualRow.index)}
                saveError={saveError}
                saving={saving}
                savingTiming={savingTiming}
                playbackWordRange={playbackWordRange}
                searchQuery={searchQuery}
                segment={segment}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

type EditableSegmentRowProps = {
  active: boolean;
  activeSearchMatch: boolean;
  searchMatch: boolean;
  canMergeNext: boolean;
  canMergePrevious: boolean;
  cursorOffset: number;
  draftText: string;
  editing: boolean;
  onCancel: () => void;
  onCursorOffsetChange: (offset: number) => void;
  onDraftChange: (text: string) => void;
  onFocus: () => void;
  onMergeNext: () => Promise<void>;
  onMergePrevious: () => Promise<void>;
  onSave: (nextText: string) => Promise<boolean>;
  onSaveAndClose: (nextText: string) => Promise<void>;
  onSaveAndMoveNext: (nextText: string) => Promise<boolean>;
  onSaveAndMovePrevious: (nextText: string) => Promise<boolean>;
  onSaveTiming: (startSeconds: number, endSeconds: number) => Promise<boolean>;
  onSelectSegment: () => void;
  onSplit: (offset: number) => Promise<void>;
  playbackWordRange: TextRange | null;
  saveError: boolean;
  saving: boolean;
  savingTiming: boolean;
  searchQuery: string;
  segment: TranscriptSegment;
};

function EditableSegmentRow({
  active,
  activeSearchMatch,
  searchMatch,
  canMergeNext,
  canMergePrevious,
  cursorOffset,
  draftText,
  editing,
  onCancel,
  onCursorOffsetChange,
  onDraftChange,
  onSave,
  onFocus,
  onMergeNext,
  onMergePrevious,
  onSaveAndClose,
  onSaveAndMoveNext,
  onSaveAndMovePrevious,
  onSaveTiming,
  onSelectSegment,
  onSplit,
  playbackWordRange,
  saveError,
  saving,
  savingTiming,
  searchQuery,
  segment
}: EditableSegmentRowProps): ReactElement {
  const textAreaRef = useRef<HTMLTextAreaElement | null>(null);
  const skipBlurSaveRef = useRef(false);
  const activeText = editing ? draftText : segment.text;
  const [startDraft, setStartDraft] = useState(() => formatEditableTime(segment.startSeconds));
  const [endDraft, setEndDraft] = useState(() => formatEditableTime(segment.endSeconds));

  useEffect(() => {
    setStartDraft(formatEditableTime(segment.startSeconds));
    setEndDraft(formatEditableTime(segment.endSeconds));
  }, [segment.endSeconds, segment.startSeconds]);

  useEffect(() => {
    if (!editing) {
      return;
    }

    const textArea = textAreaRef.current;
    if (!textArea) {
      return;
    }

    if (document.activeElement !== textArea) {
      textArea.focus();
      textArea.setSelectionRange(textArea.value.length, textArea.value.length);
    }
  }, [editing]);

  useEffect(() => {
    const textArea = textAreaRef.current;
    if (!textArea) {
      return;
    }

    textArea.style.height = 'auto';
    textArea.style.height = `${textArea.scrollHeight}px`;
  }, [draftText, editing, segment.text]);

  function handleEditBlur(event: ReactFocusEvent<HTMLTextAreaElement>): void {
    if (skipBlurSaveRef.current) {
      skipBlurSaveRef.current = false;
      return;
    }

    void onSaveAndClose(event.currentTarget.value);
  }

  function saveTimingDraft(): void {
    const nextStart = parseEditableTime(startDraft);
    const nextEnd = parseEditableTime(endDraft);
    if (nextStart === null || nextEnd === null) {
      return;
    }

    void onSaveTiming(nextStart, nextEnd);
  }

  function handleTimingKeyDown(event: ReactKeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      saveTimingDraft();
      event.currentTarget.blur();
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      setStartDraft(formatEditableTime(segment.startSeconds));
      setEndDraft(formatEditableTime(segment.endSeconds));
      event.currentTarget.blur();
    }
  }

  function handleEditKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>): void {
    const textArea = event.currentTarget;
    const selectionStart = textArea.selectionStart;
    const selectionEnd = textArea.selectionEnd;

    if (event.key === 'Escape') {
      event.preventDefault();
      skipBlurSaveRef.current = true;
      onCancel();
      event.currentTarget.blur();
      return;
    }

    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      void onSave(textArea.value);
      return;
    }

    if (event.key === 'Tab') {
      event.preventDefault();
      skipBlurSaveRef.current = true;
      const move = event.shiftKey ? onSaveAndMovePrevious : onSaveAndMoveNext;
      void move(textArea.value).then((moved) => {
        if (!moved) {
          skipBlurSaveRef.current = false;
        }
      });
      return;
    }

    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      if (selectionStart <= 0 || selectionStart >= textArea.value.trimEnd().length) {
        return;
      }

      skipBlurSaveRef.current = true;
      void onSplit(selectionStart).finally(() => {
        skipBlurSaveRef.current = false;
      });
      return;
    }

    if (event.key === 'Backspace' && selectionStart === 0 && selectionEnd === 0 && canMergePrevious) {
      event.preventDefault();
      runStructureTool(onMergePrevious);
      return;
    }

    if (event.key === 'Delete' && selectionStart === textArea.value.length && selectionEnd === textArea.value.length && canMergeNext) {
      event.preventDefault();
      runStructureTool(onMergeNext);
    }
  }

  function syncCursorOffset(): void {
    const textArea = textAreaRef.current;
    if (textArea) {
      onCursorOffsetChange(textArea.selectionStart);
    }
  }

  function handleStructureToolPointerDown(event: ReactPointerEvent<HTMLButtonElement>): void {
    event.preventDefault();
  }

  function handleSegmentPointerDown(event: ReactPointerEvent<HTMLDivElement>): void {
    if (event.button !== 0 || event.defaultPrevented) {
      return;
    }

    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('.segment-structure-tools')) {
      return;
    }

    onSelectSegment();
  }

  function runStructureTool(action: () => Promise<void>): void {
    skipBlurSaveRef.current = true;
    void action().finally(() => {
      skipBlurSaveRef.current = false;
    });
  }

  const canSplit = editing && activeText.trim().length > 1 && cursorOffset > 0 && cursorOffset < activeText.length;

  return (
    <div className={`segment-row ${active ? 'active' : ''} ${editing ? 'editing' : ''} ${searchMatch ? 'search-match' : ''} ${activeSearchMatch ? 'search-current' : ''} ${segment.editedAt ? 'edited' : ''}`} onPointerDown={handleSegmentPointerDown}>
      <div className="segment-gutter">
        <div
          className="segment-time-editors"
          aria-label="Segment timestamps"
          title={`Seek to ${formatTime(segment.startSeconds)}`}
        >
          <input
            aria-label="Segment start time"
            disabled={savingTiming}
            onBlur={saveTimingDraft}
            onChange={(event) => setStartDraft(event.target.value)}
            onKeyDown={handleTimingKeyDown}
            value={startDraft}
          />
          <span>-</span>
          <input
            aria-label="Segment end time"
            disabled={savingTiming}
            onBlur={saveTimingDraft}
            onChange={(event) => setEndDraft(event.target.value)}
            onKeyDown={handleTimingKeyDown}
            value={endDraft}
          />
        </div>
        <div className="segment-structure-tools">
          <button
            aria-label="Merge with previous segment"
            disabled={!canMergePrevious || saving}
            onClick={() => runStructureTool(onMergePrevious)}
            onPointerDown={handleStructureToolPointerDown}
            title="Merge with previous"
            type="button"
          >
            <Merge size={13} />
          </button>
          <button
            aria-label="Split segment at cursor"
            disabled={!canSplit || saving}
            onClick={() => runStructureTool(() => onSplit(cursorOffset))}
            onPointerDown={handleStructureToolPointerDown}
            title="Split at cursor"
            type="button"
          >
            <Scissors size={13} />
          </button>
          <button
            aria-label="Merge with next segment"
            disabled={!canMergeNext || saving}
            onClick={() => runStructureTool(onMergeNext)}
            onPointerDown={handleStructureToolPointerDown}
            title="Merge with next"
            type="button"
          >
            <Merge size={13} />
          </button>
        </div>
      </div>
      <div className="segment-edit-stack">
        {editing ? (
          <textarea
            aria-label="Transcript segment text"
            className="segment-text-input"
            onBlur={handleEditBlur}
            onChange={(event) => {
              onDraftChange(event.target.value);
              onCursorOffsetChange(event.target.selectionStart);
            }}
            onClick={syncCursorOffset}
            onFocus={onFocus}
            onKeyDown={handleEditKeyDown}
            onKeyUp={syncCursorOffset}
            onSelect={syncCursorOffset}
            ref={textAreaRef}
            spellCheck
            value={activeText}
          />
        ) : (
          <button
            aria-label="Edit transcript segment text"
            className="segment-text-display"
            onClick={onFocus}
            type="button"
          >
            <HighlightedTranscriptText playbackRange={playbackWordRange} query={searchQuery} text={segment.text} />
          </button>
        )}
        <div className={`segment-save-state ${saving ? 'saving' : ''} ${saveError ? 'error' : ''}`} role="status">
          {saveError ? 'Not saved' : saving ? 'Saving' : segment.editedAt ? 'Edited' : ''}
        </div>
      </div>
    </div>
  );
}

type TextRange = {
  start: number;
  end: number;
};

function HighlightedTranscriptText({ playbackRange, query, text }: { playbackRange: TextRange | null; query: string; text: string }): ReactElement {
  const normalizedQuery = query.trim();
  if (!normalizedQuery && !playbackRange) {
    return <>{text}</>;
  }

  const slices = buildHighlightedTextSlices(text, normalizedQuery, playbackRange);

  return (
    <>
      {slices.map((slice) => {
        if (!slice.search && !slice.playback) {
          return slice.text;
        }

        return (
          <mark
            className={`segment-text-highlight ${slice.search ? 'segment-search-hit' : ''} ${slice.playback ? 'segment-playback-word' : ''}`}
            key={`${slice.start}-${slice.end}`}
          >
            {slice.text}
          </mark>
        );
      })}
    </>
  );
}

function currentPlaybackWordRange(segment: TranscriptSegment, playbackTime: number): TextRange | null {
  if (!wordAlignmentUsable(segment) || !Number.isFinite(playbackTime)) {
    return null;
  }

  const wordTimings = segment.wordTimings ?? [];
  const activeWordIndex = wordTimings.findIndex(
    (word) =>
      word.startSeconds <= playbackTime &&
      playbackTime < word.endSeconds &&
      word.startSeconds >= segment.startSeconds &&
      word.endSeconds <= segment.endSeconds
  );

  if (activeWordIndex < 0) {
    return null;
  }

  const ranges = mapWordTimingsToTextRanges(segment.text, wordTimings);
  return ranges[activeWordIndex] ?? null;
}

function wordAlignmentUsable(segment: TranscriptSegment): boolean {
  const status = segment.alignmentStatus ?? (segment.wordTimings && segment.wordTimings.length > 0 ? 'aligned' : 'none');
  return (
    (status === 'aligned' || status === 'partial') &&
    Array.isArray(segment.wordTimings) &&
    segment.wordTimings.length > 0
  );
}

function mapWordTimingsToTextRanges(text: string, wordTimings: NonNullable<TranscriptSegment['wordTimings']>): Array<TextRange | null> {
  const lowerText = text.toLowerCase();
  let cursor = 0;

  return wordTimings.map((word) => {
    const searchText = normalizedWordText(word.text);
    if (!searchText) {
      return null;
    }

    const index = lowerText.indexOf(searchText.toLowerCase(), cursor);
    if (index < 0) {
      return null;
    }

    cursor = index + searchText.length;
    return { start: index, end: cursor };
  });
}

function buildHighlightedTextSlices(text: string, query: string, playbackRange: TextRange | null): Array<TextRange & { text: string; search: boolean; playback: boolean }> {
  const ranges = [
    ...findSearchRanges(text, query).map((range) => ({ ...range, kind: 'search' as const })),
    ...(playbackRange ? [{ ...playbackRange, kind: 'playback' as const }] : [])
  ]
    .filter((range) => range.start >= 0 && range.end > range.start && range.start < text.length)
    .map((range) => ({ ...range, end: Math.min(range.end, text.length) }));

  if (ranges.length === 0) {
    return [{ start: 0, end: text.length, text, search: false, playback: false }];
  }

  const boundaries = new Set([0, text.length]);
  ranges.forEach((range) => {
    boundaries.add(range.start);
    boundaries.add(range.end);
  });

  const orderedBoundaries = [...boundaries].sort((left, right) => left - right);
  const slices: Array<TextRange & { text: string; search: boolean; playback: boolean }> = [];
  for (let index = 0; index < orderedBoundaries.length - 1; index += 1) {
    const start = orderedBoundaries[index] ?? 0;
    const end = orderedBoundaries[index + 1] ?? start;
    if (end <= start) {
      continue;
    }

    slices.push({
      start,
      end,
      text: text.slice(start, end),
      search: ranges.some((range) => range.kind === 'search' && range.start <= start && end <= range.end),
      playback: ranges.some((range) => range.kind === 'playback' && range.start <= start && end <= range.end)
    });
  }

  return slices;
}

function findSearchRanges(text: string, query: string): TextRange[] {
  if (!query) {
    return [];
  }

  const ranges: TextRange[] = [];
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  let cursor = 0;

  while (cursor < text.length) {
    const index = lowerText.indexOf(lowerQuery, cursor);
    if (index < 0) {
      break;
    }

    ranges.push({ start: index, end: index + lowerQuery.length });
    cursor = index + Math.max(1, lowerQuery.length);
  }

  return ranges;
}

function normalizedWordText(value: string): string {
  return value.trim().replace(/^[^\p{L}\p{N}']+|[^\p{L}\p{N}']+$/gu, '');
}

type VideoPreviewProps = {
  currentTime: number;
  dock: VideoPreviewDock;
  duration: number | null;
  hidden: boolean;
  mediaRef: MutableRefObject<HTMLMediaElement | null>;
  mediaUrl: string;
  onDurationChange: (duration: number | null) => void;
  onError: (message: string | null) => void;
  onHide: () => void;
  onTimeChange: (time: number) => void;
  onWidthChange: (width: number) => void;
  playbackSpeed: number;
  playing: boolean;
  setDock: (dock: VideoPreviewDock) => void;
  setPlaying: (playing: boolean) => void;
  viewportHeight: number;
  viewportWidth: number;
  width: number;
};

function VideoPreview({
  currentTime,
  dock,
  duration,
  hidden,
  mediaRef,
  mediaUrl,
  onDurationChange,
  onError,
  onHide,
  onTimeChange,
  onWidthChange,
  playbackSpeed,
  playing,
  setDock,
  setPlaying,
  viewportHeight,
  viewportWidth,
  width
}: VideoPreviewProps): ReactElement {
  const [resizing, setResizing] = useState(false);
  const dragStartXRef = useRef(0);
  const dragStartWidthRef = useRef(width);
  const boundedWidth = clampVideoPreviewWidth(width, dock, viewportWidth, viewportHeight);

  useEffect(() => {
    const nextWidth = clampVideoPreviewWidth(width, dock, viewportWidth, viewportHeight);
    if (nextWidth !== width) {
      onWidthChange(nextWidth);
    }
  }, [dock, onWidthChange, viewportHeight, viewportWidth, width]);

  function beginResize(event: ReactPointerEvent<HTMLButtonElement>): void {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragStartXRef.current = event.clientX;
    dragStartWidthRef.current = boundedWidth;
    setResizing(true);
  }

  function resize(event: ReactPointerEvent<HTMLButtonElement>): void {
    if (!resizing) return;
    event.preventDefault();
    event.stopPropagation();
    onWidthChange(clampVideoPreviewWidth(dragStartWidthRef.current + event.clientX - dragStartXRef.current, dock, viewportWidth, viewportHeight));
  }

  function endResize(event: ReactPointerEvent<HTMLButtonElement>): void {
    event.preventDefault();
    event.stopPropagation();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setResizing(false);
  }

  function resetSize(event: ReactMouseEvent<HTMLButtonElement>): void {
    event.preventDefault();
    event.stopPropagation();
    onWidthChange(clampVideoPreviewWidth(defaultVideoPreviewWidth, dock, viewportWidth, viewportHeight));
  }

  return (
    <section aria-hidden={hidden || undefined} className={'video-preview-panel ' + (hidden ? 'hidden ' : '') + (resizing ? 'resizing' : '')} style={{ '--preview-width': boundedWidth + 'px' } as CSSProperties} aria-label="Video preview">
      <div
        className="video-preview-surface"
        onClick={() => setPlaying(!playing)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            setPlaying(!playing);
          }
        }}
        role="button"
        tabIndex={hidden ? -1 : 0}
        title={playing ? 'Pause video' : 'Play video'}
      >
        <video
          onDurationChange={(event) => {
            const nextDuration = event.currentTarget.duration;
            onDurationChange(Number.isFinite(nextDuration) ? nextDuration : null);
          }}
          onEnded={(event) => {
            const nextTime = Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : event.currentTarget.currentTime;
            onTimeChange(nextTime);
            setPlaying(false);
          }}
          onError={() => {
            setPlaying(false);
            onError('Video source could not be loaded.');
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
          onSeeking={(event) => logPlaybackDiagnostic('video:seeking', event.currentTarget)}
          onStalled={(event) => logPlaybackDiagnostic('video:stalled', event.currentTarget)}
          onWaiting={(event) => logPlaybackDiagnostic('video:waiting', event.currentTarget)}
          playsInline
          preload="metadata"
          ref={(element) => { mediaRef.current = element; }}
          src={mediaUrl}
        />
        <div className="video-preview-actions" onClick={(event) => event.stopPropagation()}>
          <button aria-label={dock === 'top' ? 'Dock video preview to side' : 'Dock video preview above transcript'} onClick={() => setDock(dock === 'top' ? 'side' : 'top')} title={dock === 'top' ? 'Dock side' : 'Dock top'} type="button">
            {dock === 'top' ? <PanelLeftOpen size={14} /> : <PanelLeftClose size={14} />}
          </button>
          <button aria-label="Hide video preview" onClick={onHide} title="Hide preview" type="button"><X size={14} /></button>
        </div>
        <span className="video-preview-time">{formatTime(currentTime)} / {formatDuration(duration)}</span>
        <span className="video-preview-size">{Math.round(boundedWidth)}px</span>
        <button aria-label="Resize video preview" className="video-resize-handle" onClick={(event) => event.stopPropagation()} onDoubleClick={resetSize} onPointerCancel={endResize} onPointerDown={beginResize} onPointerMove={resize} onPointerUp={endResize} title="Drag to resize. Double-click to reset." type="button" />
      </div>
    </section>
  );
}
type WaveformGraphProps = {
  loading: boolean;
  peaks: number[];
  scaleMode: WaveformScaleMode;
};

const WaveformGraph = memo(function WaveformGraph({ loading, peaks, scaleMode }: WaveformGraphProps): ReactElement {
  const width = 1200;
  const height = 96;
  const bars = useMemo(() => {
    const rawPeaks = peaks.length > 0 ? peaks : waveformBars.map((barHeight) => barHeight / 100);
    const displayPeaks = rawPeaks.map((peak) => scaleWaveformPeak(peak, scaleMode));
    const barWidth = Math.max(1, width / displayPeaks.length);

    return displayPeaks.map((peak, index) => {
      const normalizedHeight = Math.max(3, peak * height);
      return {
        height: normalizedHeight,
        key: `${index}-${peak.toFixed(3)}`,
        width: Math.max(1, barWidth * 0.72),
        x: index * barWidth,
        y: (height - normalizedHeight) / 2
      };
    });
  }, [peaks, scaleMode]);

  return (
    <svg className={`waveform ${loading ? 'loading' : ''}`} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
      <g>
        {bars.map((bar) => (
          <rect height={bar.height} key={bar.key} rx={1.5} width={bar.width} x={bar.x} y={bar.y} />
        ))}
      </g>
    </svg>
  );
});

type AudioDeckProps = {
  audioRef: MutableRefObject<HTMLMediaElement | null>;
  currentTime: number;
  disabled: boolean;
  duration: number | null;
  externalSeekSignal: number;
  mediaError: string | null;
  mediaKind: MediaKind;
  mediaUrl: string | null;
  onDurationChange: (duration: number | null) => void;
  onError: (message: string | null) => void;
  onTimeChange: (time: number) => void;
  playbackSpeed: number;
  playing: boolean;
  setPlaybackSpeed: (speed: number) => void;
  setPlaying: (playing: boolean) => void;
  waveformLoading: boolean;
  waveformPeaks: number[];
};

function AudioDeck({
  audioRef,
  currentTime,
  disabled,
  duration,
  externalSeekSignal,
  mediaError,
  mediaKind,
  mediaUrl,
  onDurationChange,
  onError,
  onTimeChange,
  playbackSpeed,
  playing,
  setPlaybackSpeed,
  setPlaying,
  waveformLoading,
  waveformPeaks
}: AudioDeckProps): ReactElement {
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [volumeOpen, setVolumeOpen] = useState(false);
  const [speedOpen, setSpeedOpen] = useState(false);
  const [scaleOpen, setScaleOpen] = useState(false);
  const [visualTime, setVisualTime] = useState(currentTime);
  const [draftSeekTime, setDraftSeekTime] = useState<number | null>(null);
  const [waveformScaleMode, setWaveformScaleMode] = useState<WaveformScaleMode>('actual');
  const lastPlaybackSyncRef = useRef(0);
  const lastPreviewSeekRef = useRef(0);
  const resolvedDuration = duration && Number.isFinite(duration) && duration > 0 ? duration : null;
  const mediaTime = resolvedDuration ? Math.min(visualTime, resolvedDuration) : visualTime;
  const displayTime = draftSeekTime ?? mediaTime;
  const currentProgress = resolvedDuration ? Math.min(1, Math.max(0, displayTime / resolvedDuration)) : 0;
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
        onError('Media playback could not start.');
      });
    } else {
      audio.pause();
    }
  }, [audioRef, canPlay, mediaUrl, onError, playing, setPlaying]);

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
  }, [audioRef, mediaUrl, playbackSpeed]);

  useEffect(() => {
    const externalJumpThresholdSeconds = 0.3;
    if (draftSeekTime === null && (!playing || Math.abs(currentTime - visualTime) > externalJumpThresholdSeconds)) {
      setVisualTime(currentTime);
    }
  }, [currentTime, draftSeekTime, playing, visualTime]);

  useEffect(() => {
    if (draftSeekTime === null) {
      setVisualTime(currentTime);
    }
  }, [currentTime, draftSeekTime, externalSeekSignal]);

  useEffect(() => {
    if (!playing || !canPlay) {
      return;
    }

    let animationFrame = 0;
    let lastUpdate = 0;

    const updateVisualTime = (timestamp: number): void => {
      const audio = audioRef.current;
      if (audio && draftSeekTime === null && timestamp - lastUpdate >= 33) {
        const nextTime = audio.currentTime;
        setVisualTime(nextTime);
        syncPlaybackSample(nextTime);
        lastUpdate = timestamp;
      }
      animationFrame = window.requestAnimationFrame(updateVisualTime);
    };

    animationFrame = window.requestAnimationFrame(updateVisualTime);

    return () => window.cancelAnimationFrame(animationFrame);
  }, [audioRef, canPlay, draftSeekTime, onTimeChange, playing]);

  function skipBy(seconds: number): void {
    const audio = audioRef.current;
    if (!audio || !canPlay) {
      return;
    }

    const unclamped = audio.currentTime + seconds;
    const nextTime = resolvedDuration ? Math.min(resolvedDuration, Math.max(0, unclamped)) : Math.max(0, unclamped);
    applyMediaSeek(audio, nextTime, false);
    setVisualTime(nextTime);
    syncPlaybackSample(nextTime, true);
  }

  function syncPlaybackSample(time: number, force = false): void {
    const now = performance.now();
    if (!force && now - lastPlaybackSyncRef.current < playbackSyncIntervalMs) {
      return;
    }

    lastPlaybackSyncRef.current = now;
    onTimeChange(time);
  }

  function previewSeek(seconds: number): void {
    if (!resolvedDuration) {
      return;
    }

    const audio = audioRef.current;
    const nextTime = Math.min(resolvedDuration, Math.max(0, seconds));
    setDraftSeekTime(nextTime);
    setVisualTime(nextTime);
    syncPlaybackSample(nextTime, true);

    if (!audio || !canPlay) {
      return;
    }

    const now = performance.now();
    const seekThrottle = mediaKind === 'video' ? videoSeekThrottleMs : audioSeekThrottleMs;
    if (now - lastPreviewSeekRef.current < seekThrottle) {
      return;
    }

    applyMediaSeek(audio, nextTime, mediaKind === 'video');
    lastPreviewSeekRef.current = now;
  }

  function seekTo(seconds: number): void {
    const audio = audioRef.current;
    if (!audio || !canPlay || !resolvedDuration) {
      setDraftSeekTime(null);
      return;
    }

    const nextTime = Math.min(resolvedDuration, Math.max(0, seconds));
    applyMediaSeek(audio, nextTime, false);
    setDraftSeekTime(null);
    setVisualTime(nextTime);
    syncPlaybackSample(nextTime, true);
  }

  return (
    <section className="audio-deck panel-glow" aria-label="Media controls">
      {mediaKind === 'audio' ? (
        <audio
          className="playback-media"
          onDurationChange={(event) => {
            const nextDuration = event.currentTarget.duration;
            onDurationChange(Number.isFinite(nextDuration) ? nextDuration : null);
          }}
          onEnded={(event) => {
            const nextTime = Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : event.currentTarget.currentTime;
            setVisualTime(nextTime);
            onTimeChange(nextTime);
            setPlaying(false);
          }}
          onError={() => {
            setPlaying(false);
            onError('Media source could not be loaded.');
          }}
          onLoadedMetadata={(event) => {
            const nextDuration = event.currentTarget.duration;
            event.currentTarget.playbackRate = playbackSpeed;
            setVisualTime(event.currentTarget.currentTime);
            onDurationChange(Number.isFinite(nextDuration) ? nextDuration : null);
            onTimeChange(event.currentTarget.currentTime);
          }}
          onPause={() => setPlaying(false)}
          onPlay={() => setPlaying(true)}
          onSeeked={(event) => {
            setVisualTime(event.currentTarget.currentTime);
            syncPlaybackSample(event.currentTarget.currentTime, true);
            logPlaybackDiagnostic('audio:seeked', event.currentTarget);
          }}
          onSeeking={(event) => logPlaybackDiagnostic('audio:seeking', event.currentTarget)}
          onStalled={(event) => logPlaybackDiagnostic('audio:stalled', event.currentTarget)}
          onWaiting={(event) => logPlaybackDiagnostic('audio:waiting', event.currentTarget)}
          preload="metadata"
          ref={(element) => {
            audioRef.current = element;
          }}
          src={mediaUrl ?? undefined}
        />
      ) : null}
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
            <span className="deck-time current">{formatTime(displayTime)}</span>
            <span className="deck-time-divider">/</span>
            <span className="deck-time">{formatDuration(resolvedDuration)}</span>
          </div>
          <div className="waveform-wrap">
            <div className="waveform-control">
              <WaveformGraph loading={waveformLoading} peaks={waveformPeaks} scaleMode={waveformScaleMode} />
              <div className="waveform-progress-overlay" style={{ transform: `scaleX(${currentProgress})` }} />
              <div className="waveform-playhead" style={{ left: `${currentProgress * 100}%` }} />
              <input
                aria-label="Seek media"
                className="audio-seek"
                disabled={!canPlay || !resolvedDuration}
                max={resolvedDuration ?? 0}
                min={0}
                onBlur={(event) => {
                  if (draftSeekTime !== null) {
                    seekTo(Number(event.currentTarget.value));
                  }
                }}
                onChange={(event) => previewSeek(Number(event.target.value))}
                onKeyUp={(event) => {
                  if (['ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) {
                    seekTo(Number(event.currentTarget.value));
                  }
                }}
                onPointerCancel={() => setDraftSeekTime(null)}
                onPointerDown={() => setDraftSeekTime(displayTime)}
                onPointerUp={(event) => seekTo(Number(event.currentTarget.value))}
                step={0.01}
                type="range"
                value={resolvedDuration ? Math.min(displayTime, resolvedDuration) : 0}
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

type VideoPreviewPreference = {
  dock: VideoPreviewDock;
  hidden: boolean;
  width: number;
};

function loadVideoPreviewPreference(): VideoPreviewPreference {
  const fallback: VideoPreviewPreference = { dock: 'top', hidden: false, width: defaultVideoPreviewWidth };

  try {
    const rawValue = window.localStorage.getItem(videoPreviewPreferenceKey);
    if (!rawValue) {
      return fallback;
    }

    const value = JSON.parse(rawValue) as Partial<VideoPreviewPreference>;
    return {
      dock: value.dock === 'side' ? 'side' : 'top',
      hidden: typeof value.hidden === 'boolean' ? value.hidden : fallback.hidden,
      width: typeof value.width === 'number' && Number.isFinite(value.width) ? Math.max(minVideoPreviewWidth, Math.min(maxTopVideoPreviewWidth, Math.round(value.width))) : fallback.width
    };
  } catch {
    return fallback;
  }
}

function saveVideoPreviewPreference(preference: VideoPreviewPreference): void {
  try {
    window.localStorage.setItem(videoPreviewPreferenceKey, JSON.stringify(preference));
  } catch {
    // Best-effort UI preference only.
  }
}

function statusClass(status: JobStatus): string {
  if (status === 'completed') return 'ready';
  if (status === 'failed') return 'missing';
  if (status === 'canceled') return 'optional';
  if (activeStatuses.includes(status)) return 'active';
  return 'optional';
}

function clampVideoPreviewWidth(width: number, dock: VideoPreviewDock, viewportWidth: number, viewportHeight: number): number {
  const dockedToSide = dock === 'side' && viewportWidth > sidePreviewBreakpoint;
  const baseMaxWidth = dockedToSide ? maxSideVideoPreviewWidth : maxTopVideoPreviewWidth;
  const widthLimit = dockedToSide ? Math.floor(viewportWidth * 0.28) : Math.floor(viewportWidth * 0.5);
  const availableHeight = viewportHeight - (dockedToSide ? 300 : 430);
  const heightLimit = Math.floor(Math.max(0, availableHeight) * 9 / 16);
  const maxWidth = Math.max(minVideoPreviewWidth, Math.min(baseMaxWidth, widthLimit, Math.max(minVideoPreviewWidth, heightLimit)));

  return Math.max(minVideoPreviewWidth, Math.min(maxWidth, Math.round(width)));
}

function applyMediaSeek(media: HTMLMediaElement, seconds: number, approximate: boolean): void {
  const fastSeek = (media as HTMLMediaElement & { fastSeek?: (time: number) => void }).fastSeek;
  if (approximate && typeof fastSeek === 'function') {
    try {
      fastSeek.call(media, seconds);
      return;
    } catch {
      // Fall back to precise seeking when the runtime exposes fastSeek but cannot use it for this media.
    }
  }

  media.currentTime = seconds;
}

function logPlaybackDiagnostic(eventName: string, media: HTMLMediaElement): void {
  if (!import.meta.env.DEV || window.localStorage.getItem('voxmire:playbackDiagnostics') !== '1') {
    return;
  }

  console.debug('[voxmire:playback]', eventName, {
    currentTime: media.currentTime,
    networkState: media.networkState,
    readyState: media.readyState,
    seekable: timeRangesToTuples(media.seekable),
    seeking: media.seeking
  });
}

function timeRangesToTuples(ranges: TimeRanges): Array<[number, number]> {
  return Array.from({ length: ranges.length }, (_, index) => [ranges.start(index), ranges.end(index)]);
}

function statusLabel(status: JobStatus): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function transcriptSubtitle(job: JobWithSource, progress: number, mediaKind: MediaKind): string {
  if (activeStatuses.includes(job.job.status) || job.job.status === 'paused') {
    return `${statusLabel(job.job.status)} / ${progress}%`;
  }

  if (job.job.status === 'failed') {
    return 'Failed. Check the job error below.';
  }

  if (job.job.status === 'canceled') {
    return 'Canceled';
  }

  return `${formatDuration(job.sourceFile.durationSeconds)} ${mediaKindLabel(mediaKind)}`;
}

function mediaKindLabel(kind: MediaKind): string {
  return kind === 'video' ? 'video' : 'audio';
}

function mediaKindFromExtension(extension: string): MediaKind {
  switch (extension.toLowerCase().replace(/^\./, '')) {
    case 'mp4':
    case 'mov':
    case 'mkv':
    case 'webm':
    case 'avi':
      return 'video';
    default:
      return 'audio';
  }
}

function exportResultLabel(format: ExportFormat, textMode: ExportTextMode): string {
  if (format === 'txt') {
    return textMode === 'timestamps' ? 'timestamped TXT' : 'plain TXT';
  }

  return format.toUpperCase();
}

function extractDirectoryPath(filePath: string): string {
  const normalized = filePath.replaceAll('\\', '/');
  const separatorIndex = normalized.lastIndexOf('/');
  return separatorIndex >= 0 ? filePath.slice(0, separatorIndex) : filePath;
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

function formatEditableTime(seconds: number): string {
  const safeSeconds = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const wholeSeconds = Math.floor(safeSeconds % 60);
  const milliseconds = Math.round((safeSeconds - Math.floor(safeSeconds)) * 1000);
  const suffix = milliseconds > 0 ? `.${milliseconds.toString().padStart(3, '0').replace(/0+$/, '')}` : '';

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${wholeSeconds.toString().padStart(2, '0')}${suffix}`;
  }

  return `${minutes}:${wholeSeconds.toString().padStart(2, '0')}${suffix}`;
}

function parseEditableTime(value: string): number | null {
  const parts = value.trim().split(':');
  if (parts.length < 1 || parts.length > 3 || parts.some((part) => part.trim() === '')) {
    return null;
  }

  const numericParts = parts.map((part) => Number(part));
  if (numericParts.some((part) => !Number.isFinite(part) || part < 0)) {
    return null;
  }

  if (numericParts.length === 1) {
    return numericParts[0] ?? null;
  }

  if (numericParts.length === 2) {
    return (numericParts[0] ?? 0) * 60 + (numericParts[1] ?? 0);
  }

  return (numericParts[0] ?? 0) * 3600 + (numericParts[1] ?? 0) * 60 + (numericParts[2] ?? 0);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function countTranscriptMatches(segments: TranscriptSegment[], query: string): number {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return 0;
  }

  return segments.reduce((count, segment) => count + (segment.text.toLowerCase().includes(normalizedQuery) ? 1 : 0), 0);
}

function findTranscriptMatchIndexes(segments: TranscriptSegment[], query: string): number[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return [];
  }

  return segments.reduce<number[]>((indexes, segment, index) => {
    if (segment.text.toLowerCase().includes(normalizedQuery)) {
      indexes.push(index);
    }
    return indexes;
  }, []);
}

function formatDuration(seconds: number | null): string {
  return seconds === null ? 'Duration unknown' : formatTime(seconds);
}

function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 B';
  }

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** exponent;
  return `${value.toFixed(value >= 10 || exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'Unknown date';
  }

  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date);
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'Unknown date';
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(date);
}
