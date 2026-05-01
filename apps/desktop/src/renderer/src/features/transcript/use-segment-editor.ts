import { useEffect, useRef, useState } from 'react';
import type { TranscriptSegment, TranscriptSegmentListResult } from '@voxmire/contracts';
import { debugTranscriptInteraction } from './transcript-interaction-debug';

type UseSegmentEditorOptions = {
  onMergeSegment: (segmentId: string, direction: 'previous' | 'next') => Promise<TranscriptSegment[] | null>;
  onSeek: (segment: TranscriptSegment) => void;
  onSplitSegment: (segmentId: string, offset: number) => Promise<TranscriptSegment[] | null>;
  onUpdateSegment: (segmentId: string, text: string) => Promise<TranscriptSegment | null>;
  onUpdateTiming: (segmentId: string, startSeconds: number, endSeconds: number) => Promise<TranscriptSegmentListResult | null>;
  resetSignal: number;
  scrollToIndex: (index: number) => void;
  segments: TranscriptSegment[];
};

export type SegmentEditorController = {
  cancelEditing: () => void;
  cursorOffset: number;
  draftText: string;
  editingSegmentId: string | null;
  mergeSegment: (segment: TranscriptSegment, direction: 'previous' | 'next', currentIndex: number) => Promise<void>;
  saveAndClose: (segment: TranscriptSegment, nextText: string) => Promise<void>;
  saveAndMoveToNext: (segment: TranscriptSegment, nextText: string, currentIndex: number) => Promise<boolean>;
  saveAndMoveToPrevious: (segment: TranscriptSegment, nextText: string, currentIndex: number) => Promise<boolean>;
  saveErrorSegmentId: string | null;
  saveSegmentText: (segment: TranscriptSegment, nextText: string) => Promise<boolean>;
  saveSegmentTiming: (segment: TranscriptSegment, startSeconds: number, endSeconds: number) => Promise<boolean>;
  savingSegmentId: string | null;
  savingTimingSegmentId: string | null;
  setCursorOffset: (offset: number) => void;
  setDraftText: (text: string) => void;
  splitSegment: (segment: TranscriptSegment, offset: number, currentIndex: number) => Promise<void>;
  startEditing: (segment: TranscriptSegment, options?: { seek?: boolean }) => void;
};

export function useSegmentEditor({
  onMergeSegment,
  onSeek,
  onSplitSegment,
  onUpdateSegment,
  onUpdateTiming,
  resetSignal,
  scrollToIndex,
  segments
}: UseSegmentEditorOptions): SegmentEditorController {
  const [editingSegmentId, setEditingSegmentId] = useState<string | null>(null);
  const editingSegmentIdRef = useRef<string | null>(null);
  const previousResetSignalRef = useRef(resetSignal);
  const [draftText, setDraftText] = useState('');
  const [savingSegmentId, setSavingSegmentId] = useState<string | null>(null);
  const [savingTimingSegmentId, setSavingTimingSegmentId] = useState<string | null>(null);
  const [saveErrorSegmentId, setSaveErrorSegmentId] = useState<string | null>(null);
  const [cursorOffset, setCursorOffset] = useState(0);

  function updateEditingSegmentId(nextSegmentId: string | null): void {
    debugTranscriptInteraction('editor-set-editing', {
      fromSegmentId: editingSegmentIdRef.current,
      toSegmentId: nextSegmentId
    });
    editingSegmentIdRef.current = nextSegmentId;
    setEditingSegmentId(nextSegmentId);
  }

  function startEditing(segment: TranscriptSegment, options: { seek?: boolean } = {}): void {
    if (editingSegmentIdRef.current === segment.id) {
      debugTranscriptInteraction('editor-start-existing', { segmentId: segment.id });
      return;
    }

    debugTranscriptInteraction('editor-start', { segmentId: segment.id, seek: options.seek !== false });
    setSaveErrorSegmentId(null);
    updateEditingSegmentId(segment.id);
    setDraftText(segment.text);
    setCursorOffset(segment.text.length);
    if (options.seek !== false) {
      onSeek(segment);
    }
  }

  function cancelEditing(): void {
    updateEditingSegmentId(null);
    setDraftText('');
    setCursorOffset(0);
  }

  async function saveSegmentText(segment: TranscriptSegment, nextText: string): Promise<boolean> {
    const normalizedText = nextText.trimEnd();
    if (normalizedText === segment.text) {
      setSaveErrorSegmentId(null);
      return true;
    }

    setSavingSegmentId(segment.id);
    setSaveErrorSegmentId(null);
    try {
      const updated = await onUpdateSegment(segment.id, normalizedText);
      if (!updated) {
        setSaveErrorSegmentId(segment.id);
        return false;
      }

      return true;
    } finally {
      setSavingSegmentId(null);
    }
  }

  async function saveAndClose(segment: TranscriptSegment, nextText: string): Promise<void> {
    const saved = await saveSegmentText(segment, nextText);
    if (saved && editingSegmentIdRef.current === segment.id) {
      debugTranscriptInteraction('editor-save-close-clear', { segmentId: segment.id });
      cancelEditing();
      return;
    }

    if (saved) {
      debugTranscriptInteraction('editor-save-close-preserve-current', {
        savedSegmentId: segment.id,
        currentEditingSegmentId: editingSegmentIdRef.current
      });
    }
  }

  async function saveAndMoveToNext(segment: TranscriptSegment, nextText: string, currentIndex: number): Promise<boolean> {
    const saved = await saveSegmentText(segment, nextText);
    if (!saved) {
      return false;
    }

    const nextSegment = segments[currentIndex + 1];
    if (!nextSegment) {
      cancelEditing();
      return true;
    }

    updateEditingSegmentId(nextSegment.id);
    setDraftText(nextSegment.text);
    setCursorOffset(nextSegment.text.length);
    onSeek(nextSegment);
    scrollToIndex(currentIndex + 1);
    return true;
  }

  async function saveAndMoveToPrevious(segment: TranscriptSegment, nextText: string, currentIndex: number): Promise<boolean> {
    const saved = await saveSegmentText(segment, nextText);
    if (!saved) {
      return false;
    }

    const previousSegment = segments[currentIndex - 1];
    if (!previousSegment) {
      return true;
    }

    updateEditingSegmentId(previousSegment.id);
    setDraftText(previousSegment.text);
    setCursorOffset(previousSegment.text.length);
    onSeek(previousSegment);
    scrollToIndex(currentIndex - 1);
    return true;
  }

  async function splitSegment(segment: TranscriptSegment, offset: number, currentIndex: number): Promise<void> {
    const text = segment.id === editingSegmentId ? draftText : segment.text;
    const saved = await saveSegmentText(segment, text);
    if (!saved) {
      return;
    }

    const splitOffset = Math.max(1, Math.min(offset, text.trimEnd().length - 1));
    const updatedSegments = await onSplitSegment(segment.id, splitOffset);
    if (!updatedSegments) {
      setSaveErrorSegmentId(segment.id);
      return;
    }

    const nextSegment = updatedSegments[currentIndex + 1] ?? updatedSegments[currentIndex];
    if (nextSegment) {
      updateEditingSegmentId(nextSegment.id);
      setDraftText(nextSegment.text);
      setCursorOffset(0);
      onSeek(nextSegment);
      scrollToIndex(Math.min(currentIndex + 1, updatedSegments.length - 1));
    }
  }

  async function mergeSegment(segment: TranscriptSegment, direction: 'previous' | 'next', currentIndex: number): Promise<void> {
    const text = segment.id === editingSegmentId ? draftText : segment.text;
    const saved = await saveSegmentText(segment, text);
    if (!saved) {
      return;
    }

    const updatedSegments = await onMergeSegment(segment.id, direction);
    if (!updatedSegments) {
      setSaveErrorSegmentId(segment.id);
      return;
    }

    const nextIndex = direction === 'previous' ? Math.max(currentIndex - 1, 0) : currentIndex;
    const mergedSegment = updatedSegments[nextIndex];
    if (mergedSegment) {
      updateEditingSegmentId(mergedSegment.id);
      setDraftText(mergedSegment.text);
      setCursorOffset(mergedSegment.text.length);
      onSeek(mergedSegment);
      scrollToIndex(nextIndex);
    }
  }

  async function saveSegmentTiming(segment: TranscriptSegment, startSeconds: number, endSeconds: number): Promise<boolean> {
    if (startSeconds === segment.startSeconds && endSeconds === segment.endSeconds) {
      setSaveErrorSegmentId(null);
      return true;
    }

    setSavingTimingSegmentId(segment.id);
    setSaveErrorSegmentId(null);
    try {
      const result = await onUpdateTiming(segment.id, startSeconds, endSeconds);
      if (!result || result.error) {
        setSaveErrorSegmentId(segment.id);
        return false;
      }

      return true;
    } finally {
      setSavingTimingSegmentId(null);
    }
  }

  useEffect(() => {
    if (previousResetSignalRef.current === resetSignal) {
      return;
    }

    previousResetSignalRef.current = resetSignal;
    updateEditingSegmentId(null);
    setDraftText('');
    setCursorOffset(0);
    setSaveErrorSegmentId(null);
  }, [resetSignal]);

  useEffect(() => {
    if (!editingSegmentId) {
      return;
    }

    const segment = segments.find((candidate) => candidate.id === editingSegmentId);
    if (!segment || draftText.trimEnd() === segment.text || savingSegmentId === editingSegmentId) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      void saveSegmentText(segment, draftText);
    }, 1200);

    return () => window.clearTimeout(timeoutId);
  }, [draftText, editingSegmentId, savingSegmentId, segments]);

  return {
    cancelEditing,
    cursorOffset,
    draftText,
    editingSegmentId,
    mergeSegment,
    saveAndClose,
    saveAndMoveToNext,
    saveAndMoveToPrevious,
    saveErrorSegmentId,
    saveSegmentText,
    saveSegmentTiming,
    savingSegmentId,
    savingTimingSegmentId,
    setCursorOffset,
    setDraftText,
    splitSegment,
    startEditing
  };
}