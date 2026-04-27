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
  ProjectDetails,
  ResourceStatus,
  TranscriptSegment,
  TranscriptSegmentListResult,
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
      projects: {
        getDetails: (jobId: string) => Promise<ProjectDetails | null>;
        rename: (jobId: string, name: string) => Promise<JobWithSource | null>;
        delete: (jobId: string) => Promise<{ jobId: string; deleted: boolean }>;
      };
      transcripts: {
        get: (jobId: string) => Promise<TranscriptSegment[]>;
        updateSegment: (jobId: string, segmentId: string, text: string) => Promise<TranscriptSegment | null>;
        updateTiming: (jobId: string, segmentId: string, startSeconds: number, endSeconds: number) => Promise<TranscriptSegmentListResult>;
        splitSegment: (jobId: string, segmentId: string, offset: number) => Promise<TranscriptSegment[]>;
        mergeSegment: (jobId: string, segmentId: string, direction: 'previous' | 'next') => Promise<TranscriptSegment[]>;
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
