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
export const exportTextModeSchema = z.enum(['plain', 'timestamps']);

export const engineKindSchema = z.enum(['whisper.cpp']);

export const engineBackendSchema = z.enum(['cpu', 'cuda', 'vulkan']);

export const engineRuntimeIdSchema = z.enum(['cuda-12.4', 'vulkan', 'cpu-blas', 'cpu']);

export const transcriptionLanguageSchema = z.enum(['auto', 'en', 'es', 'fr', 'de', 'it', 'pt', 'nl', 'ja', 'ko', 'zh', 'ru', 'ar', 'hi', 'vi', 'id', 'tr', 'pl', 'uk']);

export const transcriptionOutputModeSchema = z.enum(['transcribe', 'translate']);

export const cpuThreadPreferenceSchema = z.union([z.literal('auto'), z.number().int().min(1).max(64)]);

export const transcriptionSettingsSchema = z.object({
  cpuThreadPreference: cpuThreadPreferenceSchema.default('auto')
});

export const updateTranscriptionSettingsInputSchema = z.object({
  cpuThreadPreference: cpuThreadPreferenceSchema
});

export const detectedLanguageSchema = z.string().trim().min(1).nullable();

export const modelIdSchema = z.enum(['small-q8_0', 'large-v3-turbo', 'large-v3', 'distil-large-v3.5', 'medium']);

export const transcriptionPresetIdSchema = z.enum(['balanced', 'fast', 'quality', 'low-memory']);

export const transcriptionPresetBackendPreferenceSchema = z.enum(['auto', 'cpu']);

export const transcriptAlignmentStatusSchema = z.enum(['aligned', 'partial', 'stale', 'none']);

export const transcriptWordTimingSchema = z.object({
  text: z.string().trim().min(1),
  startSeconds: z.number().nonnegative(),
  endSeconds: z.number().nonnegative()
}).refine((word) => word.endSeconds > word.startSeconds, {
  message: 'Word timing end must be greater than start.'
});

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
  language: transcriptionLanguageSchema.default('auto'),
  outputMode: transcriptionOutputModeSchema.default('transcribe'),
  detectedLanguage: detectedLanguageSchema.default(null),
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
  wordTimings: z.array(transcriptWordTimingSchema).optional(),
  alignmentStatus: transcriptAlignmentStatusSchema.optional(),
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
  completedAt: z.string().datetime().nullable(),
  startedAt: z.string().datetime().nullable().optional(),
  runtimeId: engineRuntimeIdSchema.nullable().optional(),
  processingDurationMs: z.number().int().nonnegative().nullable().optional()
});

export const transcriptionChunkProcessingStatsSchema = z.object({
  id: z.string().min(1),
  index: z.number().int().nonnegative(),
  startedAt: z.string().datetime().nullable(),
  completedAt: z.string().datetime().nullable(),
  runtimeId: engineRuntimeIdSchema.nullable(),
  processingDurationMs: z.number().int().nonnegative().nullable()
});

export const transcriptionJobProcessingStatsSchema = z.object({
  startedAt: z.string().datetime().nullable(),
  completedAt: z.string().datetime().nullable(),
  activeDurationMs: z.number().int().nonnegative().nullable(),
  averageChunkDurationMs: z.number().int().nonnegative().nullable(),
  completedChunkCount: z.number().int().nonnegative(),
  chunks: z.array(transcriptionChunkProcessingStatsSchema)
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
  runtimeId: engineRuntimeIdSchema,
  kind: engineKindSchema,
  backend: engineBackendSchema,
  label: z.string().min(1),
  runtimeVersion: z.string().min(1).nullable().optional(),
  available: z.boolean(),
  executablePath: z.string().nullable(),
  reason: z.string().nullable()
});


export const runtimePackagePartSchema = z.object({
  index: z.number().int().positive(),
  objectKey: z.string().min(1),
  packagePath: z.string().min(1).optional(),
  sizeBytes: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/i),
  url: z.string().url().nullable().optional()
});

export const whisperRuntimePackageSchema = z.object({
  runtimeId: engineRuntimeIdSchema,
  backend: engineBackendSchema,
  label: z.string().min(1),
  platform: z.string().min(1),
  arch: z.string().min(1),
  whisperCppVersion: z.string().min(1),
  runtimeDirectoryName: z.string().min(1),
  objectKey: z.string().min(1),
  assetName: z.string().min(1).optional(),
  url: z.string().url().nullable().optional(),
  packagePath: z.string().min(1).optional(),
  sizeBytes: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/i),
  parts: z.array(runtimePackagePartSchema).optional(),
  requiredFiles: z.array(z.string().min(1)),
  preparedAt: z.string().datetime().optional()
});

export const whisperRuntimeManifestSchema = z.object({
  schemaVersion: z.number().int().positive(),
  updatedAt: z.string().datetime().nullable(),
  provider: z.object({
    type: z.enum(['r2', 'github-release']),
    bucket: z.string().min(1).nullable().optional(),
    owner: z.string().min(1).optional(),
    repo: z.string().min(1).optional(),
    publicBaseUrl: z.string().url().nullable().optional()
  }),
  channels: z.record(z.string(), z.record(z.string(), z.record(engineRuntimeIdSchema, z.string().min(1)))),
  packages: z.array(whisperRuntimePackageSchema)
});


export const whisperModelPackageSchema = z.object({
  modelId: modelIdSchema,
  label: z.string().min(1),
  fileName: z.string().min(1),
  url: z.string().url().nullable().optional(),
  sizeBytes: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/i),
  bundled: z.boolean().default(false),
  recommended: z.boolean().default(false),
  purpose: z.string().min(1),
  description: z.string().min(1)
});

export const whisperModelManifestSchema = z.object({
  schemaVersion: z.number().int().positive(),
  updatedAt: z.string().datetime().nullable(),
  provider: z.object({
    type: z.literal('huggingface'),
    repo: z.string().min(1),
    publicBaseUrl: z.string().url()
  }),
  models: z.array(whisperModelPackageSchema)
});

export const modelInstallStatusSchema = z.object({
  modelId: modelIdSchema,
  label: z.string().min(1),
  fileName: z.string().min(1),
  installed: z.boolean(),
  bundled: z.boolean(),
  downloadable: z.boolean(),
  recommended: z.boolean(),
  purpose: z.string().min(1),
  description: z.string().min(1),
  sizeBytes: z.number().int().nonnegative().nullable(),
  path: z.string().min(1).nullable(),
  source: z.enum(['user', 'bundled', 'none']),
  reason: z.string().nullable()
});

export const installModelInputSchema = z.object({
  modelId: modelIdSchema
});

export const modelInstallResultSchema = z.object({
  modelId: modelIdSchema,
  fileName: z.string().min(1),
  installedPath: z.string().min(1),
  installed: z.boolean()
});
export const runtimeInstallStatusSchema = z.object({
  runtimeId: engineRuntimeIdSchema,
  label: z.string().min(1),
  platform: z.string().min(1),
  version: z.string().min(1).nullable(),
  installedVersion: z.string().min(1).nullable(),
  installed: z.boolean(),
  downloadable: z.boolean(),
  sizeBytes: z.number().int().nonnegative().nullable(),
  partCount: z.number().int().nonnegative(),
  reason: z.string().nullable()
});

export const installRuntimeInputSchema = z.object({
  runtimeId: engineRuntimeIdSchema
});

export const runtimeInstallResultSchema = z.object({
  runtimeId: engineRuntimeIdSchema,
  version: z.string().min(1),
  installedDirectory: z.string().min(1),
  installed: z.boolean()
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
  segment: transcriptSegmentSchema.nullable(),
  engineRuntimeId: engineRuntimeIdSchema.nullable().optional(),
  engineLabel: z.string().min(1).nullable().optional(),
  detectedLanguage: detectedLanguageSchema.optional()
});

export const createJobInputSchema = z.object({
  presetId: transcriptionPresetIdSchema.optional(),
  modelId: modelIdSchema.default('large-v3-turbo'),
  engineBackend: engineBackendSchema.default('cpu'),
  language: transcriptionLanguageSchema.default('auto'),
  outputMode: transcriptionOutputModeSchema.default('transcribe')
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
  processingStats: transcriptionJobProcessingStatsSchema.nullable(),
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

export const replaceTranscriptSegmentsInputSchema = z.object({
  jobId: z.string().min(1),
  segments: z.array(transcriptSegmentSchema)
});

export const replaceTranscriptSegmentsResultSchema = z.object({
  segments: z.array(transcriptSegmentSchema)
});

export const resetTranscriptSegmentsInputSchema = z.object({
  jobId: z.string().min(1)
});

export const resetTranscriptSegmentsResultSchema = transcriptSegmentListResultSchema;

export const exportTranscriptInputSchema = z.object({
  jobId: z.string().min(1),
  format: exportFormatSchema,
  textMode: exportTextModeSchema.default('plain')
});

export const exportTranscriptResultSchema = z.object({
  path: z.string().min(1),
  format: exportFormatSchema,
  textMode: exportTextModeSchema.default('plain')
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
export type ExportTextMode = z.infer<typeof exportTextModeSchema>;
export type EngineKind = z.infer<typeof engineKindSchema>;
export type EngineBackend = z.infer<typeof engineBackendSchema>;
export type EngineRuntimeId = z.infer<typeof engineRuntimeIdSchema>;
export type TranscriptionLanguage = z.infer<typeof transcriptionLanguageSchema>;
export type TranscriptionOutputMode = z.infer<typeof transcriptionOutputModeSchema>;
export type CpuThreadPreference = z.infer<typeof cpuThreadPreferenceSchema>;
export type TranscriptionSettings = z.infer<typeof transcriptionSettingsSchema>;
export type UpdateTranscriptionSettingsInput = z.input<typeof updateTranscriptionSettingsInputSchema>;
export type DetectedLanguage = z.infer<typeof detectedLanguageSchema>;
export type ModelId = z.infer<typeof modelIdSchema>;
export type TranscriptionPresetId = z.infer<typeof transcriptionPresetIdSchema>;
export type TranscriptionPresetBackendPreference = z.infer<typeof transcriptionPresetBackendPreferenceSchema>;
export type TranscriptAlignmentStatus = z.infer<typeof transcriptAlignmentStatusSchema>;
export type TranscriptWordTiming = z.infer<typeof transcriptWordTimingSchema>;
export type SourceFile = z.infer<typeof sourceFileSchema>;
export type TranscriptionJob = z.infer<typeof transcriptionJobSchema>;
export type TranscriptSegment = z.infer<typeof transcriptSegmentSchema>;
export type TranscriptionChunkStatus = z.infer<typeof transcriptionChunkStatusSchema>;
export type TranscriptionChunk = z.infer<typeof transcriptionChunkSchema>;
export type TranscriptionChunkProcessingStats = z.infer<typeof transcriptionChunkProcessingStatsSchema>;
export type TranscriptionJobProcessingStats = z.infer<typeof transcriptionJobProcessingStatsSchema>;
export type ModelProfile = z.infer<typeof modelProfileSchema>;
export type TranscriptionPresetProfile = z.infer<typeof transcriptionPresetProfileSchema>;
export type EngineAvailability = z.infer<typeof engineAvailabilitySchema>;
export type RuntimePackagePart = z.infer<typeof runtimePackagePartSchema>;
export type WhisperRuntimePackage = z.infer<typeof whisperRuntimePackageSchema>;
export type WhisperRuntimeManifest = z.infer<typeof whisperRuntimeManifestSchema>;
export type WhisperModelPackage = z.infer<typeof whisperModelPackageSchema>;
export type WhisperModelManifest = z.infer<typeof whisperModelManifestSchema>;
export type ModelInstallStatus = z.infer<typeof modelInstallStatusSchema>;
export type InstallModelInput = z.infer<typeof installModelInputSchema>;
export type ModelInstallResult = z.infer<typeof modelInstallResultSchema>;
export type RuntimeInstallStatus = z.infer<typeof runtimeInstallStatusSchema>;
export type InstallRuntimeInput = z.infer<typeof installRuntimeInputSchema>;
export type RuntimeInstallResult = z.infer<typeof runtimeInstallResultSchema>;
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
export type ReplaceTranscriptSegmentsInput = z.input<typeof replaceTranscriptSegmentsInputSchema>;
export type ReplaceTranscriptSegmentsResult = z.infer<typeof replaceTranscriptSegmentsResultSchema>;
export type ResetTranscriptSegmentsInput = z.input<typeof resetTranscriptSegmentsInputSchema>;
export type ResetTranscriptSegmentsResult = z.infer<typeof resetTranscriptSegmentsResultSchema>;
export type ExportTranscriptInput = z.infer<typeof exportTranscriptInputSchema>;
export type ExportTranscriptResult = z.infer<typeof exportTranscriptResultSchema>;
