import { spawn } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { resolveFfmpegExecutable, resolveFfprobeExecutable, type ResourcePaths } from '@voxmire/engine';
import { mediaContentType, type MediaKind } from './media-types';

export type MediaWaveformResult = {
  durationSeconds: number | null;
  peaks: number[];
};

export type MediaInfoResult = {
  contentType: string;
  hasAudio: boolean;
  hasVideo: boolean;
  kind: MediaKind;
};

export class MediaMetadataCache {
  private readonly waveformCache = new Map<string, Promise<MediaWaveformResult | null>>();
  private readonly mediaInfoCache = new Map<string, Promise<MediaInfoResult>>();

  constructor(private readonly resources: ResourcePaths) {}

  clear(jobId: string): void {
    this.waveformCache.delete(jobId);
    this.mediaInfoCache.delete(jobId);
  }

  getInfo(jobId: string, sourcePath: string): Promise<MediaInfoResult> {
    let cached = this.mediaInfoCache.get(jobId);
    if (!cached) {
      cached = createMediaInfo(this.resources, sourcePath);
      this.mediaInfoCache.set(jobId, cached);
    }

    return cached;
  }

  getWaveform(jobId: string, sourcePath: string, durationSeconds: number | null): Promise<MediaWaveformResult | null> {
    let cached = this.waveformCache.get(jobId);
    if (!cached) {
      cached = createWaveformPeaks(this.resources, sourcePath, durationSeconds).catch(() => {
        this.waveformCache.delete(jobId);
        return null;
      });
      this.waveformCache.set(jobId, cached);
    }

    return cached;
  }
}

async function createMediaInfo(resources: ResourcePaths, sourcePath: string): Promise<MediaInfoResult> {
  const fallback = fallbackMediaInfo(sourcePath);
  if (!existsSync(sourcePath) || !statSync(sourcePath).isFile()) {
    return fallback;
  }

  const ffprobePath = resolveFfprobeExecutable(resources);
  if (!existsSync(ffprobePath)) {
    return fallback;
  }

  try {
    const output = await runBufferedProcess(ffprobePath, [
      '-v',
      'error',
      '-show_entries',
      'stream=codec_type',
      '-of',
      'json',
      sourcePath
    ]);
    const parsed = JSON.parse(output.toString('utf8')) as { streams?: Array<{ codec_type?: string }> };
    const streams = Array.isArray(parsed.streams) ? parsed.streams : [];
    const hasVideo = streams.some((stream) => stream.codec_type === 'video');
    const hasAudio = streams.some((stream) => stream.codec_type === 'audio');

    return {
      contentType: mediaContentType(sourcePath),
      hasAudio,
      hasVideo,
      kind: hasVideo ? 'video' : 'audio'
    };
  } catch {
    return fallback;
  }
}

function fallbackMediaInfo(sourcePath: string): MediaInfoResult {
  const contentType = mediaContentType(sourcePath);
  const kind: MediaKind = contentType.startsWith('video/') ? 'video' : 'audio';
  return {
    contentType,
    hasAudio: true,
    hasVideo: kind === 'video',
    kind
  };
}

async function createWaveformPeaks(
  resources: ResourcePaths,
  sourcePath: string,
  durationSeconds: number | null
): Promise<MediaWaveformResult | null> {
  if (!existsSync(sourcePath) || !statSync(sourcePath).isFile()) {
    return null;
  }

  const ffmpegPath = resolveFfmpegExecutable(resources);
  if (!existsSync(ffmpegPath)) {
    return null;
  }

  const sampleRate = 500;
  const targetPeaks = 1200;
  const pcm = await runBufferedProcess(ffmpegPath, [
    '-v',
    'error',
    '-i',
    sourcePath,
    '-vn',
    '-ac',
    '1',
    '-ar',
    sampleRate.toString(),
    '-f',
    's16le',
    'pipe:1'
  ]);

  return {
    durationSeconds,
    peaks: pcmToPeaks(pcm, targetPeaks)
  };
}

function pcmToPeaks(buffer: Buffer, targetPeaks: number): number[] {
  const sampleCount = Math.floor(buffer.length / 2);
  if (sampleCount === 0) {
    return [];
  }

  const peaks: number[] = [];
  const samplesPerPeak = Math.max(1, Math.ceil(sampleCount / targetPeaks));

  for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += samplesPerPeak) {
    let peak = 0;
    const end = Math.min(sampleCount, sampleIndex + samplesPerPeak);
    for (let current = sampleIndex; current < end; current += 1) {
      peak = Math.max(peak, Math.abs(buffer.readInt16LE(current * 2)) / 32768);
    }

    peaks.push(Math.max(0.02, Math.min(1, peak)));
  }

  return peaks;
}

function runBufferedProcess(executablePath: string, args: readonly string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(executablePath, [...args], { windowsHide: true });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    child.stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk));
    child.on('error', reject);
    child.on('close', (code: number | null) => {
      if (code === 0) {
        resolve(Buffer.concat(stdoutChunks));
        return;
      }

      reject(new Error(`${executablePath} exited with code ${code}: ${Buffer.concat(stderrChunks).toString('utf8')}`));
    });
  });
}
