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

export const transcriptionPresetIdSchema = z.enum(['balanced', 'fast', 'quality', 'low-memory']);

export const transcriptionPresetBackendPreferenceSchema = z.enum(['auto', 'cpu']);

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
  originalText: z.string().nullable().optional(),
  confidence: z.number().min(0).max(1).nullable(),
  createdAt: z.string().datetime(),
  editedAt: z.string().datetime().nullable().optional()
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

export const transcriptionPresetProfileSchema = z.object({
  id: transcriptionPresetIdSchema,
  label: z.string().min(1),
  purpose: z.string().min(1),
  description: z.string().min(1),
  recommended: z.boolean(),
  modelId: modelIdSchema,
  backendPreference: transcriptionPresetBackendPreferenceSchema
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

export const machineBackendProfileSchema = z.object({
  backend: engineBackendSchema,
  label: z.string().min(1),
  executableAvailable: z.boolean(),
  runtimeAvailable: z.boolean(),
  recommended: z.boolean(),
  reason: z.string().nullable()
});

export const machineProfileSchema = z.object({
  platform: z.string().min(1),
  arch: z.string().min(1),
  logicalCpuCores: z.number().int().positive(),
  totalMemoryBytes: z.number().int().positive(),
  recommendedBackend: engineBackendSchema,
  recommendedModelId: modelIdSchema,
  backends: z.array(machineBackendProfileSchema),
  notes: z.array(z.string())
});

export const transcriptionProgressEventSchema = z.object({
  jobId: z.string().min(1),
  status: jobStatusSchema,
  progress: z.number().min(0).max(1),
  message: z.string().nullable(),
  segment: transcriptSegmentSchema.nullable()
});

export const createJobInputSchema = z.object({
  presetId: transcriptionPresetIdSchema.optional(),
  modelId: modelIdSchema.default('large-v3-turbo'),
  engineBackend: engineBackendSchema.default('cpu')
});

export const createJobResultSchema = z.object({
  job: transcriptionJobSchema,
  sourceFile: sourceFileSchema
});

export const jobWithSourceSchema = z.object({
  job: transcriptionJobSchema,
  sourceFile: sourceFileSchema
});

export const projectDetailsSchema = z.object({
  job: transcriptionJobSchema,
  sourceFile: sourceFileSchema,
  segmentCount: z.number().int().nonnegative(),
  chunkCount: z.number().int().nonnegative(),
  mediaAvailable: z.boolean()
});

export const renameProjectInputSchema = z.object({
  jobId: z.string().min(1),
  name: z.string().trim().min(1).max(180)
});

export const deleteProjectInputSchema = z.object({
  jobId: z.string().min(1)
});

export const deleteProjectResultSchema = z.object({
  jobId: z.string().min(1),
  deleted: z.boolean()
});

export const updateTranscriptSegmentInputSchema = z.object({
  jobId: z.string().min(1),
  segmentId: z.string().min(1),
  text: z.string().max(20000)
});

export const updateTranscriptSegmentResultSchema = z.object({
  segment: transcriptSegmentSchema.nullable()
});

export const updateTranscriptSegmentTimingInputSchema = z.object({
  jobId: z.string().min(1),
  segmentId: z.string().min(1),
  startSeconds: z.number().nonnegative(),
  endSeconds: z.number().positive()
});

export const transcriptSegmentListResultSchema = z.object({
  segments: z.array(transcriptSegmentSchema),
  error: z.string().nullable()
});

export const splitTranscriptSegmentInputSchema = z.object({
  jobId: z.string().min(1),
  segmentId: z.string().min(1),
  offset: z.number().int().positive()
});

export const splitTranscriptSegmentResultSchema = z.object({
  segments: z.array(transcriptSegmentSchema)
});

export const mergeTranscriptSegmentInputSchema = z.object({
  jobId: z.string().min(1),
  segmentId: z.string().min(1),
  direction: z.enum(['previous', 'next'])
});

export const mergeTranscriptSegmentResultSchema = z.object({
  segments: z.array(transcriptSegmentSchema)
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
export type TranscriptionPresetId = z.infer<typeof transcriptionPresetIdSchema>;
export type TranscriptionPresetBackendPreference = z.infer<typeof transcriptionPresetBackendPreferenceSchema>;
export type SourceFile = z.infer<typeof sourceFileSchema>;
export type TranscriptionJob = z.infer<typeof transcriptionJobSchema>;
export type TranscriptSegment = z.infer<typeof transcriptSegmentSchema>;
export type TranscriptionChunkStatus = z.infer<typeof transcriptionChunkStatusSchema>;
export type TranscriptionChunk = z.infer<typeof transcriptionChunkSchema>;
export type ModelProfile = z.infer<typeof modelProfileSchema>;
export type TranscriptionPresetProfile = z.infer<typeof transcriptionPresetProfileSchema>;
export type EngineAvailability = z.infer<typeof engineAvailabilitySchema>;
export type MachineBackendProfile = z.infer<typeof machineBackendProfileSchema>;
export type MachineProfile = z.infer<typeof machineProfileSchema>;
export type TranscriptionProgressEvent = z.infer<typeof transcriptionProgressEventSchema>;
export type CreateJobInput = z.input<typeof createJobInputSchema>;
export type CreateJobResult = z.infer<typeof createJobResultSchema>;
export type JobWithSource = z.infer<typeof jobWithSourceSchema>;
export type ProjectDetails = z.infer<typeof projectDetailsSchema>;
export type RenameProjectInput = z.input<typeof renameProjectInputSchema>;
export type DeleteProjectInput = z.input<typeof deleteProjectInputSchema>;
export type DeleteProjectResult = z.infer<typeof deleteProjectResultSchema>;
export type UpdateTranscriptSegmentInput = z.input<typeof updateTranscriptSegmentInputSchema>;
export type UpdateTranscriptSegmentResult = z.infer<typeof updateTranscriptSegmentResultSchema>;
export type UpdateTranscriptSegmentTimingInput = z.input<typeof updateTranscriptSegmentTimingInputSchema>;
export type TranscriptSegmentListResult = z.infer<typeof transcriptSegmentListResultSchema>;
export type SplitTranscriptSegmentInput = z.input<typeof splitTranscriptSegmentInputSchema>;
export type SplitTranscriptSegmentResult = z.infer<typeof splitTranscriptSegmentResultSchema>;
export type MergeTranscriptSegmentInput = z.input<typeof mergeTranscriptSegmentInputSchema>;
export type MergeTranscriptSegmentResult = z.infer<typeof mergeTranscriptSegmentResultSchema>;
export type ExportTranscriptInput = z.infer<typeof exportTranscriptInputSchema>;
export type ExportTranscriptResult = z.infer<typeof exportTranscriptResultSchema>;
