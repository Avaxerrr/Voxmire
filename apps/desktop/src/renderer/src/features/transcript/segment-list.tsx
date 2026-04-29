import { type FocusEvent as ReactFocusEvent, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactElement, useEffect, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ArrowDownToLine, ArrowUpToLine, Scissors } from 'lucide-react';
import type { TranscriptSegment, TranscriptSegmentListResult } from '@voxmire/contracts';
import { formatEditableTime, formatTime, parseEditableTime } from '../../lib/format';
import { HighlightedTranscriptText } from './highlighted-transcript-text';
import { getPlaybackWordState, type PlaybackWordState } from './word-timing';

type VirtualizedSegmentListProps = {
  activeSegmentIndex: number;
  diagnosticsEnabled: boolean;
  onWordTimingDiagnostic: (details: {
    activeSegmentIndex: number;
    playbackTime: number;
    segment: TranscriptSegment | undefined;
    wordState: PlaybackWordState | null;
  }) => void;
  onMergeSegment: (segmentId: string, direction: 'previous' | 'next') => Promise<TranscriptSegment[] | null>;
  onSeek: (segment: TranscriptSegment) => void;
  onSeekTime: (seconds: number, preferredSegmentId?: string) => void;
  onSplitSegment: (segmentId: string, offset: number) => Promise<TranscriptSegment[] | null>;
  onUpdateTiming: (segmentId: string, startSeconds: number, endSeconds: number) => Promise<TranscriptSegmentListResult | null>;
  onUpdateSegment: (segmentId: string, text: string) => Promise<TranscriptSegment | null>;
  activeSearchSegmentId: string | null;
  playbackTime: number;
  resetSignal: number;
  searchQuery: string;
  segments: TranscriptSegment[];
};

export function VirtualizedSegmentList({
  activeSegmentIndex,
  diagnosticsEnabled,
  onWordTimingDiagnostic,
  onMergeSegment,
  onSeek,
  onSeekTime,
  onSplitSegment,
  onUpdateTiming,
  onUpdateSegment,
  activeSearchSegmentId,
  playbackTime,
  resetSignal,
  searchQuery,
  segments
}: VirtualizedSegmentListProps): ReactElement {
  const [editingSegmentId, setEditingSegmentId] = useState<string | null>(null);
  const [draftText, setDraftText] = useState('');
  const [savingSegmentId, setSavingSegmentId] = useState<string | null>(null);
  const [savingTimingSegmentId, setSavingTimingSegmentId] = useState<string | null>(null);
  const [saveErrorSegmentId, setSaveErrorSegmentId] = useState<string | null>(null);
  const [cursorOffset, setCursorOffset] = useState(0);
  const scrollParentRef = useRef<HTMLDivElement | null>(null);
  const lastWordDiagnosticKeyRef = useRef('');
  const rowVirtualizer = useVirtualizer({
    count: segments.length,
    estimateSize: () => 108,
    getItemKey: (index) => segments[index]?.id ?? index,
    getScrollElement: () => scrollParentRef.current,
    overscan: 8
  });

  useEffect(() => {
    setEditingSegmentId(null);
    setDraftText('');
    setCursorOffset(0);
    setSaveErrorSegmentId(null);
  }, [resetSignal]);

  useEffect(() => {
    if (activeSegmentIndex >= 0 && !editingSegmentId) {
      rowVirtualizer.scrollToIndex(activeSegmentIndex, { align: 'center' });
    }
  }, [activeSegmentIndex, editingSegmentId]);

  useEffect(() => {
    if (!activeSearchSegmentId) {
      return;
    }

    const index = segments.findIndex((segment) => segment.id === activeSearchSegmentId);
    if (index >= 0) {
      rowVirtualizer.scrollToIndex(index, { align: 'center' });
    }
  }, [activeSearchSegmentId, segments]);

  useEffect(() => {
    if (!diagnosticsEnabled) {
      return;
    }

    const segment = segments[activeSegmentIndex];
    const wordState = segment ? getPlaybackWordState(segment, playbackTime) : null;
    const diagnosticKey = [
      activeSegmentIndex,
      wordState?.reason ?? 'no-playback-segment',
      wordState?.wordIndex ?? -1
    ].join(':');

    if (diagnosticKey === lastWordDiagnosticKeyRef.current) {
      return;
    }

    lastWordDiagnosticKeyRef.current = diagnosticKey;
    onWordTimingDiagnostic({
      activeSegmentIndex,
      playbackTime,
      segment,
      wordState
    });
  }, [activeSegmentIndex, diagnosticsEnabled, playbackTime, segments]);

  function startEditing(segment: TranscriptSegment): void {
    setSaveErrorSegmentId(null);
    setEditingSegmentId(segment.id);
    setDraftText(segment.text);
    setCursorOffset(segment.text.length);
    onSeek(segment);
  }

  function cancelEditing(): void {
    setEditingSegmentId(null);
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
    if (saved && editingSegmentId === segment.id) {
      cancelEditing();
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

    setEditingSegmentId(nextSegment.id);
    setDraftText(nextSegment.text);
    setCursorOffset(nextSegment.text.length);
    onSeek(nextSegment);
    rowVirtualizer.scrollToIndex(currentIndex + 1, { align: 'center' });
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

    setEditingSegmentId(previousSegment.id);
    setDraftText(previousSegment.text);
    setCursorOffset(previousSegment.text.length);
    onSeek(previousSegment);
    rowVirtualizer.scrollToIndex(currentIndex - 1, { align: 'center' });
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
      setEditingSegmentId(nextSegment.id);
      setDraftText(nextSegment.text);
      setCursorOffset(0);
      onSeek(nextSegment);
      rowVirtualizer.scrollToIndex(Math.min(currentIndex + 1, updatedSegments.length - 1), { align: 'center' });
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
      setEditingSegmentId(mergedSegment.id);
      setDraftText(mergedSegment.text);
      setCursorOffset(mergedSegment.text.length);
      onSeek(mergedSegment);
      rowVirtualizer.scrollToIndex(nextIndex, { align: 'center' });
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

  return (
    <div className="segment-list virtualized" ref={scrollParentRef}>
      <div className="segment-list-inner" style={{ height: `${rowVirtualizer.getTotalSize()}px` }}>
        {rowVirtualizer.getVirtualItems().map((virtualRow) => {
          const segment = segments[virtualRow.index];
          if (!segment) {
            return null;
          }

          const active = virtualRow.index === activeSegmentIndex;
          const editing = segment.id === editingSegmentId;
          const saving = segment.id === savingSegmentId;
          const savingTiming = segment.id === savingTimingSegmentId;
          const saveError = segment.id === saveErrorSegmentId;
          const searchMatch = searchQuery.trim() ? segment.text.toLowerCase().includes(searchQuery.trim().toLowerCase()) : false;
          const activeSearchMatch = segment.id === activeSearchSegmentId;
          return (
            <div
              className="segment-virtual-row"
              data-index={virtualRow.index}
              key={virtualRow.key}
              ref={rowVirtualizer.measureElement}
              style={{ transform: `translateY(${virtualRow.start}px)` }}
            >
              <EditableSegmentRow
                active={active}
                searchMatch={searchMatch}
                activeSearchMatch={activeSearchMatch}
                canMergeNext={virtualRow.index < segments.length - 1}
                canMergePrevious={virtualRow.index > 0}
                cursorOffset={cursorOffset}
                draftText={draftText}
                editing={editing}
                onCancel={cancelEditing}
                onDraftChange={setDraftText}
                onCursorOffsetChange={setCursorOffset}
                onFocus={() => startEditing(segment)}
                onMergeNext={() => mergeSegment(segment, 'next', virtualRow.index)}
                onMergePrevious={() => mergeSegment(segment, 'previous', virtualRow.index)}
                onSave={(nextText) => saveSegmentText(segment, nextText)}
                onSeekTime={onSeekTime}
                onSaveAndClose={(nextText) => saveAndClose(segment, nextText)}
                onSaveAndMoveNext={(nextText) => saveAndMoveToNext(segment, nextText, virtualRow.index)}
                onSaveAndMovePrevious={(nextText) => saveAndMoveToPrevious(segment, nextText, virtualRow.index)}
                onSaveTiming={(startSeconds, endSeconds) => saveSegmentTiming(segment, startSeconds, endSeconds)}
                onSelectSegment={() => onSeek(segment)}
                onSplit={(offset) => splitSegment(segment, offset, virtualRow.index)}
                saveError={saveError}
                saving={saving}
                savingTiming={savingTiming}
                searchQuery={searchQuery}
                segment={segment}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

type EditableSegmentRowProps = {
  active: boolean;
  activeSearchMatch: boolean;
  searchMatch: boolean;
  canMergeNext: boolean;
  canMergePrevious: boolean;
  cursorOffset: number;
  draftText: string;
  editing: boolean;
  onCancel: () => void;
  onCursorOffsetChange: (offset: number) => void;
  onDraftChange: (text: string) => void;
  onFocus: () => void;
  onMergeNext: () => Promise<void>;
  onMergePrevious: () => Promise<void>;
  onSave: (nextText: string) => Promise<boolean>;
  onSeekTime: (seconds: number, preferredSegmentId?: string) => void;
  onSaveAndClose: (nextText: string) => Promise<void>;
  onSaveAndMoveNext: (nextText: string) => Promise<boolean>;
  onSaveAndMovePrevious: (nextText: string) => Promise<boolean>;
  onSaveTiming: (startSeconds: number, endSeconds: number) => Promise<boolean>;
  onSelectSegment: () => void;
  onSplit: (offset: number) => Promise<void>;
  saveError: boolean;
  saving: boolean;
  savingTiming: boolean;
  searchQuery: string;
  segment: TranscriptSegment;
};

function EditableSegmentRow({
  active,
  activeSearchMatch,
  searchMatch,
  canMergeNext,
  canMergePrevious,
  cursorOffset,
  draftText,
  editing,
  onCancel,
  onCursorOffsetChange,
  onDraftChange,
  onSave,
  onSeekTime,
  onFocus,
  onMergeNext,
  onMergePrevious,
  onSaveAndClose,
  onSaveAndMoveNext,
  onSaveAndMovePrevious,
  onSaveTiming,
  onSelectSegment,
  onSplit,
  saveError,
  saving,
  savingTiming,
  searchQuery,
  segment
}: EditableSegmentRowProps): ReactElement {
  const textAreaRef = useRef<HTMLTextAreaElement | null>(null);
  const skipBlurSaveRef = useRef(false);
  const activeText = editing ? draftText : segment.text;
  const [startDraft, setStartDraft] = useState(() => formatEditableTime(segment.startSeconds));
  const [endDraft, setEndDraft] = useState(() => formatEditableTime(segment.endSeconds));

  useEffect(() => {
    setStartDraft(formatEditableTime(segment.startSeconds));
    setEndDraft(formatEditableTime(segment.endSeconds));
  }, [segment.endSeconds, segment.startSeconds]);

  useEffect(() => {
    if (!editing) {
      return;
    }

    const textArea = textAreaRef.current;
    if (!textArea) {
      return;
    }

    if (document.activeElement !== textArea) {
      textArea.focus();
      textArea.setSelectionRange(textArea.value.length, textArea.value.length);
    }
  }, [editing]);

  useEffect(() => {
    const textArea = textAreaRef.current;
    if (!textArea) {
      return;
    }

    textArea.style.height = 'auto';
    textArea.style.height = `${textArea.scrollHeight}px`;
  }, [draftText, editing, segment.text]);

  function handleEditBlur(event: ReactFocusEvent<HTMLTextAreaElement>): void {
    if (skipBlurSaveRef.current) {
      skipBlurSaveRef.current = false;
      return;
    }

    void onSaveAndClose(event.currentTarget.value);
  }

  function saveTimingDraft(): void {
    const nextStart = parseEditableTime(startDraft);
    const nextEnd = parseEditableTime(endDraft);
    if (nextStart === null || nextEnd === null) {
      return;
    }

    void onSaveTiming(nextStart, nextEnd);
  }

  function handleTimingKeyDown(event: ReactKeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      saveTimingDraft();
      event.currentTarget.blur();
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      setStartDraft(formatEditableTime(segment.startSeconds));
      setEndDraft(formatEditableTime(segment.endSeconds));
      event.currentTarget.blur();
    }
  }

  function handleEditKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>): void {
    const textArea = event.currentTarget;
    const selectionStart = textArea.selectionStart;
    const selectionEnd = textArea.selectionEnd;

    if (event.key === 'Escape') {
      event.preventDefault();
      skipBlurSaveRef.current = true;
      onCancel();
      event.currentTarget.blur();
      return;
    }

    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      void onSave(textArea.value);
      return;
    }

    if (event.key === 'Tab') {
      event.preventDefault();
      skipBlurSaveRef.current = true;
      const move = event.shiftKey ? onSaveAndMovePrevious : onSaveAndMoveNext;
      void move(textArea.value).then((moved) => {
        if (!moved) {
          skipBlurSaveRef.current = false;
        }
      });
      return;
    }

    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      if (selectionStart <= 0 || selectionStart >= textArea.value.trimEnd().length) {
        return;
      }

      skipBlurSaveRef.current = true;
      void onSplit(selectionStart).finally(() => {
        skipBlurSaveRef.current = false;
      });
      return;
    }

    if (event.key === 'Backspace' && selectionStart === 0 && selectionEnd === 0 && canMergePrevious) {
      event.preventDefault();
      runStructureTool(onMergePrevious);
      return;
    }

    if (event.key === 'Delete' && selectionStart === textArea.value.length && selectionEnd === textArea.value.length && canMergeNext) {
      event.preventDefault();
      runStructureTool(onMergeNext);
    }
  }

  function syncCursorOffset(): void {
    const textArea = textAreaRef.current;
    if (textArea) {
      onCursorOffsetChange(textArea.selectionStart);
    }
  }

  function handleStructureToolPointerDown(event: ReactPointerEvent<HTMLButtonElement>): void {
    event.preventDefault();
  }

  function handleTimestampPointerDown(event: ReactPointerEvent<HTMLInputElement>, seconds: number): void {
    event.stopPropagation();
    if (event.button === 0 && !event.defaultPrevented) {
      onSeekTime(seconds, segment.id);
    }
  }

  function handleSegmentPointerDown(event: ReactPointerEvent<HTMLDivElement>): void {
    if (event.button !== 0 || event.defaultPrevented) {
      return;
    }

    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('.segment-structure-tools, .segment-time-editors')) {
      return;
    }

    onSelectSegment();
  }

  function runStructureTool(action: () => Promise<void>): void {
    skipBlurSaveRef.current = true;
    void action().finally(() => {
      skipBlurSaveRef.current = false;
    });
  }

  const canSplit = editing && activeText.trim().length > 1 && cursorOffset > 0 && cursorOffset < activeText.length;

  return (
    <div className={`segment-row ${active ? 'active' : ''} ${editing ? 'editing' : ''} ${searchMatch ? 'search-match' : ''} ${activeSearchMatch ? 'search-current' : ''} ${segment.editedAt ? 'edited' : ''}`} onPointerDown={handleSegmentPointerDown}>
      <div className="segment-gutter">
        <div
          className="segment-time-editors"
          aria-label="Segment timestamps"
          title="Click a timestamp to seek"
        >
          <input
            aria-label="Segment start time"
            disabled={savingTiming}
            onBlur={saveTimingDraft}
            onChange={(event) => setStartDraft(event.target.value)}
            onKeyDown={handleTimingKeyDown}
            onPointerDown={(event) => handleTimestampPointerDown(event, segment.startSeconds)}
            title={`Seek to ${formatTime(segment.startSeconds)}`}
            value={startDraft}
          />
          <span>-</span>
          <input
            aria-label="Segment end time"
            disabled={savingTiming}
            onBlur={saveTimingDraft}
            onChange={(event) => setEndDraft(event.target.value)}
            onKeyDown={handleTimingKeyDown}
            onPointerDown={(event) => handleTimestampPointerDown(event, segment.endSeconds)}
            title={`Seek to ${formatTime(segment.endSeconds)}`}
            value={endDraft}
          />
        </div>
        <div className="segment-structure-tools">
          <button
            aria-label="Merge with previous segment"
            disabled={!canMergePrevious || saving}
            onClick={() => runStructureTool(onMergePrevious)}
            onPointerDown={handleStructureToolPointerDown}
            title="Merge with previous"
            type="button"
          >
            <ArrowUpToLine size={13} />
          </button>
          <button
            aria-label="Split segment at cursor"
            disabled={!canSplit || saving}
            onClick={() => runStructureTool(() => onSplit(cursorOffset))}
            onPointerDown={handleStructureToolPointerDown}
            title="Split at cursor"
            type="button"
          >
            <Scissors size={13} />
          </button>
          <button
            aria-label="Merge with next segment"
            disabled={!canMergeNext || saving}
            onClick={() => runStructureTool(onMergeNext)}
            onPointerDown={handleStructureToolPointerDown}
            title="Merge with next"
            type="button"
          >
            <ArrowDownToLine size={13} />
          </button>
        </div>
      </div>
      <div className="segment-edit-stack">
        {editing ? (
          <textarea
            aria-label="Transcript segment text"
            className="segment-text-input"
            onBlur={handleEditBlur}
            onChange={(event) => {
              onDraftChange(event.target.value);
              onCursorOffsetChange(event.target.selectionStart);
            }}
            onClick={syncCursorOffset}
            onFocus={onFocus}
            onKeyDown={handleEditKeyDown}
            onKeyUp={syncCursorOffset}
            onSelect={syncCursorOffset}
            ref={textAreaRef}
            spellCheck
            value={activeText}
          />
        ) : (
          <button
            aria-label="Edit transcript segment text"
            className={active ? 'segment-text-display playback-active' : 'segment-text-display'}
            onClick={onFocus}
            type="button"
          >
            <HighlightedTranscriptText query={searchQuery} text={segment.text} />
          </button>
        )}
        <div className={`segment-save-state ${saving ? 'saving' : ''} ${saveError ? 'error' : ''}`} role="status">
          {saveError ? 'Not saved' : saving ? 'Saving' : segment.editedAt ? 'Edited' : ''}
        </div>
      </div>
    </div>
  );
}
