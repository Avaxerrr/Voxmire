import { z } from 'zod';

export const jobStatusSchema = z.enum([
  'queued',
  'preparing',
  'transcribing',
  'paused',
  'completed',
  'failed',
  'canceled'
]);

export const exportFormatSchema = z.enum(['txt', 'json', 'srt', 'vtt']);

export const engineKindSchema = z.enum(['whisper.cpp']);

export const engineBackendSchema = z.enum(['cpu', 'cuda', 'vulkan']);

export const modelIdSchema = z.enum(['large-v3-turbo', 'large-v3', 'distil-large-v3.5', 'medium']);

export const sourceFileSchema = z.object({
  id: z.string().min(1),
  path: z.string().min(1),
  name: z.string().min(1),
  extension: z.string().min(1),
  sizeBytes: z.number().int().nonnegative(),
  durationSeconds: z.number().nonnegative().nullable(),
  createdAt: z.string().datetime()
});

export const transcriptionJobSchema = z.object({
  id: z.string().min(1),
  sourceFileId: z.string().min(1),
  status: jobStatusSchema,
  modelId: modelIdSchema,
  engineBackend: engineBackendSchema,
  progress: z.number().min(0).max(1),
  errorMessage: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable()
});

export const transcriptSegmentSchema = z.object({
  id: z.string().min(1),
  jobId: z.string().min(1),
  index: z.number().int().nonnegative(),
  startSeconds: z.number().nonnegative(),
  endSeconds: z.number().nonnegative(),
  text: z.string(),
  confidence: z.number().min(0).max(1).nullable(),
  createdAt: z.string().datetime()
});

export const transcriptionChunkStatusSchema = z.enum(['queued', 'preparing', 'transcribing', 'completed', 'failed', 'canceled']);

export const transcriptionChunkSchema = z.object({
  id: z.string().min(1),
  jobId: z.string().min(1),
  index: z.number().int().nonnegative(),
  startSeconds: z.number().nonnegative(),
  endSeconds: z.number().nonnegative(),
  filePath: z.string().min(1),
  status: transcriptionChunkStatusSchema,
  errorMessage: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable()
});

export const modelProfileSchema = z.object({
  id: modelIdSchema,
  label: z.string().min(1),
  purpose: z.string().min(1),
  description: z.string().min(1),
  recommended: z.boolean(),
  languages: z.enum(['multilingual', 'english-focused']),
  relativeSpeed: z.enum(['fast', 'balanced', 'slow']),
  relativeQuality: z.enum(['good', 'better', 'best'])
});

export const engineAvailabilitySchema = z.object({
  id: z.string().min(1),
  kind: engineKindSchema,
  backend: engineBackendSchema,
  label: z.string().min(1),
  available: z.boolean(),
  executablePath: z.string().nullable(),
  reason: z.string().nullable()
});

export const transcriptionProgressEventSchema = z.object({
  jobId: z.string().min(1),
  status: jobStatusSchema,
  progress: z.number().min(0).max(1),
  message: z.string().nullable(),
  segment: transcriptSegmentSchema.nullable()
});

export const createJobInputSchema = z.object({
  modelId: modelIdSchema.default('large-v3-turbo')
});

export const createJobResultSchema = z.object({
  job: transcriptionJobSchema,
  sourceFile: sourceFileSchema
});

export const jobWithSourceSchema = z.object({
  job: transcriptionJobSchema,
  sourceFile: sourceFileSchema
});

export const exportTranscriptInputSchema = z.object({
  jobId: z.string().min(1),
  format: exportFormatSchema
});

export const exportTranscriptResultSchema = z.object({
  path: z.string().min(1),
  format: exportFormatSchema
});


export const resourceKindSchema = z.enum(['ffmpeg', 'ffprobe', 'whisper-engine', 'model']);

export const resourceStatusSchema = z.object({
  id: z.string().min(1),
  kind: resourceKindSchema,
  label: z.string().min(1),
  required: z.boolean(),
  available: z.boolean(),
  path: z.string().min(1),
  sourceUrl: z.string().url().nullable(),
  reason: z.string().nullable()
});
export type ResourceKind = z.infer<typeof resourceKindSchema>;
export type ResourceStatus = z.infer<typeof resourceStatusSchema>;
export type JobStatus = z.infer<typeof jobStatusSchema>;
export type ExportFormat = z.infer<typeof exportFormatSchema>;
export type EngineKind = z.infer<typeof engineKindSchema>;
export type EngineBackend = z.infer<typeof engineBackendSchema>;
export type ModelId = z.infer<typeof modelIdSchema>;
export type SourceFile = z.infer<typeof sourceFileSchema>;
export type TranscriptionJob = z.infer<typeof transcriptionJobSchema>;
export type TranscriptSegment = z.infer<typeof transcriptSegmentSchema>;
export type TranscriptionChunkStatus = z.infer<typeof transcriptionChunkStatusSchema>;
export type TranscriptionChunk = z.infer<typeof transcriptionChunkSchema>;
export type ModelProfile = z.infer<typeof modelProfileSchema>;
export type EngineAvailability = z.infer<typeof engineAvailabilitySchema>;
export type TranscriptionProgressEvent = z.infer<typeof transcriptionProgressEventSchema>;
export type CreateJobInput = z.input<typeof createJobInputSchema>;
export type CreateJobResult = z.infer<typeof createJobResultSchema>;
export type JobWithSource = z.infer<typeof jobWithSourceSchema>;
export type ExportTranscriptInput = z.infer<typeof exportTranscriptInputSchema>;
export type ExportTranscriptResult = z.infer<typeof exportTranscriptResultSchema>;
