import { type ReactElement, useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import type {
  EngineAvailability,
  EngineRuntimeId,
  ExportFormat,
  ExportTextMode,
  JobWithSource,
  MachineProfile,
  ModelId,
  ModelInstallStatus,
  ModelProfile,
  ProjectDetails,
  ResourceStatus,
  RuntimeInstallStatus,
  TranscriptSegment,
  TranscriptSegmentListResult,
  TranscriptionLanguage,
  TranscriptionPresetId,
  TranscriptionProgressEvent
} from '@voxmire/contracts';
import { DeleteProjectModal, DeleteProjectsModal, ImportModal, ProjectDetailsDrawer, RenameProjectModal, ResetTranscriptModal } from './components/project-dialogs';
import { AppSidebar } from './components/app-sidebar';
import { StatusBar } from './components/status-bar';
import { WindowFrameControls } from './components/window-frame-controls';
import { VoiceStudioView } from './views/voice-studio-view';
import { emptyTranscriptWorkspaceState } from './features/transcript/transcript-workspace-state';
import { DashboardView } from './views/dashboard-view';
import { SettingsView } from './views/settings-view';
import { TranscriptView } from './views/transcript-view';
import { exportResultLabel, extractDirectoryPath } from './lib/format';
import { progressEventSolverLabel, solverLabelForJob, type SolverLabelsByJobId } from './lib/engines';
import { activeStatuses, jobProgressLabel } from './lib/job-status';
import { readCachedSetupSummary, writeCachedSetupSummary, type CachedSetupSummary } from './lib/setup-cache';
import { fallbackModels, modelLabel, resolveBackendPreference, resolvePresetSelection, selectUsablePreset, type BackendPreference } from './lib/presets';

type AppInfo = {
  name: string;
  version: string;
  platform: string;
  arch: string;
};

type ViewId = 'dashboard' | 'transcript' | 'voice' | 'settings';

type StatusTone = 'ready' | 'active' | 'warning' | 'error';
export function App(): ReactElement {
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [engines, setEngines] = useState<EngineAvailability[]>([]);
  const [models, setModels] = useState<ModelProfile[]>(fallbackModels);
  const [resources, setResources] = useState<ResourceStatus[]>([]);
  const [runtimeInstallStatuses, setRuntimeInstallStatuses] = useState<RuntimeInstallStatus[]>([]);
  const [modelInstallStatuses, setModelInstallStatuses] = useState<ModelInstallStatus[]>([]);
  const [installingRuntimeId, setInstallingRuntimeId] = useState<EngineRuntimeId | null>(null);
  const [installingModelId, setInstallingModelId] = useState<ModelId | null>(null);
  const [machineProfile, setMachineProfile] = useState<MachineProfile | null>(null);
  const [selectedPresetId, setSelectedPresetId] = useState<TranscriptionPresetId>('balanced');
  const [selectedBackendPreference, setSelectedBackendPreference] = useState<BackendPreference>('auto');
  const [selectedLanguage, setSelectedLanguage] = useState<TranscriptionLanguage>('auto');
  const [solverLabelsByJobId, setSolverLabelsByJobId] = useState<SolverLabelsByJobId>({});
  const [jobs, setJobs] = useState<JobWithSource[]>([]);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [segments, setSegments] = useState<TranscriptSegment[]>([]);
  const [workspaceLoading, setWorkspaceLoading] = useState(() => Boolean(window.voxmire));
  const [systemLoading, setSystemLoading] = useState(() => Boolean(window.voxmire));
  const [cachedSetupSummary, setCachedSetupSummary] = useState<CachedSetupSummary | null>(() => readCachedSetupSummary());
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
  const [bulkDeleteTargets, setBulkDeleteTargets] = useState<JobWithSource[]>([]);
  const [projectBusy, setProjectBusy] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [transcriptWorkspaceState, setTranscriptWorkspaceState] = useState(emptyTranscriptWorkspaceState);
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

  const selectedEngineBackend = useMemo(
    () => resolveBackendPreference(selectedBackendPreference, selectedPresetResolution.engineBackend, machineProfile),
    [machineProfile, selectedBackendPreference, selectedPresetResolution.engineBackend]
  );

  const selectedModel = useMemo(
    () => models.find((model) => model.id === selectedPresetResolution.modelId) ?? models[0] ?? null,
    [models, selectedPresetResolution.modelId]
  );

  const activeJob = useMemo(
    () => jobs.find((entry) => activeStatuses.includes(entry.job.status)) ?? null,
    [jobs]
  );

  const transcribeSetupLabel = useMemo(() => {
    if (systemLoading && cachedSetupSummary) {
      return setupSummaryLabel(cachedSetupSummary);
    }

    if (systemLoading) {
      return 'Checking local setup';
    }

    return `${selectedModel?.label ?? 'Recommended preset'} / ${selectedEngineBackend.toUpperCase()}`;
  }, [cachedSetupSummary, selectedEngineBackend, selectedModel?.label, systemLoading]);

  const activeJobSolverLabel = activeJob ? solverLabelForJob(activeJob, solverLabelsByJobId[activeJob.job.id]) : null;
  const detailsSolverLabel = details ? solverLabelForJob({ job: details.job, sourceFile: details.sourceFile }, solverLabelsByJobId[details.job.id]) : null;

  const status = useMemo(() => {
    if (!api) {
      return { tone: 'warning' as StatusTone, text: 'Preview mode: desktop features are unavailable in browser.' };
    }

    if (activeJob) {
      return {
        tone: 'active' as StatusTone,
        text: `${activeJob.sourceFile.name} / ${jobProgressLabel(activeJob.job.status, activeJob.job.progress)}${activeJobSolverLabel ? ` / ${activeJobSolverLabel}` : ''}`
      };
    }

    if (workspaceLoading) {
      return { tone: 'active' as StatusTone, text: 'Loading local workspace.' };
    }

    if (systemLoading) {
      return { tone: 'active' as StatusTone, text: 'Checking local models and runtimes.' };
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
  }, [activeJob, activeJobSolverLabel, api, message, resources, systemLoading, workspaceLoading]);

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
      setWorkspaceLoading(false);
      setSystemLoading(false);
      return;
    }

    setWorkspaceLoading(true);
    setSystemLoading(true);

    let modelProfilesForSetup = models;

    try {
      const [info, modelProfiles, jobList, resolvedExportDirectory] = await Promise.all([
        api.app.getInfo(),
        api.models.list(),
        api.jobs.list(),
        api.exports.getDirectory()
      ]);

      modelProfilesForSetup = modelProfiles;
      setAppInfo(info);
      setModels(modelProfiles);
      setJobs(jobList);
      setSelectedJobId(jobList[0]?.job.id ?? null);
      setExportDirectory(resolvedExportDirectory);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to load Voxmire workspace.');
    } finally {
      setWorkspaceLoading(false);
    }

    try {
      await refreshSystemSetup(modelProfilesForSetup);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to check local models and runtimes.');
    } finally {
      setSystemLoading(false);
    }
  }

  async function refreshSystemSetup(modelProfiles: ModelProfile[] = models): Promise<void> {
    const systemState = await loadSystemState();
    const nextPresetId = selectUsablePreset(systemState.machineProfile.recommendedModelId, systemState.resources);
    const nextResolution = resolvePresetSelection(nextPresetId, systemState.machineProfile, systemState.resources);
    const nextBackend = resolveBackendPreference(selectedBackendPreference, nextResolution.engineBackend, systemState.machineProfile);
    const nextSummary = {
      backend: nextBackend,
      modelId: nextResolution.modelId,
      modelLabel: modelLabel(modelProfiles, nextResolution.modelId),
      updatedAt: new Date().toISOString()
    } satisfies CachedSetupSummary;

    setSelectedPresetId(nextPresetId);
    setCachedSetupSummary(nextSummary);
    writeCachedSetupSummary(nextSummary);
  }

  async function loadSystemState(): Promise<{ engines: EngineAvailability[]; resources: ResourceStatus[]; machineProfile: MachineProfile; runtimeInstallStatuses: RuntimeInstallStatus[]; modelInstallStatuses: ModelInstallStatus[] }> {
    if (!api) {
      throw new Error('Desktop bridge unavailable.');
    }

    const [engineAvailability, resourceStatus, detectedMachineProfile, installStatuses, modelStatuses] = await Promise.all([
      api.system.getEngineAvailability(),
      api.system.getResourceStatus(),
      api.system.getMachineProfile(),
      api.system.getRuntimeInstallStatuses(),
      api.models.getInstallStatuses()
    ]);

    setEngines(engineAvailability);
    setResources(resourceStatus);
    setMachineProfile(detectedMachineProfile);
    setRuntimeInstallStatuses(installStatuses);
    setModelInstallStatuses(modelStatuses);

    return {
      engines: engineAvailability,
      resources: resourceStatus,
      machineProfile: detectedMachineProfile,
      runtimeInstallStatuses: installStatuses,
      modelInstallStatuses: modelStatuses
    };
  }

  async function installRuntime(runtimeId: EngineRuntimeId): Promise<void> {
    if (!api) {
      setMessage('Desktop bridge unavailable.');
      return;
    }

    setInstallingRuntimeId(runtimeId);
    setMessage('Downloading runtime package.');
    try {
      const result = await api.system.installRuntime(runtimeId);
      await refreshSystemSetup();
      setMessage(`Installed ${runtimeId} ${result.version}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : `Failed to install ${runtimeId}.`);
    } finally {
      setInstallingRuntimeId(null);
    }
  }

  async function installModel(modelId: ModelId): Promise<void> {
    if (!api) {
      setMessage('Desktop bridge unavailable.');
      return;
    }

    setInstallingModelId(modelId);
    setMessage('Downloading model package.');
    try {
      const result = await api.models.install(modelId);
      await refreshSystemSetup();
      setMessage(`Installed ${result.fileName}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : `Failed to install ${modelId}.`);
    } finally {
      setInstallingModelId(null);
    }
  }
  async function handleProgress(event: TranscriptionProgressEvent): Promise<void> {
    const sequence = ++progressRefreshSequence.current;
    const solverLabel = progressEventSolverLabel(event);
    if (solverLabel) {
      setSolverLabelsByJobId((current) => current[event.jobId] === solverLabel ? current : { ...current, [event.jobId]: solverLabel });
    }
    setMessage(shouldShowProgressToast(event) ? event.message : null);
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
    setMessage(null);

    if (!api) {
      setMessage('Desktop bridge unavailable. Open Voxmire through Electron to import media.');
      return;
    }

    if (systemLoading) {
      setMessage('Checking local models and runtimes. Try again in a moment.');
      return;
    }

    setBusy(true);
    try {
      const created = await api.jobs.create({
        modelId: selectedPresetResolution.modelId,
        engineBackend: selectedEngineBackend,
        language: selectedLanguage
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

  async function deleteProjects(jobIds: string[]): Promise<void> {
    if (!api) {
      setMessage('Desktop bridge unavailable.');
      return;
    }

    const uniqueJobIds = Array.from(new Set(jobIds));
    if (uniqueJobIds.length === 0) {
      setBulkDeleteTargets([]);
      return;
    }

    setProjectBusy(true);
    try {
      let deletedCount = 0;
      for (const jobId of uniqueJobIds) {
        const result = await api.projects.delete(jobId);
        if (result.deleted) {
          deletedCount += 1;
        }
      }

      const updated = await api.jobs.list();
      const deletedSelectedJob = selectedJobIdRef.current ? uniqueJobIds.includes(selectedJobIdRef.current) : false;
      const nextSelectedId = deletedSelectedJob ? updated[0]?.job.id ?? null : selectedJobIdRef.current;

      setJobs(updated);
      setSelectedJobId(nextSelectedId);
      if (deletedSelectedJob) {
        setSegments([]);
        setPlaying(false);
        if (!nextSelectedId) {
          setView('dashboard');
        }
      }
      if (detailsJobId && uniqueJobIds.includes(detailsJobId)) {
        setDetailsJobId(null);
      }
      setBulkDeleteTargets([]);
      setMessage(`${deletedCount} ${deletedCount === 1 ? 'project' : 'projects'} deleted. Original media files were not deleted.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to delete selected projects.');
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
      <AppSidebar
        activeView={view}
        collapsed={sidebarCollapsed}
        onSelectView={setView}
        onToggleCollapsed={() => setSidebarCollapsed((collapsed) => !collapsed)}
      />

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
            onDeleteProjects={setBulkDeleteTargets}
            onDetailsProject={openProjectDetails}
            onImport={() => setImportOpen(true)}
            onOpenJob={openJob}
            onOpenVoice={() => setView('voice')}
            onRenameProject={setRenameTarget}
            setupLabel={transcribeSetupLabel}
            setupLoading={systemLoading}
            solverLabelsByJobId={solverLabelsByJobId}
            workspaceLoading={workspaceLoading}
          />
        ) : null}

        <div className="workspace-view-panel" data-active={view === 'transcript'} inert={view !== 'transcript' ? true : undefined}>
          <TranscriptView
            active={view === 'transcript'}
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
            solverLabelsByJobId={solverLabelsByJobId}
            setPlaying={setPlaying}
            splitSegment={splitTranscriptSegment}
            transcriptWorkspaceState={transcriptWorkspaceState}
            setTranscriptWorkspaceState={setTranscriptWorkspaceState}
            mergeSegment={mergeTranscriptSegment}
            replaceSegments={replaceTranscriptSegments}
            resetSegments={resetTranscriptSegments}
            updateSegmentTiming={updateTranscriptSegmentTiming}
            updateSegment={updateTranscriptSegment}
          />
        </div>

        {view === 'voice' ? <VoiceStudioView /> : null}

        {view === 'settings' ? (
          <SettingsView
            appInfo={appInfo}
            engines={engines}
            exportDirectory={exportDirectory}
            machineProfile={machineProfile}
            models={models}
            modelInstallStatuses={modelInstallStatuses}
            onChooseExportDirectory={() => void chooseExportDirectory()}
            installingModelId={installingModelId}
            installingRuntimeId={installingRuntimeId}
            onInstallModel={(modelId) => void installModel(modelId)}
            onInstallRuntime={(runtimeId) => void installRuntime(runtimeId)}
            onResetExportDirectory={() => void resetExportDirectory()}
            resources={resources}
            runtimeInstallStatuses={runtimeInstallStatuses}
            selectedBackendPreference={selectedBackendPreference}
            selectedPresetId={selectedPresetId}
            selectedPresetResolution={selectedPresetResolution}
            setSelectedBackendPreference={setSelectedBackendPreference}
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
          machineProfile={machineProfile}
          selectedBackendPreference={selectedBackendPreference}
          selectedLanguage={selectedLanguage}
          selectedPresetId={selectedPresetId}
          selectedPresetResolution={selectedPresetResolution}
          setSelectedBackendPreference={setSelectedBackendPreference}
          setSelectedLanguage={setSelectedLanguage}
          setSelectedPresetId={setSelectedPresetId}
          setupLoading={systemLoading}
        />
      ) : null}

      {detailsJobId ? (
        <ProjectDetailsDrawer
          details={details}
          loading={detailsLoading}
          onClose={() => setDetailsJobId(null)}
          onDelete={(project) => setDeleteTarget(project)}
          solverLabel={detailsSolverLabel}
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

      {bulkDeleteTargets.length > 0 ? (
        <DeleteProjectsModal
          busy={projectBusy}
          projects={bulkDeleteTargets}
          onClose={() => setBulkDeleteTargets([])}
          onDelete={deleteProjects}
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

function shouldShowProgressToast(event: TranscriptionProgressEvent): boolean {
  return event.status !== 'queued' && event.status !== 'preparing' && event.status !== 'transcribing' && Boolean(event.message);
}

function setupSummaryLabel(summary: CachedSetupSummary): string {
  return `${summary.modelLabel} / ${summary.backend.toUpperCase()}`;
}
