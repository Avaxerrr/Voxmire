import type { EngineAvailability, EngineBackend, EngineRuntimeId, TranscriptionLanguage, TranscriptionOutputMode, TranscriptionProgressEvent } from '@voxmire/contracts';

export type ResourcePaths = {
  projectRoot: string;
  userResourceRoot?: string;
};

export type ProbeResult = {
  durationSeconds: number | null;
  formatName: string | null;
};

export type PreparedAudioChunk = {
  index: number;
  startSeconds: number;
  endSeconds: number;
  filePath: string;
};

export type PrepareAudioOptions = {
  sourcePath: string;
  jobId: string;
  outputDirectory: string;
  durationSeconds: number | null;
  targetChunkSeconds: number;
  overlapSeconds: number;
  maxSecondsBeforeChunking: number;
  signal?: AbortSignal;
};

export type TranscriptionInput = {
  jobId: string;
  sourcePath: string;
  modelPath: string;
  language?: TranscriptionLanguage;
  outputMode?: TranscriptionOutputMode;
  outputDirectory: string;
  outputBaseName?: string;
  signal?: AbortSignal;
};

export interface TranscriptionEngine {
  id: string;
  backend: EngineBackend;
  detect(): Promise<EngineAvailability>;
  transcribe(input: TranscriptionInput): AsyncIterable<TranscriptionProgressEvent>;
}
