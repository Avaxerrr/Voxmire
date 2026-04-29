import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { resolveFfmpegExecutable, resolveFfprobeExecutable } from './resources';
import { runProcess } from './process-runner';
import type { PreparedAudioChunk, PrepareAudioOptions, ProbeResult, ResourcePaths } from './types';

export async function probeMediaFile(paths: ResourcePaths, filePath: string): Promise<ProbeResult> {
  const ffprobePath = resolveFfprobeExecutable(paths);
  if (!existsSync(ffprobePath)) {
    throw new Error(`Missing ffprobe executable at ${ffprobePath}`);
  }

  const output = await runProcess(ffprobePath, [
    '-v',
    'error',
    '-show_entries',
    'format=duration,format_name',
    '-of',
    'json',
    filePath
  ]);

  const parsed = JSON.parse(output.stdout) as { format?: { duration?: string; format_name?: string } };
  const duration = parsed.format?.duration ? Number(parsed.format.duration) : Number.NaN;

  return {
    durationSeconds: Number.isFinite(duration) ? duration : null,
    formatName: parsed.format?.format_name ?? null
  };
}

export async function prepareAudioChunks(
  paths: ResourcePaths,
  options: PrepareAudioOptions
): Promise<PreparedAudioChunk[]> {
  const ffmpegPath = resolveFfmpegExecutable(paths);
  if (!existsSync(ffmpegPath)) {
    throw new Error(`Missing ffmpeg executable at ${ffmpegPath}`);
  }

  const jobDirectory = join(options.outputDirectory, options.jobId);
  mkdirSync(jobDirectory, { recursive: true });

  const ranges = planAudioChunks(options);
  const preparedChunks: PreparedAudioChunk[] = [];

  for (const range of ranges) {
    const filePath = join(jobDirectory, `chunk-${range.index.toString().padStart(4, '0')}.wav`);
    const args = [
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-ss',
      range.startSeconds.toString()
    ];

    if (range.durationSeconds !== null) {
      args.push('-t', range.durationSeconds.toString());
    }

    args.push(
      '-i',
      options.sourcePath,
      '-vn',
      '-ac',
      '1',
      '-ar',
      '16000',
      '-c:a',
      'pcm_s16le',
      filePath
    );

    await runProcess(ffmpegPath, args, undefined, options.signal);
    preparedChunks.push({
      index: range.index,
      startSeconds: range.startSeconds,
      endSeconds: range.endSeconds,
      filePath
    });
  }

  return preparedChunks;
}

type PlannedChunkRange = {
  index: number;
  startSeconds: number;
  endSeconds: number;
  durationSeconds: number | null;
};

function planAudioChunks(options: PrepareAudioOptions): PlannedChunkRange[] {
  const duration = options.durationSeconds;
  if (duration === null || duration <= 0) {
    return [{ index: 0, startSeconds: 0, endSeconds: 0, durationSeconds: null }];
  }

  if (duration <= options.maxSecondsBeforeChunking) {
    return [{ index: 0, startSeconds: 0, endSeconds: duration, durationSeconds: duration }];
  }

  const ranges: PlannedChunkRange[] = [];
  const stride = Math.max(1, options.targetChunkSeconds - options.overlapSeconds);
  let start = 0;

  while (start < duration) {
    const end = Math.min(duration, start + options.targetChunkSeconds);
    ranges.push({
      index: ranges.length,
      startSeconds: start,
      endSeconds: end,
      durationSeconds: end - start
    });

    if (end >= duration) {
      break;
    }

    start += stride;
  }

  return ranges;
}
