import type { CpuThreadPreference, EngineBackend, ExportTextMode, ModelId, TranscriptionLanguage, TranscriptionOutputMode, TranscriptionProgressEvent } from '@voxmire/contracts';
import type { ResourcePaths } from '@voxmire/engine';
import type { VoxmireDatabase } from '@voxmire/storage';

export type RuntimeDirectories = {
  engineOutputDirectory: string;
  exportDirectory: string;
};

export type VoxmireRuntimeOptions = {
  db: VoxmireDatabase;
  resources: ResourcePaths;
  directories: RuntimeDirectories;
  logger?: VoxmireRuntimeLogger;
  onProgress?: (event: TranscriptionProgressEvent) => void;
  getCpuThreadPreference?: () => CpuThreadPreference;
};

export type VoxmireRuntimeLogLevel = 'info' | 'warn' | 'error';

export type VoxmireRuntimeLogEvent = {
  timestamp: string;
  level: VoxmireRuntimeLogLevel;
  event: string;
  jobId: string | null;
  chunkId: string | null;
  message: string;
  details: Record<string, unknown> | null;
};

export type VoxmireRuntimeLogInput = Omit<VoxmireRuntimeLogEvent, 'timestamp'>;

export type VoxmireRuntimeLogger = {
  log: (event: VoxmireRuntimeLogInput) => void;
};

export type CreateTranscriptionJobInput = {
  sourcePath: string;
  modelId: ModelId;
  engineBackend?: EngineBackend;
  language?: TranscriptionLanguage;
  outputMode?: TranscriptionOutputMode;
  startImmediately?: boolean;
};

export type ExportTranscriptOptions = {
  outputDirectory?: string;
  outputPath?: string;
  textMode?: ExportTextMode;
};

export type RecoverInterruptedJobsOptions = {
  start?: boolean;
};

export type JobRecoveryResult = {
  jobId: string;
  status: 'skipped-active' | 'queued' | 'started' | 'completed' | 'failed';
  resetChunkCount: number;
  message: string;
};
