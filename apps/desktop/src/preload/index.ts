import { contextBridge, ipcRenderer } from 'electron';
import type {
  CreateJobResult,
  CpuThreadPreference,
  EngineAvailability,
  EngineBackend,
  EngineRuntimeId,
  ExportFormat,
  ExportTextMode,
  ExportTranscriptResult,
  JobWithSource,
  MachineProfile,
  ModelId,
  ModelInstallResult,
  ModelInstallStatus,
  ModelProfile,
  ProjectDetails,
  ResourceStatus,
  RuntimeInstallResult,
  RuntimeInstallStatus,
  TranscriptSegment,
  TranscriptSegmentListResult,
  TranscriptionJob,
  TranscriptionSettings,
  TranscriptionLanguage,
  TranscriptionOutputMode,
  TranscriptionPresetId,
  TranscriptionProgressEvent
} from '@voxmire/contracts';

type Unsubscribe = () => void;

const api = {
  app: {
    getInfo: () => ipcRenderer.invoke('app:get-info')
  },
  window: {
    minimize: (): Promise<void> => ipcRenderer.invoke('window:minimize'),
    toggleMaximize: (): Promise<boolean> => ipcRenderer.invoke('window:toggle-maximize'),
    close: (): Promise<void> => ipcRenderer.invoke('window:close'),
    isMaximized: (): Promise<boolean> => ipcRenderer.invoke('window:is-maximized')
  },
  settings: {
    getTranscription: (): Promise<TranscriptionSettings> => ipcRenderer.invoke('settings:get-transcription'),
    updateTranscription: (input: { cpuThreadPreference: CpuThreadPreference }): Promise<TranscriptionSettings> =>
      ipcRenderer.invoke('settings:update-transcription', input)
  },
  system: {
    getEngineAvailability: (): Promise<EngineAvailability[]> => ipcRenderer.invoke('system:get-engine-availability'),
    getResourceStatus: (): Promise<ResourceStatus[]> => ipcRenderer.invoke('system:get-resource-status'),
    getMachineProfile: (): Promise<MachineProfile> => ipcRenderer.invoke('system:get-machine-profile'),
    getRuntimeInstallStatuses: (): Promise<RuntimeInstallStatus[]> => ipcRenderer.invoke('system:get-runtime-install-statuses'),
    installRuntime: (runtimeId: EngineRuntimeId): Promise<RuntimeInstallResult> => ipcRenderer.invoke('system:install-runtime', { runtimeId })
  },
  models: {
    list: (): Promise<ModelProfile[]> => ipcRenderer.invoke('models:list'),
    getInstallStatuses: (): Promise<ModelInstallStatus[]> => ipcRenderer.invoke('models:get-install-statuses'),
    install: (modelId: ModelId): Promise<ModelInstallResult> => ipcRenderer.invoke('models:install', { modelId })
  },
  jobs: {
    create: (input?: { presetId?: TranscriptionPresetId; modelId?: string; engineBackend?: EngineBackend; language?: TranscriptionLanguage; outputMode?: TranscriptionOutputMode }): Promise<CreateJobResult | null> => ipcRenderer.invoke('jobs:create', input ?? {}),
    list: (): Promise<JobWithSource[]> => ipcRenderer.invoke('jobs:list'),
    get: (jobId: string): Promise<JobWithSource | null> => ipcRenderer.invoke('jobs:get', jobId),
    cancel: (jobId: string): Promise<TranscriptionJob | null> => ipcRenderer.invoke('jobs:cancel', jobId),
    pause: (jobId: string): Promise<TranscriptionJob | null> => ipcRenderer.invoke('jobs:pause', jobId),
    resume: (jobId: string): Promise<JobWithSource | null> => ipcRenderer.invoke('jobs:resume', jobId),
    onProgress: (callback: (event: TranscriptionProgressEvent) => void): Unsubscribe => {
      const listener = (_event: Electron.IpcRendererEvent, progress: TranscriptionProgressEvent) => callback(progress);
      ipcRenderer.on('jobs:progress', listener);
      return () => ipcRenderer.removeListener('jobs:progress', listener);
    }
  },
  projects: {
    getDetails: (jobId: string): Promise<ProjectDetails | null> => ipcRenderer.invoke('projects:get-details', jobId),
    rename: (jobId: string, name: string): Promise<JobWithSource | null> =>
      ipcRenderer.invoke('projects:rename', { jobId, name }),
    delete: (jobId: string): Promise<{ jobId: string; deleted: boolean }> =>
      ipcRenderer.invoke('projects:delete', { jobId })
  },
  transcripts: {
    get: (jobId: string): Promise<TranscriptSegment[]> => ipcRenderer.invoke('transcripts:get', jobId),
    updateSegment: (jobId: string, segmentId: string, text: string): Promise<TranscriptSegment | null> =>
      ipcRenderer.invoke('transcripts:update-segment', { jobId, segmentId, text }),
    updateTiming: (jobId: string, segmentId: string, startSeconds: number, endSeconds: number): Promise<TranscriptSegmentListResult> =>
      ipcRenderer.invoke('transcripts:update-timing', { jobId, segmentId, startSeconds, endSeconds }),
    splitSegment: (jobId: string, segmentId: string, offset: number): Promise<TranscriptSegment[]> =>
      ipcRenderer.invoke('transcripts:split-segment', { jobId, segmentId, offset }),
    mergeSegment: (jobId: string, segmentId: string, direction: 'previous' | 'next'): Promise<TranscriptSegment[]> =>
      ipcRenderer.invoke('transcripts:merge-segment', { jobId, segmentId, direction }),
    replaceSegments: (jobId: string, segments: TranscriptSegment[]): Promise<TranscriptSegment[]> =>
      ipcRenderer.invoke('transcripts:replace-segments', { jobId, segments }),
    resetSegments: (jobId: string): Promise<TranscriptSegmentListResult> =>
      ipcRenderer.invoke('transcripts:reset-segments', { jobId })
  },
  media: {
    getSourceUrl: (jobId: string): Promise<string | null> => ipcRenderer.invoke('media:get-source-url', jobId),
    getInfo: (jobId: string): Promise<{ contentType: string; hasAudio: boolean; hasVideo: boolean; kind: 'audio' | 'video' } | null> =>
      ipcRenderer.invoke('media:get-info', jobId),
    getWaveform: (jobId: string): Promise<{ durationSeconds: number | null; peaks: number[] } | null> =>
      ipcRenderer.invoke('media:get-waveform', jobId)
  },
  exports: {
    chooseDirectory: (): Promise<string | null> => ipcRenderer.invoke('exports:choose-directory'),
    create: (jobId: string, format: ExportFormat, textMode: ExportTextMode = 'plain'): Promise<ExportTranscriptResult | null> =>
      ipcRenderer.invoke('exports:create', { jobId, format, textMode }),
    getDirectory: (): Promise<string> => ipcRenderer.invoke('exports:get-directory'),
    resetDirectory: (): Promise<string> => ipcRenderer.invoke('exports:reset-directory')
  }
};

contextBridge.exposeInMainWorld('voxmire', api);
