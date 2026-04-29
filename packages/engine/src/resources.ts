import { existsSync, readdirSync } from 'node:fs';
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

export const whisperCppRuntimeVersion = 'v1.8.4';

const whisperCppRuntimeDirectoryPrefix = 'whispercpp-';

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

export function resolveWhisperRuntimeRootDirectory(paths: ResourcePaths, runtimeId: EngineRuntimeId): string {
  return join(paths.projectRoot, 'resources', 'engines', platformResourceDirectory(), runtimeId);
}

export function resolveDefaultWhisperRuntimeDirectory(paths: ResourcePaths, runtimeId: EngineRuntimeId): string {
  return join(resolveWhisperRuntimeRootDirectory(paths, runtimeId), `${whisperCppRuntimeDirectoryPrefix}${whisperCppRuntimeVersion}`);
}

export function resolveWhisperRuntimeDirectory(paths: ResourcePaths, runtimeId: EngineRuntimeId): string {
  const runtimeRoot = resolveWhisperRuntimeRootDirectory(paths, runtimeId);
  const versionedDirectory = installedWhisperRuntimeDirectories(runtimeRoot)
    .find((directory) => existsSync(join(directory, executableName('whisper-cli'))));
  if (versionedDirectory) {
    return versionedDirectory;
  }

  const flatExecutable = join(runtimeRoot, executableName('whisper-cli'));
  if (existsSync(flatExecutable)) {
    return runtimeRoot;
  }

  return resolveDefaultWhisperRuntimeDirectory(paths, runtimeId);
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

function installedWhisperRuntimeDirectories(runtimeRoot: string): string[] {
  try {
    return readdirSync(runtimeRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.startsWith(whisperCppRuntimeDirectoryPrefix))
      .map((entry) => entry.name)
      .sort(compareRuntimeDirectoryNamesDescending)
      .map((name) => join(runtimeRoot, name));
  } catch {
    return [];
  }
}

function compareRuntimeDirectoryNamesDescending(left: string, right: string): number {
  const leftParts = versionParts(left);
  const rightParts = versionParts(right);
  const length = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < length; index += 1) {
    const difference = (rightParts[index] ?? 0) - (leftParts[index] ?? 0);
    if (difference !== 0) {
      return difference;
    }
  }

  return right.localeCompare(left);
}

function versionParts(directoryName: string): number[] {
  return directoryName
    .replace(whisperCppRuntimeDirectoryPrefix, '')
    .replace(/^v/i, '')
    .split(/[^\d]+/)
    .filter(Boolean)
    .map((part) => Number(part));
}
