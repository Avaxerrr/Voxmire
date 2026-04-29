import type { FileFilter } from 'electron';
import { extname } from 'node:path';
import type { ExportFormat, ExportTextMode } from '@voxmire/contracts';
import { exportFileExtension } from '@voxmire/exporters';

export function defaultExportFileName(
  sourceFileName: string,
  jobId: string,
  format: ExportFormat,
  textMode: ExportTextMode
): string {
  const suffix = format === 'txt' && textMode === 'timestamps' ? '-timestamps' : '';
  return `${sanitizeExportFileName(sourceFileName)}-${jobId}${suffix}.${exportFileExtension(format)}`;
}

export function exportSaveDialogFilters(format: ExportFormat): FileFilter[] {
  switch (format) {
    case 'txt':
      return [{ name: 'Text files', extensions: ['txt'] }];
    case 'srt':
      return [{ name: 'SubRip subtitles', extensions: ['srt'] }];
    case 'vtt':
      return [{ name: 'WebVTT subtitles', extensions: ['vtt'] }];
    case 'json':
      return [{ name: 'JSON files', extensions: ['json'] }];
  }
}

function sanitizeExportFileName(value: string): string {
  const withoutExtension = value.replace(extname(value), '');
  return withoutExtension.replace(/[^a-z0-9-_]+/gi, '-').replace(/^-+|-+$/g, '') || 'transcript';
}
