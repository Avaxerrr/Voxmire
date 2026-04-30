import { createHash } from 'node:crypto';
import { closeSync, createWriteStream, existsSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, renameSync, rmSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ModelId, ModelInstallResult, ModelInstallStatus, WhisperModelManifest, WhisperModelPackage } from '@voxmire/contracts';
import { installModelInputSchema, whisperModelManifestSchema } from '@voxmire/contracts';
import { resolveBundledModelPath, resolveModelPathCandidates, resolveWritableModelPath } from './resources';
import type { ResourcePaths } from './types';

const manifestRelativePath = ['resources', 'whisper-models.manifest.json'];
const downloadChunkBytes = 8 * 1024 * 1024;
const defaultModelDownloadStaleMs = 60 * 60 * 1000;

export function readWhisperModelManifest(paths: ResourcePaths): WhisperModelManifest | null {
  const manifestPath = join(paths.projectRoot, ...manifestRelativePath);
  if (!existsSync(manifestPath)) {
    return null;
  }

  return whisperModelManifestSchema.parse(JSON.parse(readFileSync(manifestPath, 'utf8')));
}

export function getWhisperModelInstallStatuses(paths: ResourcePaths): ModelInstallStatus[] {
  const manifest = readWhisperModelManifest(paths);
  if (!manifest) {
    return [];
  }

  return manifest.models.map((modelPackage) => {
    const detected = detectInstalledModel(paths, modelPackage);
    const downloadable = Boolean(modelPackage.url ?? downloadUrlForModel(manifest, modelPackage));
    const installed = detected.source !== 'none';

    return {
      modelId: modelPackage.modelId,
      label: modelPackage.label,
      fileName: modelPackage.fileName,
      installed,
      bundled: detected.source === 'bundled',
      downloadable,
      recommended: modelPackage.recommended,
      purpose: modelPackage.purpose,
      description: modelPackage.description,
      sizeBytes: modelPackage.sizeBytes,
      path: detected.path,
      source: detected.source,
      reason: modelInstallReason(modelPackage, installed, downloadable, detected.source)
    };
  });
}

export async function installWhisperModel(paths: ResourcePaths, rawModelId: unknown): Promise<ModelInstallResult> {
  const { modelId } = installModelInputSchema.parse({ modelId: rawModelId });
  const manifest = readWhisperModelManifest(paths);
  if (!manifest) {
    throw new Error('Whisper model manifest is missing.');
  }

  const modelPackage = findModelPackage(manifest, modelId);
  if (!modelPackage) {
    throw new Error(`Model package ${modelId} is missing from the manifest.`);
  }

  const existing = detectInstalledModel(paths, modelPackage);
  if (existing.path) {
    return {
      modelId,
      fileName: modelPackage.fileName,
      installedPath: existing.path,
      installed: true
    };
  }

  const url = downloadUrlForModel(manifest, modelPackage);
  if (!url) {
    throw new Error(`Model package ${modelId} does not have a public download URL configured.`);
  }

  const targetPath = resolveWritableModelPath(paths, modelId);
  const tempRoot = join(resolveModelDownloadRoot(paths), `${modelId}-${Date.now()}`);
  const downloadPath = join(tempRoot, modelPackage.fileName);

  mkdirSync(tempRoot, { recursive: true });

  try {
    await downloadObject(url, modelPackage.fileName, downloadPath);
    verifyFileHash(downloadPath, modelPackage.sha256, modelPackage.label);

    mkdirSync(dirname(targetPath), { recursive: true });
    ensurePathInside(dirname(targetPath), targetPath);
    if (existsSync(targetPath)) {
      rmSync(targetPath, { force: true });
    }
    renameSync(downloadPath, targetPath);

    return {
      modelId,
      fileName: modelPackage.fileName,
      installedPath: targetPath,
      installed: true
    };
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

export function cleanupStaleWhisperModelDownloads(
  paths: ResourcePaths,
  options: { maxAgeMs?: number; now?: number } = {}
): number {
  const downloadRoot = resolveModelDownloadRoot(paths);
  if (!existsSync(downloadRoot)) {
    return 0;
  }

  const maxAgeMs = options.maxAgeMs ?? defaultModelDownloadStaleMs;
  const now = options.now ?? Date.now();
  let removed = 0;

  for (const entry of readdirSync(downloadRoot, { withFileTypes: true })) {
    const candidatePath = join(downloadRoot, entry.name);
    ensurePathInside(downloadRoot, candidatePath);

    try {
      const ageMs = now - statSync(candidatePath).mtimeMs;
      if (ageMs < maxAgeMs) {
        continue;
      }

      rmSync(candidatePath, { recursive: entry.isDirectory(), force: true });
      removed += 1;
    } catch {
      // Locked temp folders should not block app startup; a later cleanup pass can remove them.
    }
  }

  return removed;
}

function findModelPackage(manifest: WhisperModelManifest, modelId: ModelId): WhisperModelPackage | null {
  return manifest.models.find((modelPackage) => modelPackage.modelId === modelId) ?? null;
}

function detectInstalledModel(paths: ResourcePaths, modelPackage: WhisperModelPackage): { path: string | null; source: 'user' | 'bundled' | 'none' } {
  const candidates = resolveModelPathCandidates(paths, modelPackage.modelId);
  const existing = candidates.find((candidate) => existsSync(candidate));
  if (!existing) {
    return { path: null, source: 'none' };
  }

  return {
    path: existing,
    source: existing === resolveBundledModelPath(paths, modelPackage.modelId) ? 'bundled' : 'user'
  };
}

function modelInstallReason(modelPackage: WhisperModelPackage, installed: boolean, downloadable: boolean, source: 'user' | 'bundled' | 'none'): string | null {
  if (installed) {
    return source === 'bundled' ? 'Bundled with the app.' : 'Installed in user app data.';
  }

  if (!downloadable) {
    return 'Public model download URL is not configured yet.';
  }

  return modelPackage.recommended ? 'Recommended model available to download.' : 'Available to download.';
}

async function downloadObject(url: string, label: string, destination: string): Promise<void> {
  mkdirSync(dirname(destination), { recursive: true });
  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`Download failed for ${label}: ${response.status} ${response.statusText}`);
  }

  await pipeline(Readable.fromWeb(response.body as unknown as Parameters<typeof Readable.fromWeb>[0]), createWriteStream(destination));
}

function downloadUrlForModel(manifest: WhisperModelManifest, modelPackage: WhisperModelPackage): string | null {
  if (modelPackage.url) {
    return modelPackage.url;
  }

  const baseUrl = manifest.provider.publicBaseUrl.replace(/\/+$/, '');
  return `${baseUrl}/${modelPackage.fileName}`;
}

function verifyFileHash(filePath: string, expectedSha256: string, label: string): void {
  const actualSha256 = hashFile(filePath);
  if (actualSha256.toLowerCase() !== expectedSha256.toLowerCase()) {
    throw new Error(`${label} checksum mismatch. Expected ${expectedSha256}, got ${actualSha256}.`);
  }
}

function hashFile(filePath: string): string {
  const hash = createHash('sha256');
  const fd = openSync(filePath, 'r');
  const buffer = Buffer.alloc(downloadChunkBytes);
  try {
    while (true) {
      const bytesRead = readSync(fd, buffer, 0, buffer.length, null);
      if (bytesRead === 0) {
        break;
      }
      hash.update(buffer.subarray(0, bytesRead));
    }
  } finally {
    closeSync(fd);
  }
  return hash.digest('hex');
}

function ensurePathInside(root: string, target: string): void {
  const relativePath = relative(resolve(root), resolve(target));
  if (!relativePath || relativePath.startsWith('..') || isAbsolute(relativePath)) {
    throw new Error(`Refusing to write outside model root: ${target}`);
  }
}

function resolveModelDownloadRoot(paths: ResourcePaths): string {
  return join(paths.userResourceRoot ?? join(paths.projectRoot, '.voxmire-model-installs'), 'model-downloads');
}