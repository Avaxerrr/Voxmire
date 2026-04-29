import { extname, join } from 'node:path';
import type { EngineBackend, EngineRuntimeId, ModelId } from '@voxmire/contracts';
import type { ResourcePaths } from './types';

export type WhisperRuntimeDefinition = {
  id: EngineRuntimeId;
  backend: EngineBackend;
  label: string;
  requiredFiles: readonly string[];
  extraArgs: readonly string[];
  legacyExecutableName: string | null;
};

const windowsRuntimeDefinitions: readonly WhisperRuntimeDefinition[] = [
  {
    id: 'cuda-12.4',
    backend: 'cuda',
    label: 'whisper.cpp CUDA 12.4',
    requiredFiles: [
      'whisper-cli.exe',
      'whisper.dll',
      'ggml.dll',
      'ggml-base.dll',
      'ggml-cpu.dll',
      'ggml-cuda.dll',
      'cublas64_12.dll',
      'cublasLt64_12.dll',
      'cudart64_12.dll'
    ],
    extraArgs: [],
    legacyExecutableName: 'whisper-cuda.exe'
  },
  {
    id: 'vulkan',
    backend: 'vulkan',
    label: 'whisper.cpp Vulkan',
    requiredFiles: ['whisper-cli.exe', 'whisper.dll', 'ggml.dll', 'ggml-base.dll', 'ggml-cpu.dll', 'ggml-vulkan.dll'],
    extraArgs: [],
    legacyExecutableName: 'whisper-vulkan.exe'
  },
  {
    id: 'cpu-blas',
    backend: 'cpu',
    label: 'whisper.cpp BLAS CPU',
    requiredFiles: ['whisper-cli.exe', 'whisper.dll', 'ggml.dll', 'ggml-base.dll', 'ggml-cpu.dll', 'ggml-blas.dll', 'libopenblas.dll'],
    extraArgs: ['--no-gpu'],
    legacyExecutableName: 'whisper-cpu-blas.exe'
  },
  {
    id: 'cpu',
    backend: 'cpu',
    label: 'whisper.cpp CPU',
    requiredFiles: ['whisper-cli.exe', 'whisper.dll', 'ggml.dll', 'ggml-base.dll', 'ggml-cpu.dll'],
    extraArgs: ['--no-gpu'],
    legacyExecutableName: 'whisper-cpu.exe'
  }
];

export function whisperRuntimeDefinitions(): readonly WhisperRuntimeDefinition[] {
  return windowsRuntimeDefinitions;
}

export function whisperRuntimeDefinition(runtimeId: EngineRuntimeId): WhisperRuntimeDefinition {
  const definition = whisperRuntimeDefinitions().find((runtime) => runtime.id === runtimeId);
  if (!definition) {
    throw new Error(`Unknown Whisper runtime: ${runtimeId}`);
  }

  return definition;
}

export function whisperRuntimeIdsForBackend(backend: EngineBackend): readonly EngineRuntimeId[] {
  if (backend === 'cuda') {
    return ['cuda-12.4', 'vulkan', 'cpu-blas', 'cpu'];
  }

  if (backend === 'vulkan') {
    return ['vulkan', 'cpu-blas', 'cpu'];
  }

  return ['cpu-blas', 'cpu'];
}

export function resolveWhisperRuntimeDirectory(paths: ResourcePaths, runtimeId: EngineRuntimeId): string {
  return join(paths.projectRoot, 'resources', 'engines', platformResourceDirectory(), runtimeId);
}

export function resolveWhisperRuntimeExecutable(paths: ResourcePaths, runtimeId: EngineRuntimeId): string {
  return join(resolveWhisperRuntimeDirectory(paths, runtimeId), executableName('whisper-cli'));
}

export function resolveWhisperRuntimeFile(paths: ResourcePaths, runtimeId: EngineRuntimeId, fileName: string): string {
  return join(resolveWhisperRuntimeDirectory(paths, runtimeId), fileName);
}

export function resolveLegacyWhisperExecutable(paths: ResourcePaths, runtimeId: EngineRuntimeId): string | null {
  const legacyExecutableName = whisperRuntimeDefinition(runtimeId).legacyExecutableName;
  return legacyExecutableName ? join(paths.projectRoot, 'resources', 'engines', platformResourceDirectory(), legacyExecutableName) : null;
}

export function resolveWhisperExecutable(paths: ResourcePaths, backend: EngineBackend): string {
  return resolveWhisperRuntimeExecutable(paths, whisperRuntimeIdsForBackend(backend)[0] ?? 'cpu');
}

export function resolveFfprobeExecutable(paths: ResourcePaths): string {
  return join(paths.projectRoot, 'resources', 'ffmpeg', executableName('ffprobe'));
}

export function resolveFfmpegExecutable(paths: ResourcePaths): string {
  return join(paths.projectRoot, 'resources', 'ffmpeg', executableName('ffmpeg'));
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

function executableName(name: string): string {
  return process.platform === 'win32' ? `${name}.exe` : name;
}