import { createHash } from 'node:crypto';
import { closeSync, createWriteStream, existsSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, rmSync, statSync, writeSync } from 'node:fs';
import { copyFile, rename } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { spawnSync } from 'node:child_process';
import type {
  EngineRuntimeId,
  RuntimeInstallResult,
  RuntimeInstallStatus,
  RuntimePackagePart,
  WhisperRuntimeManifest,
  WhisperRuntimePackage
} from '@voxmire/contracts';
import { installRuntimeInputSchema, whisperRuntimeManifestSchema } from '@voxmire/contracts';
import {
  platformResourceDirectory,
  resolveWritableWhisperRuntimeRootDirectory,
  whisperRuntimeDefinitions
} from './resources';
import { detectWhisperRuntime } from './machine-profile';
import type { ResourcePaths } from './types';

const manifestRelativePath = ['resources', 'whisper-runtimes.manifest.json'];
const downloadChunkBytes = 8 * 1024 * 1024;
const defaultRuntimeDownloadStaleMs = 60 * 60 * 1000;

type InstallPackage = {
  manifest: WhisperRuntimeManifest;
  runtimePackage: WhisperRuntimePackage;
};

export function readWhisperRuntimeManifest(paths: ResourcePaths): WhisperRuntimeManifest | null {
  const manifestPath = join(paths.projectRoot, ...manifestRelativePath);
  if (!existsSync(manifestPath)) {
    return null;
  }

  return whisperRuntimeManifestSchema.parse(JSON.parse(readFileSync(manifestPath, 'utf8')));
}

export function getWhisperRuntimeInstallStatuses(paths: ResourcePaths): RuntimeInstallStatus[] {
  const manifest = readWhisperRuntimeManifest(paths);
  const platform = platformResourceDirectory();

  return whisperRuntimeDefinitions().map((definition) => {
    const detected = detectWhisperRuntime(paths, definition.id);
    const version = manifest?.channels.stable?.[platform]?.[definition.id] ?? null;
    const runtimePackage = version && manifest ? findRuntimePackage(manifest, platform, definition.id, version) : null;
    const downloadable = runtimePackage && manifest ? runtimePackageHasDownloadUrls(manifest, runtimePackage) : false;
    const installed = Boolean(detected.available && detected.runtimeVersion && version && detected.runtimeVersion === version);
    const reason = installStatusReason({ detectedVersion: detected.runtimeVersion ?? null, downloadable, installed, runtimePackage, version });

    return {
      runtimeId: definition.id,
      label: definition.label,
      platform,
      version,
      installedVersion: detected.runtimeVersion ?? null,
      installed,
      downloadable,
      sizeBytes: runtimePackage?.sizeBytes ?? null,
      partCount: runtimePackage?.parts?.length ?? 0,
      reason
    };
  });
}

export async function installWhisperRuntime(paths: ResourcePaths, rawRuntimeId: unknown): Promise<RuntimeInstallResult> {
  const { runtimeId } = installRuntimeInputSchema.parse({ runtimeId: rawRuntimeId });
  const manifest = readWhisperRuntimeManifest(paths);
  if (!manifest) {
    throw new Error('Whisper runtime manifest is missing.');
  }

  const platform = platformResourceDirectory();
  const version = manifest.channels.stable?.[platform]?.[runtimeId];
  if (!version) {
    throw new Error(`No stable runtime package configured for ${platform}/${runtimeId}.`);
  }

  const runtimePackage = findRuntimePackage(manifest, platform, runtimeId, version);
  if (!runtimePackage) {
    throw new Error(`Runtime package ${platform}/${runtimeId}/${version} is missing from the manifest.`);
  }

  if (!runtimePackageHasDownloadUrls(manifest, runtimePackage)) {
    throw new Error(`Runtime package ${runtimeId} ${version} does not have a public download URL configured.`);
  }

  const detected = detectWhisperRuntime(paths, runtimeId);
  if (detected.available && detected.runtimeVersion === version && detected.executablePath) {
    return {
      runtimeId,
      version,
      installedDirectory: dirname(detected.executablePath),
      installed: true
    };
  }

  const writableRoot = resolveWritableWhisperRuntimeRootDirectory(paths, runtimeId);
  const targetDirectory = join(writableRoot, runtimePackage.runtimeDirectoryName);
  const tempRoot = join(resolveRuntimeDownloadRoot(paths), `${runtimeId}-${version}-${Date.now()}`);
  const downloadDirectory = join(tempRoot, 'downloads');
  const extractDirectory = join(tempRoot, 'extract');
  const zipPath = join(downloadDirectory, `${runtimePackage.runtimeDirectoryName}.zip`);

  mkdirSync(downloadDirectory, { recursive: true });
  mkdirSync(extractDirectory, { recursive: true });

  try {
    if (!runtimePackage.url && runtimePackage.parts && runtimePackage.parts.length > 0) {
      const partPaths = [];
      for (const part of [...runtimePackage.parts].sort((left, right) => left.index - right.index)) {
        const partPath = join(downloadDirectory, `${runtimePackage.runtimeDirectoryName}.zip.part${String(part.index).padStart(3, '0')}`);
        await downloadManifestObject(manifest, runtimePackage, part, partPath);
        verifyFileHash(partPath, part.sha256, `${runtimeId} ${version} part ${part.index}`);
        partPaths.push(partPath);
      }
      concatenateFiles(partPaths, zipPath);
    } else {
      await downloadManifestObject(manifest, runtimePackage, runtimePackage, zipPath);
    }

    verifyFileHash(zipPath, runtimePackage.sha256, `${runtimeId} ${version}`);
    await extractZip(zipPath, extractDirectory);
    verifyRequiredFiles(extractDirectory, runtimePackage.requiredFiles);

    mkdirSync(writableRoot, { recursive: true });
    ensurePathInside(writableRoot, targetDirectory);
    if (existsSync(targetDirectory)) {
      rmSync(targetDirectory, { recursive: true, force: true });
    }
    await rename(extractDirectory, targetDirectory);

    return {
      runtimeId,
      version,
      installedDirectory: targetDirectory,
      installed: true
    };
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

export function cleanupStaleWhisperRuntimeDownloads(
  paths: ResourcePaths,
  options: { maxAgeMs?: number; now?: number } = {}
): number {
  const downloadRoot = resolveRuntimeDownloadRoot(paths);
  if (!existsSync(downloadRoot)) {
    return 0;
  }

  const maxAgeMs = options.maxAgeMs ?? defaultRuntimeDownloadStaleMs;
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
      // A locked temp folder should not block app startup; a later cleanup pass can remove it.
    }
  }

  return removed;
}
function findRuntimePackage(
  manifest: WhisperRuntimeManifest,
  platform: string,
  runtimeId: EngineRuntimeId,
  version: string
): WhisperRuntimePackage | null {
  return manifest.packages.find((item) => item.platform === platform && item.runtimeId === runtimeId && item.whisperCppVersion === version) ?? null;
}

function runtimePackageHasDownloadUrls(manifest: WhisperRuntimeManifest, runtimePackage: WhisperRuntimePackage): boolean {
  if (runtimePackage.url) {
    return true;
  }

  if (runtimePackage.parts && runtimePackage.parts.length > 0) {
    return runtimePackage.parts.every((part) => Boolean(downloadUrlForObject(manifest, runtimePackage, part.objectKey, part.url ?? null)));
  }

  return Boolean(downloadUrlForObject(manifest, runtimePackage, runtimePackage.objectKey, runtimePackage.url ?? null));
}

function installStatusReason({
  detectedVersion,
  downloadable,
  installed,
  runtimePackage,
  version
}: {
  detectedVersion: string | null;
  downloadable: boolean;
  installed: boolean;
  runtimePackage: WhisperRuntimePackage | null;
  version: string | null;
}): string | null {
  if (!version) {
    return 'No stable package is configured for this platform.';
  }

  if (!runtimePackage) {
    return 'The stable package is missing from the manifest.';
  }

  if (installed) {
    return 'Installed and ready.';
  }

  if (detectedVersion) {
    return `Installed ${detectedVersion}; ${version} is available.`;
  }

  if (!downloadable) {
    return 'Public runtime download URL is not configured yet.';
  }

  return 'Available to download.';
}

async function downloadManifestObject(
  manifest: WhisperRuntimeManifest,
  runtimePackage: WhisperRuntimePackage,
  object: Pick<WhisperRuntimePackage | RuntimePackagePart, 'objectKey' | 'url'>,
  destination: string
): Promise<void> {
  const url = downloadUrlForObject(manifest, runtimePackage, object.objectKey, object.url ?? null);
  if (!url) {
    throw new Error(`No download URL configured for ${object.objectKey}.`);
  }

  mkdirSync(dirname(destination), { recursive: true });
  if (url.startsWith('file://')) {
    await copyFile(new URL(url), destination);
    return;
  }

  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`Download failed for ${object.objectKey}: ${response.status} ${response.statusText}`);
  }

  await pipeline(Readable.fromWeb(response.body as unknown as Parameters<typeof Readable.fromWeb>[0]), createWriteStream(destination));
}

function downloadUrlForObject(
  manifest: WhisperRuntimeManifest,
  runtimePackage: WhisperRuntimePackage,
  objectKey: string,
  explicitUrl: string | null
): string | null {
  if (explicitUrl) {
    return explicitUrl;
  }

  if (objectKey === runtimePackage.objectKey && runtimePackage.url) {
    return runtimePackage.url;
  }

  const baseUrl = manifest.provider.publicBaseUrl?.replace(/\/+$/, '');
  return baseUrl ? `${baseUrl}/${objectKey}` : null;
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

function concatenateFiles(partPaths: readonly string[], destination: string): void {
  const output = openSync(destination, 'w');
  const buffer = Buffer.alloc(downloadChunkBytes);
  try {
    for (const partPath of partPaths) {
      const input = openSync(partPath, 'r');
      try {
        while (true) {
          const bytesRead = readSync(input, buffer, 0, buffer.length, null);
          if (bytesRead === 0) {
            break;
          }
          writeSync(output, buffer, 0, bytesRead);
        }
      } finally {
        closeSync(input);
      }
    }
  } finally {
    closeSync(output);
  }
}

async function extractZip(zipPath: string, destination: string): Promise<void> {
  if (process.platform === 'win32') {
    runPowerShell(`
      Add-Type -AssemblyName System.IO.Compression.FileSystem
      [System.IO.Directory]::CreateDirectory(${powerShellString(destination)}) | Out-Null
      [System.IO.Compression.ZipFile]::ExtractToDirectory(${powerShellString(zipPath)}, ${powerShellString(destination)})
    `);
    return;
  }

  runProcess('unzip', ['-q', zipPath, '-d', destination]);
}

function verifyRequiredFiles(directory: string, requiredFiles: readonly string[]): void {
  const missing = requiredFiles.filter((fileName) => !existsSync(join(directory, fileName)));
  if (missing.length > 0) {
    throw new Error(`Extracted runtime is missing required files: ${missing.join(', ')}.`);
  }
}

function ensurePathInside(root: string, target: string): void {
  const relativePath = relative(resolve(root), resolve(target));
  if (!relativePath || relativePath.startsWith('..') || isAbsolute(relativePath)) {
    throw new Error(`Refusing to write outside runtime root: ${target}`);
  }
}

function resolveRuntimeDownloadRoot(paths: ResourcePaths): string {
  return join(paths.userResourceRoot ?? join(paths.projectRoot, '.voxmire-runtime-installs'), 'runtime-downloads');
}
function runPowerShell(script: string): void {
  const wrappedScript = `$ProgressPreference = 'SilentlyContinue'
$InformationPreference = 'SilentlyContinue'
$VerbosePreference = 'SilentlyContinue'
${script}`;
  const encoded = Buffer.from(wrappedScript, 'utf16le').toString('base64');
  runProcess('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded]);
}

function runProcess(command: string, args: readonly string[]): void {
  const result = spawnSync(command, args, { stdio: 'inherit', shell: false });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${command} exited with status ${result.status}`);
  }
}

function powerShellString(value: string): string {
  return `'${value.replace(/'/g, `''`)}'`;
}
