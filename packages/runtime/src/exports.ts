import { writeFileSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import type { ExportFormat, ExportTextMode } from '@voxmire/contracts';
import { exportFileExtension, renderTranscriptExport } from '@voxmire/exporters';
import { getJobWithSource, getTranscriptSegments, type VoxmireDatabase } from '@voxmire/storage';
import { ensureDirectory } from './directories';
import type { ExportTranscriptOptions, RuntimeDirectories } from './types';

export type TranscriptExportResult = {
  path: string;
  format: ExportFormat;
  textMode: ExportTextMode;
};

export function writeTranscriptExport(
  db: VoxmireDatabase,
  jobId: string,
  format: ExportFormat,
  directories: RuntimeDirectories,
  options: ExportTranscriptOptions = {}
): TranscriptExportResult {
  const jobWithSource = getJobWithSource(db, jobId);

  if (!jobWithSource) {
    throw new Error(`Job not found: ${jobId}`);
  }

  const textMode = options.textMode ?? 'plain';
  const segments = getTranscriptSegments(db, jobId);
  const rendered = renderTranscriptExport(format, segments, { textMode });
  const outputPath = options.outputPath ?? join(
    ensureDirectory(options.outputDirectory ?? directories.exportDirectory),
    defaultExportFileName(jobWithSource.sourceFile.name, jobId, format, textMode)
  );
  ensureDirectory(dirname(outputPath));

  writeFileSync(outputPath, rendered, 'utf8');
  return { path: outputPath, format, textMode };
}

function defaultExportFileName(sourceFileName: string, jobId: string, format: ExportFormat, textMode: ExportTextMode): string {
  return `${sanitizeFileName(sourceFileName)}-${jobId}${format === 'txt' && textMode === 'timestamps' ? '-timestamps' : ''}.${exportFileExtension(format)}`;
}

function sanitizeFileName(value: string): string {
  const withoutExtension = value.replace(extname(value), '');
  return withoutExtension.replace(/[^a-z0-9-_]+/gi, '-').replace(/^-+|-+$/g, '') || 'transcript';
}