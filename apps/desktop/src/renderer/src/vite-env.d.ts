/// <reference types="vite/client" />

import type {
  CreateJobResult,
  EngineAvailability,
  ExportFormat,
  ExportTranscriptResult,
  JobWithSource,
  ModelProfile,
  ResourceStatus,
  TranscriptSegment,
  TranscriptionJob,
  TranscriptionProgressEvent
} from '@voxmire/contracts';

type VoxmireAppInfo = {
  name: string;
  version: string;
  platform: string;
  arch: string;
};

type Unsubscribe = () => void;

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
      };
      models: {
        list: () => Promise<ModelProfile[]>;
      };
      jobs: {
        create: (input?: { modelId?: string }) => Promise<CreateJobResult | null>;
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
      exports: {
        create: (jobId: string, format: ExportFormat) => Promise<ExportTranscriptResult>;
      };
    };
  }
}

export {};
