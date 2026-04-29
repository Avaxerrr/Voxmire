import { type ReactElement, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  AudioWaveform,
  ChevronDown,
  PanelLeftClose,
  PanelLeftOpen,
  Download,
  FileText,
  FolderOpen,
  Home,
  MicVocal,
  Pause,
  Pencil,
  Play,
  Plus,
  Search,
  Settings,
  SkipBack,
  SkipForward,
  Square,
  Redo2,
  RotateCcw,
  Undo2,
  Video,
  X,
  Zap
} from 'lucide-react';
import type {
  EngineAvailability,
  EngineBackend,
  ExportFormat,
  ExportTextMode,
  JobStatus,
  JobWithSource,
  MachineProfile,
  ModelProfile,
  ProjectDetails,
  ResourceStatus,
  TranscriptSegment,
  TranscriptSegmentListResult,
  TranscriptionPresetId,
  TranscriptionProgressEvent
} from '@voxmire/contracts';
import { EmptyState } from './components/empty-state';
import { ProjectActionsMenu } from './components/project-actions-menu';
import { DeleteProjectModal, ImportModal, ProjectDetailsDrawer, RenameProjectModal, ResetTranscriptModal } from './components/project-dialogs';
import { ProgressPill } from './components/progress-pill';
import { NavButton } from './components/nav-button';
import { WindowFrameControls } from './components/window-frame-controls';
import { VoiceStudioView } from './views/voice-studio-view';
import { DashboardView } from './views/dashboard-view';
import { SettingsView } from './views/settings-view';
import { exportResultLabel, extractDirectoryPath, formatDate, formatDuration } from './lib/format';
import { isEditableHistoryShortcutTarget, isPlainSpaceKey, isPlaybackShortcutTarget } from './lib/keyboard';
import { activeStatuses, statusLabel } from './lib/job-status';
import { mediaKindFromExtension, mediaKindLabel, type MediaKind } from './lib/media-kind';
import { fallbackModels, resolvePresetSelection, selectUsablePreset } from './lib/presets';
import { countTranscriptMatches, escapeRegExp, findTranscriptMatchIndexes } from './lib/transcript-search';
import { replaceSegmentInTranscriptSnapshot, transcriptSegmentsEqual, type TranscriptHistoryEntry } from './lib/transcript-history';
import { applyMediaSeek } from './features/media/media-seek';
import { VirtualizedSegmentList } from './features/transcript/segment-list';
import { getPlaybackWordState, type PlaybackWordState } from './features/transcript/word-timing';
import { AudioDeck, type PlaybackClockSample } from './features/media/playback-controls';
import { playbackSyncIntervalMs } from './features/media/playback-constants';
import { VideoPreview } from './features/media/video-preview';
import { loadVideoPreviewPreference, saveVideoPreviewPreference, type VideoPreviewDock } from './features/media/video-preview-preferences';

type AppInfo = {
  name: string;
  version: string;
  platform: string;
  arch: string;
};

type ViewId = 'dashboard' | 'transcript' | 'voice' | 'settings';

type StatusTone = 'ready' | 'active' | 'warning' | 'error';
type MediaInfo = {
  contentType: string;
  hasAudio: boolean;
  hasVideo: boolean;
  kind: MediaKind;
};

type PreferredActiveSegment = {
  segmentId: string;
  timeSeconds: number;
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
const playbackDiagnosticClockDriftWarningSeconds = 0.08;
const playbackDiagnosticLongGapWarningSeconds = 0.12;
const playbackTraceLimit = 600;
const timestampSeekPreferenceToleranceSeconds = 0.05;
const transcriptHistoryLimit = 20;
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

  async function replaceTranscriptSegments(nextSegments: TranscriptSegment[]): Promise<TranscriptSegment[] | null> {
    if (!selectedJob) {
      return null;
    }

    if (!api) {
      setMessage('Desktop bridge unavailable.');
      return null;
    }

    try {
      const updatedSegments = await api.transcripts.replaceSegments(selectedJob.job.id, nextSegments);
      setSegments(updatedSegments);
      setMessage('Transcript history applied.');
      return updatedSegments;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to restore transcript history.');
      return null;
    }
  }

  async function resetTranscriptSegments(): Promise<TranscriptSegmentListResult | null> {
    if (!selectedJob) {
      return null;
    }

    if (!api) {
      setMessage('Desktop bridge unavailable.');
      return null;
    }

    try {
      const result = await api.transcripts.resetSegments(selectedJob.job.id);
      setSegments(result.segments);
      setMessage(result.error ?? 'Transcript reset to original transcription.');
      return result;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to reset transcript.');
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
            replaceSegments={replaceTranscriptSegments}
            resetSegments={resetTranscriptSegments}
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
  replaceSegments: (segments: TranscriptSegment[]) => Promise<TranscriptSegment[] | null>;
  resetSegments: () => Promise<TranscriptSegmentListResult | null>;
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
  replaceSegments,
  resetSegments,
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
  const [resetTranscriptOpen, setResetTranscriptOpen] = useState(false);
  const [resettingTranscript, setResettingTranscript] = useState(false);
  const [undoStack, setUndoStack] = useState<TranscriptHistoryEntry[]>([]);
  const [redoStack, setRedoStack] = useState<TranscriptHistoryEntry[]>([]);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [editorResetSignal, setEditorResetSignal] = useState(0);
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [mediaInfo, setMediaInfo] = useState<MediaInfo | null>(null);
  const [playbackTime, setPlaybackTime] = useState(0);
  const [playbackClockSample, setPlaybackClockSample] = useState<PlaybackClockSample | null>(null);
  const [playbackDuration, setPlaybackDuration] = useState<number | null>(null);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [externalSeekSignal, setExternalSeekSignal] = useState(0);
  const [preferredActiveSegment, setPreferredActiveSegment] = useState<PreferredActiveSegment | null>(null);
  const [videoPreviewHidden, setVideoPreviewHidden] = useState(() => loadVideoPreviewPreference().hidden);
  const [videoPreviewDock, setVideoPreviewDock] = useState<VideoPreviewDock>(() => loadVideoPreviewPreference().dock);
  const [videoPreviewWidth, setVideoPreviewWidth] = useState(() => loadVideoPreviewPreference().width);
  const [viewportSize, setViewportSize] = useState(() => ({ height: window.innerHeight, width: window.innerWidth }));
  const [waveformPeaks, setWaveformPeaks] = useState<number[]>([]);
  const [waveformLoading, setWaveformLoading] = useState(false);
  const exportMenuRef = useRef<HTMLDivElement | null>(null);
  const audioRef = useRef<HTMLMediaElement | null>(null);
  const mediaApi = window.voxmire?.media;
  const diagnosticsEnabled = usePlaybackDiagnosticsEnabled();
  const progress = selectedJob ? Math.round(selectedJob.job.progress * 100) : 0;
  const isCancelable = selectedJob ? activeStatuses.includes(selectedJob.job.status) || selectedJob.job.status === 'paused' : false;
  const isPausable = selectedJob ? activeStatuses.includes(selectedJob.job.status) : false;
  const isResumable = selectedJob?.job.status === 'paused';
  const isWorking = selectedJob ? activeStatuses.includes(selectedJob.job.status) : false;
  const showJobProgressRow = isWorking || isResumable;
  const selectedMediaKind = selectedJob ? mediaInfo?.kind ?? mediaKindFromExtension(selectedJob.sourceFile.extension) : 'audio';
  const selectedSubtitle = selectedJob ? transcriptSubtitle(selectedJob, progress, selectedMediaKind) : 'Choose a project from Library or import a recording.';
  const activeSegmentIndex = useMemo(() => findActiveSegmentIndex(segments, playbackTime), [playbackTime, segments]);
  const preferredActiveSegmentIndex = useMemo(
    () => preferredActiveSegmentIndexForPlayback(segments, playbackTime, preferredActiveSegment),
    [playbackTime, preferredActiveSegment, segments]
  );
  const transcriptActiveSegmentIndex = preferredActiveSegmentIndex >= 0 ? preferredActiveSegmentIndex : activeSegmentIndex;
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
  const playbackTimingDiagnostic = useMemo(
    () => diagnosticsEnabled ? buildPlaybackTimingDiagnostic({ activeSegmentIndex, playbackClockSample, playbackTime, segments }) : null,
    [activeSegmentIndex, diagnosticsEnabled, playbackClockSample, playbackTime, segments]
  );

  useEffect(() => {
    setActiveFindIndex(0);
  }, [findQuery]);

  useEffect(() => {
    setUndoStack([]);
    setRedoStack([]);
    setEditorResetSignal((value) => value + 1);
  }, [selectedJob?.job.id]);

  useEffect(() => {
    function handleHistoryKeyDown(event: KeyboardEvent): void {
      const commandModifier = event.ctrlKey || event.metaKey;
      if (!commandModifier || isEditableHistoryShortcutTarget(event.target)) {
        return;
      }

      const key = event.key.toLowerCase();
      if (key === 'z' && !event.shiftKey) {
        event.preventDefault();
        void applyTranscriptHistory('undo');
        return;
      }

      if (key === 'y' || (key === 'z' && event.shiftKey)) {
        event.preventDefault();
        void applyTranscriptHistory('redo');
      }
    }

    window.addEventListener('keydown', handleHistoryKeyDown);
    return () => window.removeEventListener('keydown', handleHistoryKeyDown);
  }, [historyBusy, redoStack, selectedJob?.job.id, undoStack]);

  useEffect(() => {
    function handlePlaybackKeyDown(event: KeyboardEvent): void {
      if (
        event.defaultPrevented ||
        event.repeat ||
        !isPlainSpaceKey(event) ||
        isPlaybackShortcutTarget(event.target) ||
        resetTranscriptOpen ||
        switcherOpen ||
        exportMenuOpen ||
        !selectedJob ||
        !mediaUrl ||
        mediaError
      ) {
        return;
      }

      event.preventDefault();
      setPlaying(!playing);
    }

    window.addEventListener('keydown', handlePlaybackKeyDown);
    return () => window.removeEventListener('keydown', handlePlaybackKeyDown);
  }, [exportMenuOpen, mediaError, mediaUrl, playing, resetTranscriptOpen, selectedJob, setPlaying, switcherOpen]);

  useEffect(() => {
    if (preferredActiveSegment && preferredActiveSegmentIndex < 0) {
      setPreferredActiveSegment(null);
    }
  }, [preferredActiveSegment, preferredActiveSegmentIndex]);

  useEffect(() => {
    if (playbackTimingDiagnostic) {
      recordPlaybackTimingDiagnostic(playbackTimingDiagnostic);
    }
  }, [playbackTimingDiagnostic]);

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
    setPreferredActiveSegment(null);
    setPlaybackClockSample(null);
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

  function rememberTranscriptHistory(label: string, before: TranscriptSegment[], after: TranscriptSegment[]): void {
    if (transcriptSegmentsEqual(before, after)) {
      return;
    }

    setUndoStack((current) => [
      ...current.slice(Math.max(0, current.length - transcriptHistoryLimit + 1)),
      { after, before, label }
    ]);
    setRedoStack([]);
  }

  async function applyTranscriptHistory(direction: 'undo' | 'redo'): Promise<void> {
    if (historyBusy || !selectedJob) {
      return;
    }

    const stack = direction === 'undo' ? undoStack : redoStack;
    const entry = stack[stack.length - 1];
    if (!entry) {
      return;
    }

    setHistoryBusy(true);
    try {
      const restored = await replaceSegments(direction === 'undo' ? entry.before : entry.after);
      if (!restored) {
        return;
      }

      setEditorResetSignal((value) => value + 1);
      if (direction === 'undo') {
        setUndoStack((current) => current.slice(0, -1));
        setRedoStack((current) => [
          ...current.slice(Math.max(0, current.length - transcriptHistoryLimit + 1)),
          entry
        ]);
        return;
      }

      setRedoStack((current) => current.slice(0, -1));
      setUndoStack((current) => [
        ...current.slice(Math.max(0, current.length - transcriptHistoryLimit + 1)),
        entry
      ]);
    } finally {
      setHistoryBusy(false);
    }
  }

  async function updateSegmentWithHistory(segmentId: string, text: string): Promise<TranscriptSegment | null> {
    const before = segments;
    const updated = await updateSegment(segmentId, text);
    if (updated) {
      rememberTranscriptHistory('Edit text', before, replaceSegmentInTranscriptSnapshot(before, updated));
    }

    return updated;
  }

  async function updateSegmentTimingWithHistory(
    segmentId: string,
    startSeconds: number,
    endSeconds: number
  ): Promise<TranscriptSegmentListResult | null> {
    const before = segments;
    const result = await updateSegmentTiming(segmentId, startSeconds, endSeconds);
    if (result && !result.error) {
      rememberTranscriptHistory('Edit timing', before, result.segments);
    }

    return result;
  }

  async function splitSegmentWithHistory(segmentId: string, offset: number): Promise<TranscriptSegment[] | null> {
    const before = segments;
    const updatedSegments = await splitSegment(segmentId, offset);
    if (updatedSegments) {
      rememberTranscriptHistory('Split segment', before, updatedSegments);
    }

    return updatedSegments;
  }

  async function mergeSegmentWithHistory(segmentId: string, direction: 'previous' | 'next'): Promise<TranscriptSegment[] | null> {
    const before = segments;
    const updatedSegments = await mergeSegment(segmentId, direction);
    if (updatedSegments) {
      rememberTranscriptHistory('Merge segments', before, updatedSegments);
    }

    return updatedSegments;
  }

  async function resetTranscriptWithHistory(): Promise<void> {
    if (resettingTranscript) {
      return;
    }

    const before = segments;
    setResettingTranscript(true);
    try {
      const result = await resetSegments();
      if (result && !result.error) {
        rememberTranscriptHistory('Reset transcript', before, result.segments);
        setEditorResetSignal((value) => value + 1);
        setResetTranscriptOpen(false);
      }
    } finally {
      setResettingTranscript(false);
    }
  }

  function seekToTime(seconds: number, preferredSegmentId: string | null = null): void {
    const nextTime = Math.max(0, seconds);
    const audio = audioRef.current;

    setPreferredActiveSegment(preferredSegmentId ? { segmentId: preferredSegmentId, timeSeconds: nextTime } : null);
    setPlaybackTime(nextTime);
    setExternalSeekSignal((value) => value + 1);
    if (audio) {
      applyMediaSeek(audio, nextTime, false);
    }
  }

  function seekToSegment(segment: TranscriptSegment): void {
    seekToTime(segment.startSeconds);
  }

  function seekToAdjacentSegment(direction: 'previous' | 'next'): void {
    const nextIndex = transcriptActiveSegmentIndex < 0
      ? (direction === 'next' ? 0 : -1)
      : transcriptActiveSegmentIndex + (direction === 'next' ? 1 : -1);
    const segment = segments[nextIndex];
    if (segment) {
      seekToSegment(segment);
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

    const before = segments;
    let nextSegments = segments;
    setReplacingText(true);
    try {
      for (const segment of matchingSegments) {
        const currentSegment = nextSegments.find((candidate) => candidate.id === segment.id) ?? segment;
        matcher.lastIndex = 0;
        const nextText = currentSegment.text.replace(matcher, replaceQuery);
        if (nextText !== currentSegment.text) {
          const updated = await updateSegment(currentSegment.id, nextText);
          if (updated) {
            nextSegments = replaceSegmentInTranscriptSnapshot(nextSegments, updated);
          }
        }
      }

      rememberTranscriptHistory('Replace all', before, nextSegments);
    } finally {
      setReplacingText(false);
    }
  }

  return (
    <div className="view workspace-page transcript-view">
      <header className="workspace-header transcript-topbar glass-bar">
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
            aria-label="Undo transcript edit"
            className="icon-button"
            disabled={!selectedJob || historyBusy || undoStack.length === 0}
            onClick={() => void applyTranscriptHistory('undo')}
            title={undoStack.length > 0 ? `Undo ${undoStack[undoStack.length - 1]?.label ?? 'edit'}` : 'Undo'}
            type="button"
          >
            <Undo2 size={17} />
          </button>
          <button
            aria-label="Redo transcript edit"
            className="icon-button"
            disabled={!selectedJob || historyBusy || redoStack.length === 0}
            onClick={() => void applyTranscriptHistory('redo')}
            title={redoStack.length > 0 ? `Redo ${redoStack[redoStack.length - 1]?.label ?? 'edit'}` : 'Redo'}
            type="button"
          >
            <Redo2 size={17} />
          </button>
          <button
            aria-label="Reset transcript"
            className="icon-button danger-icon-button"
            disabled={!selectedJob || historyBusy || resettingTranscript || segments.length === 0}
            onClick={() => setResetTranscriptOpen(true)}
            title="Reset transcript"
            type="button"
          >
            <RotateCcw size={16} />
          </button>
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
                {showJobProgressRow ? (
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
                ) : null}
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
                      onMediaDiagnostic={logPlaybackDiagnostic}
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
                        activeSegmentIndex={transcriptActiveSegmentIndex}
                        diagnosticsEnabled={diagnosticsEnabled}
                        onWordTimingDiagnostic={logWordTimingDiagnostic}
                        onMergeSegment={mergeSegmentWithHistory}
                        onSeek={seekToSegment}
                        onSeekTime={seekToTime}
                        onSplitSegment={splitSegmentWithHistory}
                        onUpdateTiming={updateSegmentTimingWithHistory}
                        onUpdateSegment={updateSegmentWithHistory}
                        activeSearchSegmentId={activeFindSegment?.id ?? null}
                        playbackTime={playbackTime}
                        resetSignal={editorResetSignal}
                        searchQuery={findQuery}
                        segments={segments}
                      />
                    )}
                  </div>
                ) : segments.length === 0 ? (
                  <EmptyState title="Transcript pending" body="Transcript text will appear here as the job progresses." />
                ) : (
                  <VirtualizedSegmentList
                    activeSegmentIndex={transcriptActiveSegmentIndex}
                        diagnosticsEnabled={diagnosticsEnabled}
                        onWordTimingDiagnostic={logWordTimingDiagnostic}
                    onMergeSegment={mergeSegmentWithHistory}
                    onSeek={seekToSegment}
                    onSeekTime={seekToTime}
                    onSplitSegment={splitSegmentWithHistory}
                    onUpdateTiming={updateSegmentTimingWithHistory}
                    onUpdateSegment={updateSegmentWithHistory}
                    activeSearchSegmentId={activeFindSegment?.id ?? null}
                    playbackTime={playbackTime}
                    resetSignal={editorResetSignal}
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
            diagnosticsEnabled={diagnosticsEnabled}
            mediaKind={selectedMediaKind}
            mediaUrl={mediaUrl}
            onClockSample={setPlaybackClockSample}
            onDurationChange={setPlaybackDuration}
            onError={setMediaError}
            onMediaDiagnostic={logPlaybackDiagnostic}
            onNextSegment={() => seekToAdjacentSegment('next')}
            onPreviousSegment={() => seekToAdjacentSegment('previous')}
            onTimeChange={setPlaybackTime}
            playbackSpeed={playbackSpeed}
            playing={playing}
            setPlaybackSpeed={setPlaybackSpeed}
            waveformLoading={waveformLoading}
            waveformPeaks={waveformPeaks}
            canGoNextSegment={segments.length > 0 && transcriptActiveSegmentIndex < segments.length - 1}
            canGoPreviousSegment={transcriptActiveSegmentIndex > 0}
            setPlaying={setPlaying}
          />
        </div>
      </section>

      {resetTranscriptOpen && selectedJob ? (
        <ResetTranscriptModal
          busy={resettingTranscript}
          onClose={() => setResetTranscriptOpen(false)}
          onReset={resetTranscriptWithHistory}
          project={selectedJob}
        />
      ) : null}
    </div>
  );
}

type PlaybackTimingDiagnostic = {
  activeSegmentIndex: number;
  anomaly: string | null;
  gapSeconds: number | null;
  mediaClockDriftSeconds: number | null;
  mediaSegmentIndex: number;
  mediaTime: number | null;
  playbackTime: number;
  reason: PlaybackWordState['reason'] | 'no-segment';
  segmentEndSeconds: number | null;
  segmentId: string | null;
  segmentStartSeconds: number | null;
  stateSegmentOffsetSeconds: number | null;
  wordDurationSeconds: number | null;
  wordEndSeconds: number | null;
  wordIndex: number;
  wordStartSeconds: number | null;
  wordText: string | null;
};

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

function preferredActiveSegmentIndexForPlayback(
  segments: TranscriptSegment[],
  playbackTime: number,
  preferredSegment: PreferredActiveSegment | null
): number {
  if (!preferredSegment || !Number.isFinite(playbackTime)) {
    return -1;
  }

  const index = segments.findIndex((segment) => segment.id === preferredSegment.segmentId);
  const segment = segments[index];
  if (!segment) {
    return -1;
  }

  const clickedTimeStillCurrent = Math.abs(playbackTime - preferredSegment.timeSeconds) <= timestampSeekPreferenceToleranceSeconds;
  const playbackTimeWithinSegment =
    playbackTime >= segment.startSeconds - timestampSeekPreferenceToleranceSeconds &&
    playbackTime <= segment.endSeconds + timestampSeekPreferenceToleranceSeconds;

  return clickedTimeStillCurrent && playbackTimeWithinSegment ? index : -1;
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

function usePlaybackDiagnosticsEnabled(): boolean {
  const [enabled, setEnabled] = useState(() => playbackDiagnosticsEnabled());

  useEffect(() => {
    if (!import.meta.env.DEV) {
      return;
    }

    const sync = (): void => setEnabled(playbackDiagnosticsEnabled());
    window.addEventListener('voxmire:playbackDiagnosticsChanged', sync);
    const intervalId = window.setInterval(sync, 1000);

    return () => {
      window.removeEventListener('voxmire:playbackDiagnosticsChanged', sync);
      window.clearInterval(intervalId);
    };
  }, []);

  return enabled;
}

function buildPlaybackTimingDiagnostic({
  activeSegmentIndex,
  playbackClockSample,
  playbackTime,
  segments
}: {
  activeSegmentIndex: number;
  playbackClockSample: PlaybackClockSample | null;
  playbackTime: number;
  segments: TranscriptSegment[];
}): PlaybackTimingDiagnostic {
  const segment = segments[activeSegmentIndex];
  const wordState = segment ? getPlaybackWordState(segment, playbackTime) : null;
  const mediaTime = playbackClockSample?.mediaTime ?? null;
  const mediaSegmentIndex = mediaTime === null ? -1 : findActiveSegmentIndex(segments, mediaTime);
  const gapSeconds = wordState?.previousWord && wordState.nextWord ? wordState.nextWord.startSeconds - wordState.previousWord.endSeconds : null;
  const wordDurationSeconds = wordState && wordState.wordStartSeconds !== null && wordState.wordEndSeconds !== null
    ? wordState.wordEndSeconds - wordState.wordStartSeconds
    : null;
  const mediaClockDriftSeconds = mediaTime === null ? null : mediaTime - playbackTime;
  const diagnostic: PlaybackTimingDiagnostic = {
    activeSegmentIndex,
    anomaly: null,
    gapSeconds,
    mediaClockDriftSeconds,
    mediaSegmentIndex,
    mediaTime,
    playbackTime,
    reason: wordState?.reason ?? 'no-segment',
    segmentEndSeconds: segment?.endSeconds ?? null,
    segmentId: segment?.id ?? null,
    segmentStartSeconds: segment?.startSeconds ?? null,
    stateSegmentOffsetSeconds: segment ? playbackTime - segment.startSeconds : null,
    wordDurationSeconds,
    wordEndSeconds: wordState?.wordEndSeconds ?? null,
    wordIndex: wordState?.wordIndex ?? -1,
    wordStartSeconds: wordState?.wordStartSeconds ?? null,
    wordText: wordState?.wordText ?? null
  };

  diagnostic.anomaly = playbackTimingDiagnosticAnomaly(diagnostic);
  return diagnostic;
}

let lastPlaybackDiagnosticConsoleKey = '';

function recordPlaybackTimingDiagnostic(diagnostic: PlaybackTimingDiagnostic): void {
  if (!playbackDiagnosticsEnabled()) {
    return;
  }

  const trace = window.__VOXMIRE_PLAYBACK_TRACE__ ?? [];
  trace.push(diagnostic);
  if (trace.length > playbackTraceLimit) {
    trace.splice(0, trace.length - playbackTraceLimit);
  }
  window.__VOXMIRE_PLAYBACK_TRACE__ = trace;

  const consoleKey = [diagnostic.activeSegmentIndex, diagnostic.wordIndex, diagnostic.reason, diagnostic.anomaly].join(':');
  if (consoleKey !== lastPlaybackDiagnosticConsoleKey || diagnostic.anomaly) {
    console.debug('[voxmire:word-sync]', JSON.stringify(diagnostic));
    lastPlaybackDiagnosticConsoleKey = consoleKey;
  }
}

function playbackTimingDiagnosticAnomaly(diagnostic: PlaybackTimingDiagnostic): string | null {
  if (diagnostic.mediaClockDriftSeconds !== null && Math.abs(diagnostic.mediaClockDriftSeconds) > playbackDiagnosticClockDriftWarningSeconds) {
    return diagnostic.mediaClockDriftSeconds > 0 ? 'ui-clock-behind-media' : 'ui-clock-ahead-of-media';
  }

  if (diagnostic.mediaSegmentIndex >= 0 && diagnostic.activeSegmentIndex !== diagnostic.mediaSegmentIndex) {
    return 'segment-selection-mismatch';
  }

  if (diagnostic.reason === 'text-range-missing') {
    return 'word-text-range-missing';
  }

  if (diagnostic.reason === 'between-words' && diagnostic.gapSeconds !== null && diagnostic.gapSeconds > playbackDiagnosticLongGapWarningSeconds) {
    return 'word-timing-gap';
  }

  if (diagnostic.wordDurationSeconds !== null && diagnostic.wordDurationSeconds < playbackSyncIntervalMs / 1000) {
    return 'word-shorter-than-ui-sample';
  }

  return null;
}

function playbackDiagnosticsEnabled(): boolean {
  if (!import.meta.env.DEV) {
    return false;
  }

  try {
    return window.localStorage.getItem('voxmire:playbackDiagnostics') === '1';
  } catch {
    return false;
  }
}

function logPlaybackDiagnostic(eventName: string, media: HTMLMediaElement): void {
  if (!playbackDiagnosticsEnabled()) {
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

function logWordTimingDiagnostic({
  activeSegmentIndex,
  playbackTime,
  segment,
  wordState
}: {
  activeSegmentIndex: number;
  playbackTime: number;
  segment: TranscriptSegment | undefined;
  wordState: PlaybackWordState | null;
}): void {
  if (!playbackDiagnosticsEnabled()) {
    return;
  }

  const details = {
    activeSegmentIndex,
    alignmentStatus: wordState?.alignmentStatus ?? null,
    nextWord: wordState?.nextWord ?? null,
    playbackTime,
    previousWord: wordState?.previousWord ?? null,
    range: wordState?.range ?? null,
    segmentEndSeconds: segment?.endSeconds ?? null,
    segmentId: segment?.id ?? null,
    segmentStartSeconds: segment?.startSeconds ?? null,
    wordCount: wordState?.wordCount ?? 0,
    wordEndSeconds: wordState?.wordEndSeconds ?? null,
    wordIndex: wordState?.wordIndex ?? -1,
    wordStartSeconds: wordState?.wordStartSeconds ?? null,
    wordText: wordState?.wordText ?? null
  };

  console.debug('[voxmire:word-timing]', wordState?.reason ?? 'no-playback-segment', JSON.stringify(details));
}

function timeRangesToTuples(ranges: TimeRanges): Array<[number, number]> {
  return Array.from({ length: ranges.length }, (_, index) => [ranges.start(index), ranges.end(index)]);
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

