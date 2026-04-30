import { existsSync, mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cleanupStaleWhisperRuntimeDownloads, detectWhisperEngines, detectWhisperRuntime, getMachineProfile, parseWhisperJsonSegmentsPayload, parseWhisperProgressLine, whisperRuntimeDefinition } from './index';

describe('parseWhisperProgressLine', () => {
  it('parses whisper.cpp progress output', () => {
    expect(parseWhisperProgressLine('whisper_full_with_state: progress =  14%')).toBe(0.14);
    expect(parseWhisperProgressLine('progress = 99.5%')).toBe(0.995);
  });

  it('ignores unrelated output', () => {
    expect(parseWhisperProgressLine('whisper_init_from_file_with_params: loading model')).toBeNull();
  });
});

describe('parseWhisperJsonSegmentsPayload', () => {
  it('preserves word timing metadata from whisper.cpp JSON', () => {
    const segments = parseWhisperJsonSegmentsPayload({
      transcription: [
        {
          text: ' Hello world',
          offsets: { from: 1000, to: 2600 },
          words: [
            { word: 'Hello', offsets: { from: 1000, to: 1500 } },
            { word: 'world', offsets: { from: 1600, to: 2300 } }
          ]
        }
      ]
    }, 'job_1');

    expect(segments[0]).toMatchObject({
      jobId: 'job_1',
      index: 0,
      startSeconds: 1,
      endSeconds: 2.6,
      text: 'Hello world',
      alignmentStatus: 'aligned',
      wordTimings: [
        { text: 'Hello', startSeconds: 1, endSeconds: 1.5 },
        { text: 'world', startSeconds: 1.6, endSeconds: 2.3 }
      ]
    });
  });

  it('falls back to token timings when word timings are absent', () => {
    const segments = parseWhisperJsonSegmentsPayload({
      transcription: [
        {
          text: 'Hello world',
          offsets: { from: 0, to: 1200 },
          tokens: [
            { text: ' Hello', offsets: { from: 0, to: 500 } },
            { text: ' world', offsets: { from: 600, to: 1100 } }
          ]
        }
      ]
    }, 'job_1');

    expect(segments[0]?.wordTimings).toEqual([
      { text: 'Hello', startSeconds: 0, endSeconds: 0.5 },
      { text: 'world', startSeconds: 0.6, endSeconds: 1.1 }
    ]);
  });

  it('removes whisper.cpp timestamp token artifacts from token fallback words', () => {
    const segments = parseWhisperJsonSegmentsPayload({
      transcription: [
        {
          text: 'Take care',
          offsets: { from: 98000, to: 99960 },
          tokens: [
            { text: ' Take', offsets: { from: 99000, to: 99320 } },
            { text: ' care', offsets: { from: 99320, to: 99960 } },
            { text: 'TT_906', offsets: { from: 99960, to: 99980 } }
          ]
        }
      ]
    }, 'job_1');

    expect(segments[0]?.wordTimings).toEqual([
      { text: 'Take', startSeconds: 99, endSeconds: 99.32 },
      { text: 'care', startSeconds: 99.32, endSeconds: 99.96 }
    ]);
  });

  it('removes timestamp token suffixes that were merged into a word', () => {
    const segments = parseWhisperJsonSegmentsPayload({
      transcription: [
        {
          text: 'Take care',
          offsets: { from: 98000, to: 99960 },
          words: [
            { word: 'Take', offsets: { from: 99000, to: 99320 } },
            { word: 'careTT_906', offsets: { from: 99320, to: 99960 } }
          ]
        }
      ]
    }, 'job_1');

    expect(segments[0]?.wordTimings?.[1]).toEqual({ text: 'care', startSeconds: 99.32, endSeconds: 99.96 });
  });
});

describe('getMachineProfile', () => {
  it('builds a machine profile with a fallback recommendation', async () => {
    const profile = await getMachineProfile({ projectRoot: 'C:/missing-voxmire-root' });

    expect(profile.logicalCpuCores).toBeGreaterThan(0);
    expect(profile.totalMemoryBytes).toBeGreaterThan(0);
    expect(profile.recommendedBackend).toBe('cpu');
    expect(profile.backends.map((backend: { backend: string }) => backend.backend)).toEqual(['cpu', 'cuda', 'vulkan']);
  });

  it('reports concrete whisper runtime availability in fallback order', () => {
    const engines = detectWhisperEngines({ projectRoot: 'C:/missing-voxmire-root' });

    expect(engines.map((engine) => engine.runtimeId)).toEqual(['cuda-12.4', 'vulkan', 'cpu-blas', 'cpu']);
    expect(engines.map((engine) => engine.backend)).toEqual(['cuda', 'vulkan', 'cpu', 'cpu']);
  });

  it('prefers user-installed runtime folders over bundled runtime folders', () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'voxmire-engine-'));
    const userResourceRoot = join(projectRoot, 'user-resources');
    const platform = process.platform === 'win32' ? 'win32' : process.platform === 'darwin' ? 'darwin' : 'linux';
    const bundledDirectory = join(projectRoot, 'resources', 'engines', platform, 'cpu', 'whispercpp-v1.8.4');
    const userDirectory = join(userResourceRoot, 'engines', platform, 'cpu', 'whispercpp-v1.9.0');

    for (const runtimeDirectory of [bundledDirectory, userDirectory]) {
      mkdirSync(runtimeDirectory, { recursive: true });
      for (const fileName of whisperRuntimeDefinition('cpu').requiredFiles) {
        writeFileSync(join(runtimeDirectory, fileName), '');
      }
      if (process.platform !== 'win32') {
        writeFileSync(join(runtimeDirectory, 'whisper-cli'), '');
      }
    }

    const runtime = detectWhisperRuntime({ projectRoot, userResourceRoot }, 'cpu');

    expect(runtime.available).toBe(true);
    expect(runtime.runtimeVersion).toBe('v1.9.0');
    expect(runtime.executablePath).toContain(userResourceRoot);
  });


  it('removes stale runtime download folders but keeps fresh folders', () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'voxmire-engine-'));
    const userResourceRoot = join(projectRoot, 'user-resources');
    const downloadRoot = join(userResourceRoot, 'runtime-downloads');
    const staleDirectory = join(downloadRoot, 'cuda-12.4-v1.8.4-stale');
    const freshDirectory = join(downloadRoot, 'cuda-12.4-v1.8.4-fresh');
    const now = Date.now();

    mkdirSync(staleDirectory, { recursive: true });
    mkdirSync(freshDirectory, { recursive: true });
    utimesSync(staleDirectory, new Date(now - 2 * 60 * 60 * 1000), new Date(now - 2 * 60 * 60 * 1000));
    utimesSync(freshDirectory, new Date(now - 5 * 60 * 1000), new Date(now - 5 * 60 * 1000));

    const removed = cleanupStaleWhisperRuntimeDownloads({ projectRoot, userResourceRoot }, { maxAgeMs: 60 * 60 * 1000, now });

    expect(removed).toBe(1);
    expect(existsSync(staleDirectory)).toBe(false);
    expect(existsSync(freshDirectory)).toBe(true);
  });

  it('detects runtime files inside a versioned whisper.cpp folder', () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'voxmire-engine-'));
    const platform = process.platform === 'win32' ? 'win32' : process.platform === 'darwin' ? 'darwin' : 'linux';
    const runtimeDirectory = join(projectRoot, 'resources', 'engines', platform, 'cuda-12.4', 'whispercpp-v1.8.4');
    mkdirSync(runtimeDirectory, { recursive: true });

    for (const fileName of whisperRuntimeDefinition('cuda-12.4').requiredFiles) {
      writeFileSync(join(runtimeDirectory, fileName), '');
    }

    if (process.platform !== 'win32') {
      writeFileSync(join(runtimeDirectory, 'whisper-cli'), '');
    }

    const runtime = detectWhisperRuntime({ projectRoot }, 'cuda-12.4');

    expect(runtime.available).toBe(true);
    expect(runtime.runtimeVersion).toBe('v1.8.4');
    expect(runtime.executablePath).toContain(join('cuda-12.4', 'whispercpp-v1.8.4'));
  });
});
