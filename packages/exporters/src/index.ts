import type { ExportFormat, ExportTextMode, TranscriptSegment } from '@voxmire/contracts';

export type RenderTranscriptExportOptions = {
  textMode?: ExportTextMode;
};

export function renderTranscriptExport(format: ExportFormat, segments: readonly TranscriptSegment[], options: RenderTranscriptExportOptions = {}): string {
  switch (format) {
    case 'txt':
      return renderTxt(segments, options.textMode ?? 'plain');
    case 'json':
      return `${JSON.stringify({ segments }, null, 2)}\n`;
    case 'srt':
      return renderSrt(segments);
    case 'vtt':
      return renderVtt(segments);
  }
}

export function exportFileExtension(format: ExportFormat): string {
  return format;
}

function renderTxt(segments: readonly TranscriptSegment[], textMode: ExportTextMode): string {
  if (textMode === 'timestamps') {
    return `${segments
      .map((segment) => {
        const text = segment.text.trim();
        return text ? `[${formatEditableTimestamp(segment.startSeconds)} - ${formatEditableTimestamp(segment.endSeconds)}] ${text}` : '';
      })
      .filter(Boolean)
      .join('\n\n')}\n`;
  }

  return `${segments.map((segment) => segment.text.trim()).filter(Boolean).join('\n\n')}\n`;
}

function renderSrt(segments: readonly TranscriptSegment[]): string {
  return segments
    .map((segment, index) => {
      const start = formatTimestamp(segment.startSeconds, ',');
      const end = formatTimestamp(segment.endSeconds, ',');
      return `${index + 1}\n${start} --> ${end}\n${segment.text.trim()}\n`;
    })
    .join('\n');
}

function renderVtt(segments: readonly TranscriptSegment[]): string {
  const body = segments
    .map((segment) => {
      const start = formatTimestamp(segment.startSeconds, '.');
      const end = formatTimestamp(segment.endSeconds, '.');
      return `${start} --> ${end}\n${segment.text.trim()}\n`;
    })
    .join('\n');

  return `WEBVTT\n\n${body}`;
}

function formatTimestamp(seconds: number, millisecondSeparator: ',' | '.'): string {
  const totalMilliseconds = Math.max(0, Math.round(seconds * 1000));
  const hours = Math.floor(totalMilliseconds / 3_600_000);
  const minutes = Math.floor((totalMilliseconds % 3_600_000) / 60_000);
  const wholeSeconds = Math.floor((totalMilliseconds % 60_000) / 1000);
  const milliseconds = totalMilliseconds % 1000;

  return `${pad(hours)}:${pad(minutes)}:${pad(wholeSeconds)}${millisecondSeparator}${milliseconds
    .toString()
    .padStart(3, '0')}`;
}

function pad(value: number): string {
  return value.toString().padStart(2, '0');
}

function formatEditableTimestamp(seconds: number): string {
  const totalMilliseconds = Math.max(0, Math.round(seconds * 1000));
  const hours = Math.floor(totalMilliseconds / 3_600_000);
  const minutes = Math.floor((totalMilliseconds % 3_600_000) / 60_000);
  const wholeSeconds = Math.floor((totalMilliseconds % 60_000) / 1000);
  const milliseconds = totalMilliseconds % 1000;
  const suffix = milliseconds > 0 ? `.${milliseconds.toString().padStart(3, '0').replace(/0+$/, '')}` : '';

  if (hours > 0) {
    return `${hours}:${pad(minutes)}:${pad(wholeSeconds)}${suffix}`;
  }

  return `${minutes}:${pad(wholeSeconds)}${suffix}`;
}
