import { contextBridge, ipcRenderer } from 'electron';
import type {
  CreateJobResult,
  EngineAvailability,
  EngineBackend,
  ExportFormat,
  ExportTranscriptResult,
  JobWithSource,
  MachineProfile,
  ModelProfile,
  ResourceStatus,
  TranscriptSegment,
  TranscriptionJob,
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
  system: {
    getEngineAvailability: (): Promise<EngineAvailability[]> => ipcRenderer.invoke('system:get-engine-availability'),
    getResourceStatus: (): Promise<ResourceStatus[]> => ipcRenderer.invoke('system:get-resource-status'),
    getMachineProfile: (): Promise<MachineProfile> => ipcRenderer.invoke('system:get-machine-profile')
  },
  models: {
    list: (): Promise<ModelProfile[]> => ipcRenderer.invoke('models:list')
  },
  jobs: {
    create: (input?: { presetId?: TranscriptionPresetId; modelId?: string; engineBackend?: EngineBackend }): Promise<CreateJobResult | null> => ipcRenderer.invoke('jobs:create', input ?? {}),
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
  transcripts: {
    get: (jobId: string): Promise<TranscriptSegment[]> => ipcRenderer.invoke('transcripts:get', jobId)
  },
  exports: {
    create: (jobId: string, format: ExportFormat): Promise<ExportTranscriptResult> =>
      ipcRenderer.invoke('exports:create', { jobId, format })
  }
};

contextBridge.exposeInMainWorld('voxmire', api);
