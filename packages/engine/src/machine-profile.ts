import { existsSync } from 'node:fs';
import { cpus, totalmem } from 'node:os';
import { basename, join } from 'node:path';
import type { EngineAvailability, EngineBackend, MachineProfile, ModelId, ResourceStatus } from '@voxmire/contracts';
import { detectCommand, type CommandDetectionResult } from './process-runner';
import {
  defaultModelPath,
  platformResourceDirectory,
  resolveFfmpegExecutable,
  resolveFfprobeExecutable,
  resolveWhisperExecutable
} from './resources';
import type { ResourcePaths } from './types';

export function detectWhisperEngine(paths: ResourcePaths, backend: EngineBackend): EngineAvailability {
  const executablePath = resolveWhisperExecutable(paths, backend);
  const available = existsSync(executablePath);

  return {
    id: `whisper.cpp-${backend}`,
    kind: 'whisper.cpp',
    backend,
    label: backend === 'cpu' ? 'whisper.cpp CPU' : `whisper.cpp ${backend.toUpperCase()}`,
    available,
    executablePath: available ? executablePath : null,
    reason: available ? null : `Missing ${basename(executablePath)} in ${executablePath}`
  };
}

export function detectWhisperEngines(paths: ResourcePaths): EngineAvailability[] {
  return ['cpu', 'cuda', 'vulkan'].map((backend) => detectWhisperEngine(paths, backend as EngineBackend));
}

export async function getMachineProfile(paths: ResourcePaths): Promise<MachineProfile> {
  const engines = detectWhisperEngines(paths);
  const nvidiaGpu = await detectCommand('nvidia-smi', ['--query-gpu=name', '--format=csv,noheader'], 1600);
  const vulkanRuntime = await detectCommand('vulkaninfo', ['--summary'], 1600);
  const recommendedBackend = chooseRecommendedBackend(engines, nvidiaGpu.available, vulkanRuntime.available);
  const totalMemoryBytes = totalmem();

  return {
    platform: process.platform,
    arch: process.arch,
    logicalCpuCores: Math.max(1, cpus().length),
    totalMemoryBytes,
    recommendedBackend,
    recommendedModelId: chooseRecommendedModel(totalMemoryBytes),
    backends: engines.map((engine) => {
      const runtimeAvailable =
        engine.backend === 'cpu' ||
        (engine.backend === 'cuda' && nvidiaGpu.available) ||
        (engine.backend === 'vulkan' && vulkanRuntime.available);
      const runtimeOutput = engine.backend === 'cuda' ? nvidiaGpu.output : engine.backend === 'vulkan' ? vulkanRuntime.output : null;
      return {
        backend: engine.backend,
        label: engine.label,
        executableAvailable: engine.available,
        runtimeAvailable,
        recommended: engine.backend === recommendedBackend,
        reason: backendReason(engine, runtimeAvailable, runtimeOutput)
      };
    }),
    notes: buildMachineProfileNotes(nvidiaGpu, vulkanRuntime)
  };
}

export function getResourceStatus(paths: ResourcePaths): ResourceStatus[] {
  const ffmpegPath = resolveFfmpegExecutable(paths);
  const ffprobePath = resolveFfprobeExecutable(paths);
  const engineBackends: EngineBackend[] = ['cpu', 'cuda', 'vulkan'];
  const modelIds: ModelId[] = ['large-v3-turbo', 'large-v3', 'distil-large-v3.5', 'medium'];

  return [
    resourceStatus('ffmpeg', 'ffmpeg', 'FFmpeg', true, ffmpegPath, 'https://www.gyan.dev/ffmpeg/builds/'),
    resourceStatus('ffprobe', 'ffprobe', 'ffprobe', true, ffprobePath, 'https://www.gyan.dev/ffmpeg/builds/'),
    ...engineBackends.map((backend) => {
      const path = resolveWhisperExecutable(paths, backend);
      return resourceStatus(
        `whisper-${backend}`,
        'whisper-engine',
        `whisper.cpp ${backend.toUpperCase()}`,
        backend === 'cpu',
        path,
        'https://github.com/ggml-org/whisper.cpp/releases'
      );
    }),
    ...['whisper.dll', 'ggml.dll', 'ggml-base.dll', 'ggml-cpu.dll'].map((fileName) =>
      resourceStatus(
        `whisper-runtime-${fileName}`,
        'whisper-engine',
        fileName,
        true,
        join(paths.projectRoot, 'resources', 'engines', platformResourceDirectory(), fileName),
        'https://github.com/ggml-org/whisper.cpp/releases'
      )
    ),
    ...modelIds.map((modelId) => {
      const path = defaultModelPath(paths, modelId);
      return resourceStatus(
        `model-${modelId}`,
        'model',
        `GGML ${modelId}`,
        modelId === 'large-v3-turbo',
        path,
        'https://huggingface.co/ggerganov/whisper.cpp/tree/main'
      );
    })
  ];
}

function chooseRecommendedBackend(
  engines: EngineAvailability[],
  hasNvidiaGpu: boolean,
  hasVulkanRuntime: boolean
): EngineBackend {
  const available = new Map(engines.map((engine) => [engine.backend, engine.available]));
  if (available.get('cuda') && hasNvidiaGpu) {
    return 'cuda';
  }

  if (available.get('vulkan') && hasVulkanRuntime) {
    return 'vulkan';
  }

  return 'cpu';
}

function chooseRecommendedModel(totalMemoryBytes: number): ModelId {
  const gib = totalMemoryBytes / 1024 / 1024 / 1024;
  if (gib >= 24) {
    return 'large-v3';
  }

  if (gib >= 12) {
    return 'large-v3-turbo';
  }

  if (gib >= 8) {
    return 'distil-large-v3.5';
  }

  return 'medium';
}

function backendReason(engine: EngineAvailability, runtimeAvailable: boolean, runtimeOutput: string | null): string | null {
  if (!engine.available) {
    return engine.reason;
  }

  if (!runtimeAvailable) {
    return engine.backend === 'cuda'
      ? 'CUDA binary is present, but nvidia-smi did not report an NVIDIA GPU.'
      : 'Vulkan binary is present, but vulkaninfo was not available.';
  }

  if (engine.backend === 'cpu') {
    return 'CPU fallback is available.';
  }

  return runtimeOutput?.split(/\r?\n/).find(Boolean)?.trim() ?? null;
}

function buildMachineProfileNotes(
  nvidiaGpu: CommandDetectionResult,
  vulkanRuntime: CommandDetectionResult
): string[] {
  const notes = ['CPU fallback remains available for every supported machine.'];
  if (nvidiaGpu.available && nvidiaGpu.output) {
    notes.push(`NVIDIA GPU detected: ${nvidiaGpu.output.split(/\r?\n/)[0]?.trim() ?? 'available'}.`);
  }

  if (!nvidiaGpu.available) {
    notes.push('CUDA requires a whisper CUDA binary and a detectable NVIDIA runtime.');
  }

  if (!vulkanRuntime.available) {
    notes.push('Vulkan requires a whisper Vulkan binary and a local vulkaninfo runtime check.');
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
