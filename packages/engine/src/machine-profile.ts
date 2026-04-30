import { existsSync } from 'node:fs';
import { cpus, totalmem } from 'node:os';
import { basename, dirname, join } from 'node:path';
import type {
  EngineAvailability,
  EngineBackend,
  EngineRuntimeId,
  MachineProfile,
  ModelId,
  ResourceStatus
} from '@voxmire/contracts';
import { detectCommand, type CommandDetectionResult } from './process-runner';
import {
  defaultModelPath,
  resolveFfmpegExecutable,
  resolveFfprobeExecutable,
  resolveWhisperRuntimeDirectory,
  resolveWhisperRuntimeExecutable,
  resolveWhisperRuntimeFile,
  supportedModelIds,
  whisperRuntimeDefinition,
  whisperRuntimeDefinitions,
  whisperRuntimeVersionFromDirectory
} from './resources';
import type { ResourcePaths } from './types';

export type WhisperRuntimeAvailability = EngineAvailability & {
  runtimeId: EngineRuntimeId;
  requiredFilePaths: readonly string[];
  missingFilePaths: readonly string[];
};

export function detectWhisperRuntime(paths: ResourcePaths, runtimeId: EngineRuntimeId): WhisperRuntimeAvailability {
  const definition = whisperRuntimeDefinition(runtimeId);
  const executablePath = resolveWhisperRuntimeExecutable(paths, runtimeId);
  const runtimeDirectory = dirname(executablePath);
  const requiredFilePaths = definition.requiredFiles.map((fileName) => join(runtimeDirectory, fileName));
  const missingFilePaths = requiredFilePaths.filter((filePath) => !existsSync(filePath));
  const available = missingFilePaths.length === 0;
  const runtimeVersion = existsSync(runtimeDirectory) ? whisperRuntimeVersionFromDirectory(runtimeDirectory) : null;

  return {
    id: `whisper.cpp-${runtimeId}`,
    runtimeId,
    kind: 'whisper.cpp',
    backend: definition.backend,
    label: definition.label,
    runtimeVersion,
    available,
    executablePath: available ? executablePath : null,
    reason: available ? null : missingRuntimeReason(runtimeId, executablePath, missingFilePaths),
    requiredFilePaths,
    missingFilePaths
  };
}

export function detectWhisperEngine(paths: ResourcePaths, backend: EngineBackend): EngineAvailability {
  const runtimeIds: readonly EngineRuntimeId[] = backend === 'cuda' ? ['cuda-12.4'] : backend === 'vulkan' ? ['vulkan'] : ['cpu-blas', 'cpu'];
  const runtimes = runtimeIds.map((runtimeId) => detectWhisperRuntime(paths, runtimeId));
  const available = runtimes.find((runtime) => runtime.available);
  if (available) {
    return available;
  }

  const first = runtimes[0] ?? detectWhisperRuntime(paths, 'cpu');
  return {
    ...first,
    id: `whisper.cpp-${backend}`,
    backend,
    label: backend === 'cpu' ? 'whisper.cpp CPU' : `whisper.cpp ${backend.toUpperCase()}`,
    reason: runtimes.map((runtime) => runtime.reason).filter(Boolean).join(' ') || first.reason
  };
}

export function detectWhisperEngines(paths: ResourcePaths): EngineAvailability[] {
  return whisperRuntimeDefinitions().map((runtime) => detectWhisperRuntime(paths, runtime.id));
}

export async function getMachineProfile(paths: ResourcePaths): Promise<MachineProfile> {
  const runtimes = whisperRuntimeDefinitions().map((runtime) => detectWhisperRuntime(paths, runtime.id));
  const runtimeChecks = new Map(await Promise.all(runtimes.map((runtime) => checkWhisperRuntime(runtime))));
  const nvidiaGpu = await detectCommand('nvidia-smi', ['--query-gpu=name', '--format=csv,noheader'], 1600);
  const vulkanRuntime = await detectCommand('vulkaninfo', ['--summary'], 1600);
  const recommendedBackend = chooseRecommendedBackend(runtimes, runtimeChecks, nvidiaGpu.available, vulkanRuntime.available);
  const totalMemoryBytes = totalmem();

  return {
    platform: process.platform,
    arch: process.arch,
    logicalCpuCores: Math.max(1, cpus().length),
    totalMemoryBytes,
    recommendedBackend,
    recommendedModelId: chooseRecommendedModel(totalMemoryBytes),
    backends: (['cpu', 'cuda', 'vulkan'] as const).map((backend) => {
      const backendRuntimes = runtimes.filter((runtime) => runtime.backend === backend);
      const executableAvailable = backendRuntimes.some((runtime) => runtime.available);
      const runtimeAvailable = backendRuntimes.some((runtime) => runtime.available && runtimeChecks.get(runtime.runtimeId)?.available);
      return {
        backend,
        label: backendLabel(backend, backendRuntimes),
        executableAvailable,
        runtimeAvailable,
        recommended: backend === recommendedBackend,
        reason: backendReason(backend, backendRuntimes, runtimeChecks, nvidiaGpu, vulkanRuntime)
      };
    }),
    notes: buildMachineProfileNotes(runtimes, runtimeChecks, nvidiaGpu, vulkanRuntime)
  };
}

export function getResourceStatus(paths: ResourcePaths): ResourceStatus[] {
  const ffmpegPath = resolveFfmpegExecutable(paths);
  const ffprobePath = resolveFfprobeExecutable(paths);
  const runtimeStatuses = whisperRuntimeDefinitions().flatMap((definition) => {
    const detected = detectWhisperRuntime(paths, definition.id);
    const runtimeDirectory = dirname(detected.requiredFilePaths[0] ?? resolveWhisperRuntimeDirectory(paths, definition.id));
    const runtimeRequired = definition.id === 'cpu';
    return definition.requiredFiles.map((fileName, index) => resourceStatus(
      `whisper-${definition.id}-${fileName}`,
      'whisper-engine',
      `${definition.label} ${fileName}`,
      runtimeRequired,
      detected.requiredFilePaths[index] ?? resolveWhisperRuntimeFile(paths, definition.id, fileName),
      'https://github.com/ggml-org/whisper.cpp/releases'
    )).concat(resourceStatus(
      `whisper-${definition.id}-directory`,
      'whisper-engine',
      `${definition.label} folder`,
      false,
      runtimeDirectory,
      'https://github.com/ggml-org/whisper.cpp/releases'
    ));
  });

  return [
    resourceStatus('ffmpeg', 'ffmpeg', 'FFmpeg', true, ffmpegPath, 'https://www.gyan.dev/ffmpeg/builds/'),
    resourceStatus('ffprobe', 'ffprobe', 'ffprobe', true, ffprobePath, 'https://www.gyan.dev/ffmpeg/builds/'),
    ...runtimeStatuses,
    ...supportedModelIds().map((modelId) => {
      const path = defaultModelPath(paths, modelId);
      return resourceStatus(
        `model-${modelId}`,
        'model',
        `GGML ${modelId}`,
        modelId === 'small-q8_0',
        path,
        'https://huggingface.co/ggerganov/whisper.cpp/tree/main'
      );
    })
  ];
}

function missingRuntimeReason(runtimeId: EngineRuntimeId, executablePath: string, missingFilePaths: readonly string[]): string {
  const missing = missingFilePaths.map((filePath) => basename(filePath)).join(', ');
  return `Missing ${missing} for ${runtimeId} runtime near ${executablePath}`;
}

async function checkWhisperRuntime(runtime: WhisperRuntimeAvailability): Promise<[EngineRuntimeId, CommandDetectionResult]> {
  if (!runtime.available || !runtime.executablePath) {
    return [runtime.runtimeId, { available: false, output: runtime.reason }];
  }

  return [runtime.runtimeId, await detectCommand(runtime.executablePath, ['--help'], 2500)];
}

function chooseRecommendedBackend(
  runtimes: readonly WhisperRuntimeAvailability[],
  runtimeChecks: ReadonlyMap<EngineRuntimeId, CommandDetectionResult>,
  hasNvidiaGpu: boolean,
  hasVulkanRuntime: boolean
): EngineBackend {
  if (runtimeReady('cuda-12.4', runtimes, runtimeChecks) && hasNvidiaGpu) {
    return 'cuda';
  }

  if (runtimeReady('vulkan', runtimes, runtimeChecks) && hasVulkanRuntime) {
    return 'vulkan';
  }

  return 'cpu';
}

function runtimeReady(
  runtimeId: EngineRuntimeId,
  runtimes: readonly WhisperRuntimeAvailability[],
  runtimeChecks: ReadonlyMap<EngineRuntimeId, CommandDetectionResult>
): boolean {
  return Boolean(runtimes.find((runtime) => runtime.runtimeId === runtimeId)?.available && runtimeChecks.get(runtimeId)?.available);
}

function chooseRecommendedModel(totalMemoryBytes: number): ModelId {
  const gib = totalMemoryBytes / 1024 / 1024 / 1024;
  return gib >= 12 ? 'large-v3-turbo' : 'small-q8_0';
}

function backendLabel(backend: EngineBackend, runtimes: readonly WhisperRuntimeAvailability[]): string {
  if (backend === 'cpu') {
    const hasBlas = runtimes.some((runtime) => runtime.runtimeId === 'cpu-blas' && runtime.available);
    return hasBlas ? 'whisper.cpp CPU (BLAS preferred)' : 'whisper.cpp CPU';
  }

  return backend === 'cuda' ? 'whisper.cpp CUDA' : 'whisper.cpp Vulkan';
}

function backendReason(
  backend: EngineBackend,
  runtimes: readonly WhisperRuntimeAvailability[],
  runtimeChecks: ReadonlyMap<EngineRuntimeId, CommandDetectionResult>,
  nvidiaGpu: CommandDetectionResult,
  vulkanRuntime: CommandDetectionResult
): string | null {
  const ready = runtimes.find((runtime) => runtime.available && runtimeChecks.get(runtime.runtimeId)?.available);
  if (ready) {
    if (backend === 'cpu') {
      return ready.runtimeId === 'cpu-blas' ? 'BLAS CPU runtime is ready; plain CPU remains the final fallback.' : 'Plain CPU fallback is ready.';
    }

    const output = runtimeChecks.get(ready.runtimeId)?.output;
    return output?.split(/\r?\n/).find((line) => line.trim())?.trim() ?? `${ready.label} is ready.`;
  }

  const missing = runtimes.map((runtime) => runtime.reason).filter(Boolean).join(' ');
  if (missing) {
    return missing;
  }

  if (backend === 'cuda' && !nvidiaGpu.available) {
    return 'CUDA requires a CUDA runtime and a detectable NVIDIA GPU.';
  }

  if (backend === 'vulkan' && !vulkanRuntime.available) {
    return 'Vulkan requires a Vulkan runtime and driver-visible Vulkan device.';
  }

  return null;
}

function buildMachineProfileNotes(
  runtimes: readonly WhisperRuntimeAvailability[],
  runtimeChecks: ReadonlyMap<EngineRuntimeId, CommandDetectionResult>,
  nvidiaGpu: CommandDetectionResult,
  vulkanRuntime: CommandDetectionResult
): string[] {
  const notes = ['Plain CPU remains the final fallback for every supported machine.'];
  if (runtimeReady('cpu-blas', runtimes, runtimeChecks)) {
    notes.push('BLAS CPU runtime is available and will be preferred over plain CPU when GPU acceleration is not usable.');
  }

  if (nvidiaGpu.available && nvidiaGpu.output) {
    notes.push(`NVIDIA GPU detected: ${nvidiaGpu.output.split(/\r?\n/)[0]?.trim() ?? 'available'}.`);
  }

  if (!runtimeReady('cuda-12.4', runtimes, runtimeChecks)) {
    notes.push('CUDA requires the CUDA 12.4 whisper runtime folder and a compatible NVIDIA driver.');
  }

  if (!runtimeReady('vulkan', runtimes, runtimeChecks) || !vulkanRuntime.available) {
    notes.push('Vulkan requires the Vulkan whisper runtime folder and a local Vulkan runtime.');
  }

  return notes;
}

function resourceStatus(
  id: string,
  kind: ResourceStatus['kind'],
  label: string,
  required: boolean,
  path: string,
  sourceUrl: string
): ResourceStatus {
  const available = existsSync(path);
  return {
    id,
    kind,
    label,
    required,
    available,
    path,
    sourceUrl,
    reason: available ? null : `Missing ${basename(path)} at ${path}`
  };
}