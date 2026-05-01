import type { DatabaseSync } from 'node:sqlite';
import type { EngineBackend, ModelId, SourceFile, TranscriptionLanguage, TranscriptionOutputMode, TranscriptSegment } from '@voxmire/contracts';

export type VoxmireDatabase = DatabaseSync;

export type CreateJobRecordInput = {
  sourceFile: SourceFile;
  modelId: ModelId;
  engineBackend?: EngineBackend;
  language?: TranscriptionLanguage;
  outputMode?: TranscriptionOutputMode;
};

export type TranscriptSegmentListUpdate = {
  segments: TranscriptSegment[];
  error: string | null;
};
