import type { ExportFormat, ExportTextMode } from '@voxmire/contracts';

export function formatBytes(value: number): string {
  const gib = value / 1024 / 1024 / 1024;
  return `${gib.toFixed(gib >= 10 ? 0 : 1)} GiB`;
}

export function exportResultLabel(format: ExportFormat, textMode: ExportTextMode): string {
  if (format === 'txt') {
    return textMode === 'timestamps' ? 'timestamped TXT' : 'plain TXT';
  }

  return format.toUpperCase();
}

export function extractDirectoryPath(filePath: string): string {
  const normalized = filePath.replaceAll('\\', '/');
  const separatorIndex = normalized.lastIndexOf('/');
  return separatorIndex >= 0 ? filePath.slice(0, separatorIndex) : filePath;
}

export function formatTime(seconds: number): string {
  const safeSeconds = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const remainder = Math.floor(safeSeconds % 60);

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${remainder.toString().padStart(2, '0')}`;
  }

  return `${minutes}:${remainder.toString().padStart(2, '0')}`;
}

export function formatPreciseTime(seconds: number): string {
  const safeSeconds = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const totalMilliseconds = Math.round(safeSeconds * 1000);
  const hours = Math.floor(totalMilliseconds / 3_600_000);
  const minutes = Math.floor((totalMilliseconds % 3_600_000) / 60_000);
  const wholeSeconds = Math.floor((totalMilliseconds % 60_000) / 1000);
  const milliseconds = totalMilliseconds % 1000;
  const suffix = `.${milliseconds.toString().padStart(3, '0')}`;

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${wholeSeconds.toString().padStart(2, '0')}${suffix}`;
  }

  return `${minutes}:${wholeSeconds.toString().padStart(2, '0')}${suffix}`;
}

export function formatEditableTime(seconds: number): string {
  const safeSeconds = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const totalMilliseconds = Math.round(safeSeconds * 1000);
  const hours = Math.floor(totalMilliseconds / 3_600_000);
  const minutes = Math.floor((totalMilliseconds % 3_600_000) / 60_000);
  const wholeSeconds = Math.floor((totalMilliseconds % 60_000) / 1000);
  const milliseconds = totalMilliseconds % 1000;
  const suffix = milliseconds > 0 ? `.${milliseconds.toString().padStart(3, '0').replace(/0+$/, '')}` : '';

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${wholeSeconds.toString().padStart(2, '0')}${suffix}`;
  }

  return `${minutes}:${wholeSeconds.toString().padStart(2, '0')}${suffix}`;
}

export function parseEditableTime(value: string): number | null {
  const parts = value.trim().split(':');
  if (parts.length < 1 || parts.length > 3 || parts.some((part) => part.trim() === '')) {
    return null;
  }

  const numericParts = parts.map((part) => Number(part));
  if (numericParts.some((part) => !Number.isFinite(part) || part < 0)) {
    return null;
  }

  if (numericParts.length === 1) {
    return numericParts[0] ?? null;
  }

  if (numericParts.length === 2) {
    return (numericParts[0] ?? 0) * 60 + (numericParts[1] ?? 0);
  }

  return (numericParts[0] ?? 0) * 3600 + (numericParts[1] ?? 0) * 60 + (numericParts[2] ?? 0);
}

export function formatDuration(seconds: number | null): string {
  return seconds === null ? 'Duration unknown' : formatTime(seconds);
}

export function formatPreciseDuration(seconds: number | null): string {
  return seconds === null ? 'Duration unknown' : formatPreciseTime(seconds);
}

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 B';
  }

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** exponent;
  return `${value.toFixed(value >= 10 || exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}

export function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'Unknown date';
  }

  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date);
}

export function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'Unknown date';
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(date);
}
