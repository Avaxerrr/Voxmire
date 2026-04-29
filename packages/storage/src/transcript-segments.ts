import type { SQLInputValue } from 'node:sqlite';
import { type TranscriptSegment, transcriptSegmentSchema } from '@voxmire/contracts';
import { createId } from './ids';
import { parseSegmentRow, serializeWordTimings, toSegmentRow } from './rows';
import {
  alignmentStatusForTiming,
  joinSegmentText,
  mergeAlignmentStatus,
  mergeConfidence,
  mergeWordTimings,
  partitionWordTimingsForSplit,
  reconcileTextEditAlignment,
  shouldLinkTimingBoundary,
  splitAlignmentStatus,
  splitSecondsForTextOffset,
  validateSegmentTiming
} from './transcript-editing';
import { runTransaction } from './transactions';
import type { TranscriptSegmentListUpdate, VoxmireDatabase } from './types';

export function saveTranscriptSegment(db: VoxmireDatabase, segment: TranscriptSegment): TranscriptSegment {
  const parsedSegment = transcriptSegmentSchema.parse(segment);
  saveTranscriptSegmentRows(db, [toSegmentRow(parsedSegment)]);

  return parsedSegment;
}

export function saveTranscriptSegments(db: VoxmireDatabase, segments: readonly TranscriptSegment[]): TranscriptSegment[] {
  const parsedSegments = segments.map((segment) => transcriptSegmentSchema.parse(segment));
  saveTranscriptSegmentRows(db, parsedSegments.map(toSegmentRow));
  return parsedSegments;
}

export function updateTranscriptSegmentText(
  db: VoxmireDatabase,
  jobId: string,
  segmentId: string,
  text: string
): TranscriptSegment | null {
  const current = getTranscriptSegment(db, jobId, segmentId);
  if (!current) {
    return null;
  }

  const now = new Date().toISOString();
  const nextAlignment = reconcileTextEditAlignment(current, text);
  db.prepare(
    `UPDATE transcript_segments
     SET text = @text,
         original_text = @originalText,
         word_timings = @wordTimings,
         alignment_status = @alignmentStatus,
         edited_at = @editedAt
     WHERE id = @segmentId
       AND job_id = @jobId`
  ).run({
    jobId,
    segmentId,
    text,
    originalText: current.originalText ?? current.text,
    wordTimings: serializeWordTimings(nextAlignment.wordTimings),
    alignmentStatus: nextAlignment.alignmentStatus,
    editedAt: now
  });

  return getTranscriptSegment(db, jobId, segmentId);
}

export function updateTranscriptSegmentTiming(
  db: VoxmireDatabase,
  jobId: string,
  segmentId: string,
  startSeconds: number,
  endSeconds: number
): TranscriptSegmentListUpdate {
  const segments = getTranscriptSegments(db, jobId);
  const currentIndex = segments.findIndex((segment) => segment.id === segmentId);
  const current = segments[currentIndex];
  if (!current) {
    return { segments, error: 'Transcript segment not found.' };
  }

  const validationError = validateSegmentTiming(segments, currentIndex, startSeconds, endSeconds);
  if (validationError) {
    return { segments, error: validationError };
  }

  const previous = segments[currentIndex - 1];
  const next = segments[currentIndex + 1];
  const linkPreviousBoundary = Boolean(previous && shouldLinkTimingBoundary(previous.endSeconds, current.startSeconds));
  const linkNextBoundary = Boolean(next && shouldLinkTimingBoundary(current.endSeconds, next.startSeconds));
  const now = new Date().toISOString();
  const nextAlignmentStatus = alignmentStatusForTiming(current, startSeconds, endSeconds);

  runTransaction(db, () => {
    db.prepare(
      `UPDATE transcript_segments
       SET start_seconds = @startSeconds,
           end_seconds = @endSeconds,
           alignment_status = @alignmentStatus,
           edited_at = @editedAt
       WHERE id = @segmentId
         AND job_id = @jobId`
    ).run({
      jobId,
      segmentId,
      startSeconds,
      endSeconds,
      alignmentStatus: nextAlignmentStatus,
      editedAt: now
    });

    if (previous && linkPreviousBoundary && previous.endSeconds !== startSeconds) {
      db.prepare(
        `UPDATE transcript_segments
         SET end_seconds = @endSeconds,
             alignment_status = @alignmentStatus,
             edited_at = @editedAt
         WHERE id = @segmentId
           AND job_id = @jobId`
      ).run({
        jobId,
        segmentId: previous.id,
        endSeconds: startSeconds,
        alignmentStatus: alignmentStatusForTiming(previous, previous.startSeconds, startSeconds),
        editedAt: now
      });
    }

    if (next && linkNextBoundary && next.startSeconds !== endSeconds) {
      db.prepare(
        `UPDATE transcript_segments
         SET start_seconds = @startSeconds,
             alignment_status = @alignmentStatus,
             edited_at = @editedAt
         WHERE id = @segmentId
           AND job_id = @jobId`
      ).run({
        jobId,
        segmentId: next.id,
        startSeconds: endSeconds,
        alignmentStatus: alignmentStatusForTiming(next, endSeconds, next.endSeconds),
        editedAt: now
      });
    }
  });

  return { segments: getTranscriptSegments(db, jobId), error: null };
}

export function splitTranscriptSegment(
  db: VoxmireDatabase,
  jobId: string,
  segmentId: string,
  offset: number
): TranscriptSegment[] {
  const current = getTranscriptSegment(db, jobId, segmentId);
  if (!current || offset <= 0 || offset >= current.text.length) {
    return getTranscriptSegments(db, jobId);
  }

  const leftText = current.text.slice(0, offset).trimEnd();
  const rightText = current.text.slice(offset).trimStart();
  if (!leftText || !rightText) {
    return getTranscriptSegments(db, jobId);
  }

  const now = new Date().toISOString();
  const splitRatio = Math.min(Math.max(offset / current.text.length, 0.05), 0.95);
  const fallbackSplitSeconds = current.startSeconds + (current.endSeconds - current.startSeconds) * splitRatio;
  const splitSeconds = splitSecondsForTextOffset(current, offset, fallbackSplitSeconds);
  const originalText = current.originalText ?? current.text;
  const partitionedWordTimings = partitionWordTimingsForSplit(current, offset, splitSeconds);
  const nextSegment: TranscriptSegment = {
    id: createId('seg'),
    jobId,
    index: current.index + 1,
    startSeconds: splitSeconds,
    endSeconds: current.endSeconds,
    text: rightText,
    originalText,
    wordTimings: partitionedWordTimings.right,
    alignmentStatus: splitAlignmentStatus(current.alignmentStatus, partitionedWordTimings.right),
    confidence: current.confidence,
    createdAt: now,
    editedAt: now
  };

  runTransaction(db, () => {
    db.prepare(
      `UPDATE transcript_segments
       SET segment_index = -(segment_index + 1)
       WHERE job_id = @jobId
         AND segment_index > @index`
    ).run({ jobId, index: current.index });

    db.prepare(
      `UPDATE transcript_segments
       SET text = @text,
           end_seconds = @endSeconds,
           original_text = @originalText,
           word_timings = @wordTimings,
           alignment_status = @alignmentStatus,
           edited_at = @editedAt
       WHERE job_id = @jobId
         AND id = @segmentId`
    ).run({
      jobId,
      segmentId,
      text: leftText,
      endSeconds: splitSeconds,
      originalText,
      wordTimings: serializeWordTimings(partitionedWordTimings.left),
      alignmentStatus: splitAlignmentStatus(current.alignmentStatus, partitionedWordTimings.left),
      editedAt: now
    });

    db.prepare(
      `INSERT INTO transcript_segments (
         id, job_id, segment_index, start_seconds, end_seconds, text, original_text, word_timings, alignment_status, confidence, created_at, edited_at
       )
       VALUES (
         @id, @jobId, @index, @startSeconds, @endSeconds, @text, @originalText, @wordTimings, @alignmentStatus, @confidence, @createdAt, @editedAt
       )`
    ).run(toSegmentRow(nextSegment));

    db.prepare(
      `UPDATE transcript_segments
       SET segment_index = -segment_index
       WHERE job_id = @jobId
         AND segment_index < 0`
    ).run({ jobId });
  });

  return getTranscriptSegments(db, jobId);
}

export function mergeTranscriptSegment(
  db: VoxmireDatabase,
  jobId: string,
  segmentId: string,
  direction: 'previous' | 'next'
): TranscriptSegment[] {
  const segments = getTranscriptSegments(db, jobId);
  const currentIndex = segments.findIndex((segment) => segment.id === segmentId);
  if (currentIndex < 0) {
    return segments;
  }

  const neighborIndex = direction === 'previous' ? currentIndex - 1 : currentIndex + 1;
  const neighbor = segments[neighborIndex];
  const current = segments[currentIndex];
  if (!neighbor || !current) {
    return segments;
  }

  const first = direction === 'previous' ? neighbor : current;
  const second = direction === 'previous' ? current : neighbor;
  const now = new Date().toISOString();
  const mergedText = joinSegmentText(first.text, second.text);
  const originalText = first.originalText ?? second.originalText ?? first.text;
  const mergedWordTimings = mergeWordTimings(first, second);

  runTransaction(db, () => {
    db.prepare(
      `UPDATE transcript_segments
       SET text = @text,
           start_seconds = @startSeconds,
           end_seconds = @endSeconds,
           original_text = @originalText,
           edited_at = @editedAt,
           word_timings = @wordTimings,
           alignment_status = @alignmentStatus,
           confidence = @confidence
       WHERE job_id = @jobId
         AND id = @segmentId`
    ).run({
      jobId,
      segmentId: first.id,
      text: mergedText,
      startSeconds: first.startSeconds,
      endSeconds: second.endSeconds,
      originalText,
      editedAt: now,
      wordTimings: serializeWordTimings(mergedWordTimings),
      alignmentStatus: mergeAlignmentStatus(first, second, mergedWordTimings),
      confidence: mergeConfidence(first.confidence, second.confidence)
    });

    db.prepare('DELETE FROM transcript_segments WHERE job_id = ? AND id = ?').run(jobId, second.id);

    db.prepare(
      `UPDATE transcript_segments
       SET segment_index = -(segment_index + 1)
       WHERE job_id = @jobId
         AND segment_index > @removedIndex`
    ).run({ jobId, removedIndex: second.index });

    db.prepare(
      `UPDATE transcript_segments
       SET segment_index = -segment_index - 2
       WHERE job_id = @jobId
         AND segment_index < 0`
    ).run({ jobId });
  });

  return getTranscriptSegments(db, jobId);
}

export function replaceTranscriptSegments(
  db: VoxmireDatabase,
  jobId: string,
  segments: TranscriptSegment[]
): TranscriptSegment[] {
  if (segments.length === 0) {
    return getTranscriptSegments(db, jobId);
  }

  const snapshot = segments.map((segment, index) => transcriptSegmentSchema.parse({
    ...segment,
    jobId,
    index
  }));
  const insertSegment = db.prepare(
    `INSERT INTO transcript_segments (
       id, job_id, segment_index, start_seconds, end_seconds, text, original_text, word_timings, alignment_status, confidence, created_at, edited_at
     )
     VALUES (
       @id, @jobId, @index, @startSeconds, @endSeconds, @text, @originalText, @wordTimings, @alignmentStatus, @confidence, @createdAt, @editedAt
     )`
  );

  runTransaction(db, () => {
    db.prepare('DELETE FROM transcript_segments WHERE job_id = ?').run(jobId);
    snapshot.forEach((segment) => {
      insertSegment.run(toSegmentRow(segment));
    });
  });

  return getTranscriptSegments(db, jobId);
}

export function resetTranscriptSegmentsToOriginal(db: VoxmireDatabase, jobId: string): TranscriptSegmentListUpdate {
  const originalSegments = getOriginalTranscriptSegments(db, jobId);
  if (originalSegments.length === 0) {
    return {
      segments: getTranscriptSegments(db, jobId),
      error: 'Original transcript snapshot is unavailable.'
    };
  }

  return {
    segments: replaceTranscriptSegments(db, jobId, originalSegments),
    error: null
  };
}

export function getTranscriptSegments(db: VoxmireDatabase, jobId: string): TranscriptSegment[] {
  const rows = db
    .prepare('SELECT * FROM transcript_segments WHERE job_id = ? ORDER BY segment_index ASC')
    .all(jobId);

  return rows.map(parseSegmentRow);
}

export function getOriginalTranscriptSegments(db: VoxmireDatabase, jobId: string): TranscriptSegment[] {
  const rows = db
    .prepare('SELECT * FROM original_transcript_segments WHERE job_id = ? ORDER BY segment_index ASC')
    .all(jobId);

  return rows.map(parseSegmentRow);
}

export function getTranscriptSegment(db: VoxmireDatabase, jobId: string, segmentId: string): TranscriptSegment | null {
  const row = db.prepare('SELECT * FROM transcript_segments WHERE job_id = ? AND id = ?').get(jobId, segmentId);
  return row ? parseSegmentRow(row) : null;
}

export function countTranscriptSegments(db: VoxmireDatabase, jobId: string): number {
  const row = db.prepare('SELECT COUNT(*) AS count FROM transcript_segments WHERE job_id = ?').get(jobId) as
    | { count: number }
    | undefined;
  return Number(row?.count ?? 0);
}

function saveTranscriptSegmentRows(db: VoxmireDatabase, segmentRows: Array<Record<string, SQLInputValue>>): void {
  if (segmentRows.length === 0) {
    return;
  }

  runTransaction(db, () => {
    const transcriptStatement = db.prepare(
      `INSERT INTO transcript_segments (
         id, job_id, segment_index, start_seconds, end_seconds, text, original_text, word_timings, alignment_status, confidence, created_at, edited_at
       )
       VALUES (
         @id, @jobId, @index, @startSeconds, @endSeconds, @text, @originalText, @wordTimings, @alignmentStatus, @confidence, @createdAt, @editedAt
       )
       ON CONFLICT(job_id, segment_index) DO UPDATE SET
         start_seconds = excluded.start_seconds,
         end_seconds = excluded.end_seconds,
         text = CASE
           WHEN transcript_segments.edited_at IS NULL THEN excluded.text
           ELSE transcript_segments.text
         END,
         original_text = CASE
           WHEN transcript_segments.edited_at IS NULL THEN excluded.original_text
           ELSE transcript_segments.original_text
         END,
         word_timings = CASE
           WHEN transcript_segments.edited_at IS NULL THEN excluded.word_timings
           ELSE transcript_segments.word_timings
         END,
         alignment_status = CASE
           WHEN transcript_segments.edited_at IS NULL THEN excluded.alignment_status
           ELSE transcript_segments.alignment_status
         END,
         confidence = excluded.confidence`
    );

    const originalStatement = db.prepare(
      `INSERT INTO original_transcript_segments (
         id, job_id, segment_index, start_seconds, end_seconds, text, original_text, word_timings, alignment_status, confidence, created_at, edited_at
       )
       VALUES (
         @id, @jobId, @index, @startSeconds, @endSeconds, @text, @originalText, @wordTimings, @alignmentStatus, @confidence, @createdAt, @editedAt
       )
       ON CONFLICT(job_id, segment_index) DO NOTHING`
    );

    for (const segmentRow of segmentRows) {
      transcriptStatement.run(segmentRow);
      originalStatement.run(segmentRow);
    }
  });
}
