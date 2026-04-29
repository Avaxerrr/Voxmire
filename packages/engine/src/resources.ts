import { extname, join } from 'node:path';
import type { EngineBackend, ModelId } from '@voxmire/contracts';
import type { ResourcePaths } from './types';

export function resolveWhisperExecutable(paths: ResourcePaths, backend: EngineBackend): string {
  const executableName = process.platform === 'win32' ? `whisper-${backend}.exe` : `whisper-${backend}`;
  return join(paths.projectRoot, 'resources', 'engines', platformResourceDirectory(), executableName);
}

export function resolveFfprobeExecutable(paths: ResourcePaths): string {
  const executableName = process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe';
  return join(paths.projectRoot, 'resources', 'ffmpeg', executableName);
}

export function resolveFfmpegExecutable(paths: ResourcePaths): string {
  const executableName = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  return join(paths.projectRoot, 'resources', 'ffmpeg', executableName);
}

export function defaultModelPath(paths: ResourcePaths, modelId: ModelId): string {
  const fileName = `ggml-${modelId}.bin`;
  return join(paths.projectRoot, 'resources', 'models', fileName);
}

export function sourceExtension(filePath: string): string {
  return extname(filePath).replace(/^\./, '').toLowerCase() || 'unknown';
}

export function platformResourceDirectory(): string {
  if (process.platform === 'win32') {
    return 'win32';
  }

  if (process.platform === 'darwin') {
    return 'darwin';
  }

  return 'linux';
}
