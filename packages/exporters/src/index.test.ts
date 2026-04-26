import { describe, expect, it } from 'vitest';
import type { TranscriptSegment } from '@voxmire/contracts';
import { renderTranscriptExport } from './index';

const segments: TranscriptSegment[] = [
  {
    id: 'seg_1',
    jobId: 'job_1',
    index: 0,
    startSeconds: 0,
    endSeconds: 2.5,
    text: 'Hello world.',
    confidence: null,
    createdAt: '2026-04-23T00:00:00.000Z'
  }
];

describe('exporters', () => {
  it('renders plain text', () => {
    expect(renderTranscriptExport('txt', segments)).toContain('Hello world.');
  });

  it('renders the current edited segment text', () => {
    expect(renderTranscriptExport('txt', [{ ...segments[0]!, text: 'Corrected text.', originalText: 'Hello world.' }])).toContain(
      'Corrected text.'
    );
  });

  it('renders VTT header', () => {
    expect(renderTranscriptExport('vtt', segments).startsWith('WEBVTT')).toBe(true);
  });
});
