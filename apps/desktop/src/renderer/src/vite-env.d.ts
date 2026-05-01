/// <reference types="vite/client" />

import type {
  CreateJobResult,
  EngineAvailability,
  EngineBackend,
  EngineRuntimeId,
  ExportFormat,
  ExportTranscriptResult,
  ExportTextMode,
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
  TranscriptionLanguage,
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
    __VOXMIRE_PLAYBACK_TRACE__?: Array<{
      activeSegmentIndex: number;
      anomaly: string | null;
      gapSeconds: number | null;
      mediaClockDriftSeconds: number | null;
      mediaSegmentIndex: number;
      mediaTime: number | null;
      playbackTime: number;
      reason: string;
      segmentEndSeconds: number | null;
      segmentId: string | null;
      segmentStartSeconds: number | null;
      stateSegmentOffsetSeconds: number | null;
      wordDurationSeconds: number | null;
      wordEndSeconds: number | null;
      wordIndex: number;
      wordStartSeconds: number | null;
      wordText: string | null;
    }>;
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
        getRuntimeInstallStatuses: () => Promise<RuntimeInstallStatus[]>;
        installRuntime: (runtimeId: EngineRuntimeId) => Promise<RuntimeInstallResult>;
      };
      models: {
        list: () => Promise<ModelProfile[]>;
        getInstallStatuses: () => Promise<ModelInstallStatus[]>;
        install: (modelId: ModelId) => Promise<ModelInstallResult>;
      };
      jobs: {
        create: (input?: { presetId?: TranscriptionPresetId; modelId?: string; engineBackend?: EngineBackend; language?: TranscriptionLanguage }) => Promise<CreateJobResult | null>;
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
        replaceSegments: (jobId: string, segments: TranscriptSegment[]) => Promise<TranscriptSegment[]>;
        resetSegments: (jobId: string) => Promise<TranscriptSegmentListResult>;
      };
      media: {
        getSourceUrl: (jobId: string) => Promise<string | null>;
        getInfo: (jobId: string) => Promise<VoxmireMediaInfo | null>;
        getWaveform: (jobId: string) => Promise<{ durationSeconds: number | null; peaks: number[] } | null>;
      };
      exports: {
        chooseDirectory: () => Promise<string | null>;
        create: (jobId: string, format: ExportFormat, textMode?: ExportTextMode) => Promise<ExportTranscriptResult | null>;
        getDirectory: () => Promise<string>;
        resetDirectory: () => Promise<string>;
      };
    };
  }
}

export {};
