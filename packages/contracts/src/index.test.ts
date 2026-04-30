import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createJobInputSchema, engineAvailabilitySchema, machineProfileSchema, transcriptionChunkSchema, transcriptionPresetProfileSchema, transcriptionProgressEventSchema, transcriptSegmentSchema, transcriptWordTimingSchema, transcriptionJobSchema, whisperRuntimeManifestSchema } from './index';

describe('contracts', () => {
  it('validates transcription job payloads', () => {
    expect(() =>
      transcriptionJobSchema.parse({
        id: 'job_1',
        sourceFileId: 'src_1',
        status: 'queued',
        modelId: 'large-v3-turbo',
        engineBackend: 'cpu',
        progress: 0,
        errorMessage: null,
        createdAt: '2026-04-23T00:00:00.000Z',
        updatedAt: '2026-04-23T00:00:00.000Z',
        completedAt: null
      })
    ).not.toThrow();
  });

  it('defaults create job input to CPU backend', () => {
    expect(createJobInputSchema.parse({})).toEqual({ modelId: 'large-v3-turbo', engineBackend: 'cpu' });
    expect(createJobInputSchema.parse({ presetId: 'balanced' }).presetId).toBe('balanced');
    expect(createJobInputSchema.parse({ engineBackend: 'cuda' }).engineBackend).toBe('cuda');
  });

  it('rejects invalid segment timing confidence', () => {
    expect(() =>
      transcriptSegmentSchema.parse({
        id: 'seg_1',
        jobId: 'job_1',
        index: 0,
        startSeconds: 0,
        endSeconds: 10,
        text: 'Hello',
        confidence: 2,
        createdAt: '2026-04-23T00:00:00.000Z'
      })
    ).toThrow();
  });

  it('validates optional transcript word timing metadata', () => {
    expect(() =>
      transcriptSegmentSchema.parse({
        id: 'seg_1',
        jobId: 'job_1',
        index: 0,
        startSeconds: 0,
        endSeconds: 2,
        text: 'Hello world',
        wordTimings: [
          { text: 'Hello', startSeconds: 0, endSeconds: 0.8 },
          { text: 'world', startSeconds: 0.9, endSeconds: 1.6 }
        ],
        alignmentStatus: 'aligned',
        confidence: null,
        createdAt: '2026-04-23T00:00:00.000Z'
      })
    ).not.toThrow();

    expect(() =>
      transcriptWordTimingSchema.parse({ text: 'broken', startSeconds: 2, endSeconds: 1 })
    ).toThrow();
  });

  it('validates transcription preset profiles', () => {
    expect(() =>
      transcriptionPresetProfileSchema.parse({
        id: 'balanced',
        label: 'Balanced',
        purpose: 'Default',
        description: 'Balanced speed and quality for most recordings and machines.',
        recommended: true,
        modelId: 'large-v3-turbo',
        backendPreference: 'auto'
      })
    ).not.toThrow();
  });

  it('validates engine availability with runtime version metadata', () => {
    expect(() =>
      engineAvailabilitySchema.parse({
        id: 'whisper.cpp-cuda-12.4',
        runtimeId: 'cuda-12.4',
        kind: 'whisper.cpp',
        backend: 'cuda',
        label: 'whisper.cpp CUDA 12.4',
        runtimeVersion: 'v1.8.4',
        available: true,
        executablePath: 'C:/voxmire/resources/engines/win32/cuda-12.4/whispercpp-v1.8.4/whisper-cli.exe',
        reason: null
      })
    ).not.toThrow();
  });

  it('validates machine profile payloads', () => {
    expect(() =>
      machineProfileSchema.parse({
        platform: 'win32',
        arch: 'x64',
        logicalCpuCores: 12,
        totalMemoryBytes: 17179869184,
        recommendedBackend: 'cpu',
        recommendedModelId: 'large-v3-turbo',
        backends: [
          {
            backend: 'cpu',
            label: 'whisper.cpp CPU',
            executableAvailable: true,
            runtimeAvailable: true,
            recommended: true,
            reason: 'CPU fallback is available.'
          }
        ],
        notes: ['CPU fallback remains available.']
      })
    ).not.toThrow();
  });

  it('validates the packaged whisper runtime manifest', () => {
    const manifestPath = join(process.cwd(), 'resources', 'whisper-runtimes.manifest.json');
    const manifest = whisperRuntimeManifestSchema.parse(JSON.parse(readFileSync(manifestPath, 'utf8')));
    const cudaPackage = manifest.packages.find((runtimePackage) => runtimePackage.runtimeId === 'cuda-12.4');

    expect(manifest.provider.type).toBe('github-release');
    expect(manifest.channels.stable?.win32?.cpu).toBe('v1.8.4');
    expect(cudaPackage?.sha256).toMatch(/^[a-f0-9]{64}$/i);
  });

  it('validates progress events with active engine runtime metadata', () => {
    expect(() =>
      transcriptionProgressEventSchema.parse({
        jobId: 'job_1',
        status: 'transcribing',
        progress: 0.42,
        message: 'Whisper progress 42%.',
        segment: null,
        engineRuntimeId: 'cuda-12.4',
        engineLabel: 'whisper.cpp CUDA 12.4'
      })
    ).not.toThrow();
  });

  it('validates transcription chunk payloads', () => {
    expect(() =>
      transcriptionChunkSchema.parse({
        id: 'chunk_1',
        jobId: 'job_1',
        index: 0,
        startSeconds: 0,
        endSeconds: 600,
        filePath: 'C:/audio/chunk-0000.wav',
        status: 'queued',
        errorMessage: null,
        createdAt: '2026-04-23T00:00:00.000Z',
        updatedAt: '2026-04-23T00:00:00.000Z',
        completedAt: null
      })
    ).not.toThrow();
  });
});
