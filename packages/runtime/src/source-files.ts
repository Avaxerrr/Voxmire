import { statSync } from 'node:fs';
import { basename } from 'node:path';
import type { SourceFile } from '@voxmire/contracts';
import { probeMediaFile, sourceExtension, type ResourcePaths } from '@voxmire/engine';
import { createId } from '@voxmire/storage';

export async function createSourceFile(resources: ResourcePaths, filePath: string): Promise<SourceFile> {
  const stats = statSync(filePath);
  let durationSeconds: number | null = null;

  try {
    const probe = await probeMediaFile(resources, filePath);
    durationSeconds = probe.durationSeconds;
  } catch {
    durationSeconds = null;
  }

  return {
    id: createId('src'),
    path: filePath,
    name: basename(filePath),
    extension: sourceExtension(filePath),
    sizeBytes: stats.size,
    durationSeconds,
    createdAt: new Date().toISOString()
  };
}