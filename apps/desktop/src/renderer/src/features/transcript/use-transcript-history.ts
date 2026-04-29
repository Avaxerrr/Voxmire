import { useCallback, useEffect, useState } from 'react';
import type { TranscriptSegment, TranscriptSegmentListResult } from '@voxmire/contracts';
import { isEditableHistoryShortcutTarget } from '../../lib/keyboard';
import { replaceSegmentInTranscriptSnapshot, transcriptSegmentsEqual, type TranscriptHistoryEntry } from '../../lib/transcript-history';

const transcriptHistoryLimit = 20;

type UseTranscriptHistoryOptions = {
  mergeSegment: (segmentId: string, direction: 'previous' | 'next') => Promise<TranscriptSegment[] | null>;
  replaceSegments: (segments: TranscriptSegment[]) => Promise<TranscriptSegment[] | null>;
  resetSegments: () => Promise<TranscriptSegmentListResult | null>;
  selectedJobId: string | null;
  segments: TranscriptSegment[];
  splitSegment: (segmentId: string, offset: number) => Promise<TranscriptSegment[] | null>;
  updateSegment: (segmentId: string, text: string) => Promise<TranscriptSegment | null>;
  updateSegmentTiming: (segmentId: string, startSeconds: number, endSeconds: number) => Promise<TranscriptSegmentListResult | null>;
};

export type TranscriptHistoryController = {
  applyTranscriptHistory: (direction: 'undo' | 'redo') => Promise<void>;
  editorResetSignal: number;
  historyBusy: boolean;
  mergeSegmentWithHistory: (segmentId: string, direction: 'previous' | 'next') => Promise<TranscriptSegment[] | null>;
  redoLabel: string | null;
  rememberTranscriptHistory: (label: string, before: TranscriptSegment[], after: TranscriptSegment[]) => void;
  resetTranscriptOpen: boolean;
  resetTranscriptWithHistory: () => Promise<void>;
  resettingTranscript: boolean;
  setResetTranscriptOpen: (open: boolean) => void;
  splitSegmentWithHistory: (segmentId: string, offset: number) => Promise<TranscriptSegment[] | null>;
  undoLabel: string | null;
  updateSegmentTimingWithHistory: (segmentId: string, startSeconds: number, endSeconds: number) => Promise<TranscriptSegmentListResult | null>;
  updateSegmentWithHistory: (segmentId: string, text: string) => Promise<TranscriptSegment | null>;
};

export function useTranscriptHistory({
  mergeSegment,
  replaceSegments,
  resetSegments,
  selectedJobId,
  segments,
  splitSegment,
  updateSegment,
  updateSegmentTiming
}: UseTranscriptHistoryOptions): TranscriptHistoryController {
  const [resetTranscriptOpen, setResetTranscriptOpen] = useState(false);
  const [resettingTranscript, setResettingTranscript] = useState(false);
  const [undoStack, setUndoStack] = useState<TranscriptHistoryEntry[]>([]);
  const [redoStack, setRedoStack] = useState<TranscriptHistoryEntry[]>([]);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [editorResetSignal, setEditorResetSignal] = useState(0);

  const rememberTranscriptHistory = useCallback((label: string, before: TranscriptSegment[], after: TranscriptSegment[]): void => {
    if (transcriptSegmentsEqual(before, after)) {
      return;
    }

    setUndoStack((current) => [
      ...current.slice(Math.max(0, current.length - transcriptHistoryLimit + 1)),
      { after, before, label }
    ]);
    setRedoStack([]);
  }, []);

  const applyTranscriptHistory = useCallback(async (direction: 'undo' | 'redo'): Promise<void> => {
    if (historyBusy || !selectedJobId) {
      return;
    }

    const stack = direction === 'undo' ? undoStack : redoStack;
    const entry = stack[stack.length - 1];
    if (!entry) {
      return;
    }

    setHistoryBusy(true);
    try {
      const restored = await replaceSegments(direction === 'undo' ? entry.before : entry.after);
      if (!restored) {
        return;
      }

      setEditorResetSignal((value) => value + 1);
      if (direction === 'undo') {
        setUndoStack((current) => current.slice(0, -1));
        setRedoStack((current) => [
          ...current.slice(Math.max(0, current.length - transcriptHistoryLimit + 1)),
          entry
        ]);
        return;
      }

      setRedoStack((current) => current.slice(0, -1));
      setUndoStack((current) => [
        ...current.slice(Math.max(0, current.length - transcriptHistoryLimit + 1)),
        entry
      ]);
    } finally {
      setHistoryBusy(false);
    }
  }, [historyBusy, redoStack, replaceSegments, selectedJobId, undoStack]);

  const updateSegmentWithHistory = useCallback(async (segmentId: string, text: string): Promise<TranscriptSegment | null> => {
    const before = segments;
    const updated = await updateSegment(segmentId, text);
    if (updated) {
      rememberTranscriptHistory('Edit text', before, replaceSegmentInTranscriptSnapshot(before, updated));
    }

    return updated;
  }, [rememberTranscriptHistory, segments, updateSegment]);

  const updateSegmentTimingWithHistory = useCallback(async (
    segmentId: string,
    startSeconds: number,
    endSeconds: number
  ): Promise<TranscriptSegmentListResult | null> => {
    const before = segments;
    const result = await updateSegmentTiming(segmentId, startSeconds, endSeconds);
    if (result && !result.error) {
      rememberTranscriptHistory('Edit timing', before, result.segments);
    }

    return result;
  }, [rememberTranscriptHistory, segments, updateSegmentTiming]);

  const splitSegmentWithHistory = useCallback(async (segmentId: string, offset: number): Promise<TranscriptSegment[] | null> => {
    const before = segments;
    const updatedSegments = await splitSegment(segmentId, offset);
    if (updatedSegments) {
      rememberTranscriptHistory('Split segment', before, updatedSegments);
    }

    return updatedSegments;
  }, [rememberTranscriptHistory, segments, splitSegment]);

  const mergeSegmentWithHistory = useCallback(async (segmentId: string, direction: 'previous' | 'next'): Promise<TranscriptSegment[] | null> => {
    const before = segments;
    const updatedSegments = await mergeSegment(segmentId, direction);
    if (updatedSegments) {
      rememberTranscriptHistory('Merge segments', before, updatedSegments);
    }

    return updatedSegments;
  }, [mergeSegment, rememberTranscriptHistory, segments]);

  const resetTranscriptWithHistory = useCallback(async (): Promise<void> => {
    if (resettingTranscript) {
      return;
    }

    const before = segments;
    setResettingTranscript(true);
    try {
      const result = await resetSegments();
      if (result && !result.error) {
        rememberTranscriptHistory('Reset transcript', before, result.segments);
        setEditorResetSignal((value) => value + 1);
        setResetTranscriptOpen(false);
      }
    } finally {
      setResettingTranscript(false);
    }
  }, [rememberTranscriptHistory, resetSegments, resettingTranscript, segments]);

  useEffect(() => {
    setUndoStack([]);
    setRedoStack([]);
    setEditorResetSignal((value) => value + 1);
  }, [selectedJobId]);

  useEffect(() => {
    function handleHistoryKeyDown(event: KeyboardEvent): void {
      const commandModifier = event.ctrlKey || event.metaKey;
      if (!commandModifier || isEditableHistoryShortcutTarget(event.target)) {
        return;
      }

      const key = event.key.toLowerCase();
      if (key === 'z' && !event.shiftKey) {
        event.preventDefault();
        void applyTranscriptHistory('undo');
        return;
      }

      if (key === 'y' || (key === 'z' && event.shiftKey)) {
        event.preventDefault();
        void applyTranscriptHistory('redo');
      }
    }

    window.addEventListener('keydown', handleHistoryKeyDown);
    return () => window.removeEventListener('keydown', handleHistoryKeyDown);
  }, [applyTranscriptHistory]);

  return {
    applyTranscriptHistory,
    editorResetSignal,
    historyBusy,
    mergeSegmentWithHistory,
    redoLabel: redoStack[redoStack.length - 1]?.label ?? null,
    rememberTranscriptHistory,
    resetTranscriptOpen,
    resetTranscriptWithHistory,
    resettingTranscript,
    setResetTranscriptOpen,
    splitSegmentWithHistory,
    undoLabel: undoStack[undoStack.length - 1]?.label ?? null,
    updateSegmentTimingWithHistory,
    updateSegmentWithHistory
  };
}