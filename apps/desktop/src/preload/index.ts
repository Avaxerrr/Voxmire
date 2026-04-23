import { contextBridge, ipcRenderer } from 'electron';
import type {
  CreateJobResult,
  EngineAvailability,
  ExportFormat,
  ExportTranscriptResult,
  JobWithSource,
  ModelProfile,
  TranscriptSegment,
  TranscriptionJob,
  TranscriptionProgressEvent
} from '@voxmire/contracts';

type Unsubscribe = () => void;

const api = {
  app: {
    getInfo: () => ipcRenderer.invoke('app:get-info')
  },
  system: {
    getEngineAvailability: (): Promise<EngineAvailability[]> => ipcRenderer.invoke('system:get-engine-availability')
  },
  models: {
    list: (): Promise<ModelProfile[]> => ipcRenderer.invoke('models:list')
  },
  jobs: {
    create: (input?: { modelId?: string }): Promise<CreateJobResult | null> => ipcRenderer.invoke('jobs:create', input ?? {}),
    list: (): Promise<JobWithSource[]> => ipcRenderer.invoke('jobs:list'),
    get: (jobId: string): Promise<JobWithSource | null> => ipcRenderer.invoke('jobs:get', jobId),
    cancel: (jobId: string): Promise<TranscriptionJob | null> => ipcRenderer.invoke('jobs:cancel', jobId),
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
