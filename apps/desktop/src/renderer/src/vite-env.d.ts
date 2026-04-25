/// <reference types="vite/client" />

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

type VoxmireAppInfo = {
  name: string;
  version: string;
  platform: string;
  arch: string;
};

type Unsubscribe = () => void;

type VoxmireMediaInfo = {
  contentType: string;
  hasAudio: boolean;
  hasVideo: boolean;
  kind: 'audio' | 'video';
};

declare global {
  interface Window {
    voxmire: {
      app: {
        getInfo: () => Promise<VoxmireAppInfo>;
      };
      window: {
        minimize: () => Promise<void>;
        toggleMaximize: () => Promise<boolean>;
        close: () => Promise<void>;
        isMaximized: () => Promise<boolean>;
      };
      system: {
        getEngineAvailability: () => Promise<EngineAvailability[]>;
        getResourceStatus: () => Promise<ResourceStatus[]>;
        getMachineProfile: () => Promise<MachineProfile>;
      };
      models: {
        list: () => Promise<ModelProfile[]>;
      };
      jobs: {
        create: (input?: { presetId?: TranscriptionPresetId; modelId?: string; engineBackend?: EngineBackend }) => Promise<CreateJobResult | null>;
        list: () => Promise<JobWithSource[]>;
        get: (jobId: string) => Promise<JobWithSource | null>;
        cancel: (jobId: string) => Promise<TranscriptionJob | null>;
        pause: (jobId: string) => Promise<TranscriptionJob | null>;
        resume: (jobId: string) => Promise<JobWithSource | null>;
        onProgress: (callback: (event: TranscriptionProgressEvent) => void) => Unsubscribe;
      };
      transcripts: {
        get: (jobId: string) => Promise<TranscriptSegment[]>;
      };
      media: {
        getSourceUrl: (jobId: string) => Promise<string | null>;
        getInfo: (jobId: string) => Promise<VoxmireMediaInfo | null>;
        getWaveform: (jobId: string) => Promise<{ durationSeconds: number | null; peaks: number[] } | null>;
      };
      exports: {
        create: (jobId: string, format: ExportFormat) => Promise<ExportTranscriptResult>;
      };
    };
  }
}

export {};
