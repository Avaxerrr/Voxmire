import { type ReactElement, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { TranscriptSegment, TranscriptSegmentListResult } from '@voxmire/contracts';
import { EditableSegmentRow } from './editable-segment-row';
import { useSegmentEditor } from './use-segment-editor';
import { getPlaybackWordState, type PlaybackWordState } from './word-timing';
import { debugTranscriptInteraction } from './transcript-interaction-debug';

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
  const scrollParentRef = useRef<HTMLDivElement | null>(null);
  const lastWordDiagnosticKeyRef = useRef('');
  const suppressNextActiveScrollRef = useRef(false);
  const explicitSegmentSelectionRef = useRef(false);
  const [timingEditSegmentId, setTimingEditSegmentId] = useState<string | null>(null);
  const rowVirtualizer = useVirtualizer({
    count: segments.length,
    estimateSize: () => 108,
    getItemKey: (index) => segments[index]?.id ?? index,
    getScrollElement: () => scrollParentRef.current,
    overscan: 8
  });
  const editor = useSegmentEditor({
    onMergeSegment,
    onSeek,
    onSplitSegment,
    onUpdateSegment,
    onUpdateTiming,
    resetSignal,
    scrollToIndex: (index) => rowVirtualizer.scrollToIndex(index, { align: 'center' }),
    segments
  });

  useLayoutEffect(() => {
    if (activeSegmentIndex >= 0 && !editor.editingSegmentId && !timingEditSegmentId) {
      if (suppressNextActiveScrollRef.current) {
        suppressNextActiveScrollRef.current = false;
        return;
      }
      const scrollElement = scrollParentRef.current;
      debugTranscriptInteraction('active-scroll-center', {
        activeSegmentIndex,
        beforeScrollTop: scrollElement?.scrollTop ?? null
      });
      rowVirtualizer.scrollToIndex(activeSegmentIndex, { align: 'center' });
      window.requestAnimationFrame(() => {
        debugTranscriptInteraction('active-scroll-center-after-paint', {
          activeSegmentIndex,
          afterScrollTop: scrollElement?.scrollTop ?? null
        });
      });
    }
  }, [activeSegmentIndex, editor.editingSegmentId, timingEditSegmentId]);

  function startTimingEdit(segmentId: string): void {
    suppressNextActiveScrollRef.current = true;
    setTimingEditSegmentId(segmentId);
  }

  function endTimingEdit(segmentId: string): void {
    if (!explicitSegmentSelectionRef.current) {
      suppressNextActiveScrollRef.current = true;
    }
    setTimingEditSegmentId((current) => (current === segmentId ? null : current));
  }

  function selectSegment(segment: TranscriptSegment): void {
    explicitSegmentSelectionRef.current = true;
    suppressNextActiveScrollRef.current = false;
    setTimingEditSegmentId(null);
    onSeek(segment);
    window.setTimeout(() => {
      explicitSegmentSelectionRef.current = false;
    }, 0);
  }

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

  return (
    <div className="segment-list virtualized" ref={scrollParentRef}>
      <div className="segment-list-inner" style={{ height: `${rowVirtualizer.getTotalSize()}px` }}>
        {rowVirtualizer.getVirtualItems().map((virtualRow) => {
          const segment = segments[virtualRow.index];
          if (!segment) {
            return null;
          }

          const active = virtualRow.index === activeSegmentIndex;
          const editing = segment.id === editor.editingSegmentId;
          const saving = segment.id === editor.savingSegmentId;
          const savingTiming = segment.id === editor.savingTimingSegmentId;
          const saveError = segment.id === editor.saveErrorSegmentId;
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
                cursorOffset={editor.cursorOffset}
                draftText={editor.draftText}
                editing={editing}
                onCancel={editor.cancelEditing}
                onDraftChange={editor.setDraftText}
                onCursorOffsetChange={editor.setCursorOffset}
                onFocus={() => editor.startEditing(segment)}
                onMergeNext={() => editor.mergeSegment(segment, 'next', virtualRow.index)}
                onMergePrevious={() => editor.mergeSegment(segment, 'previous', virtualRow.index)}
                onSave={(nextText) => editor.saveSegmentText(segment, nextText)}
                onSeekTime={onSeekTime}
                onSaveAndClose={(nextText) => editor.saveAndClose(segment, nextText)}
                onSaveAndMoveNext={(nextText) => editor.saveAndMoveToNext(segment, nextText, virtualRow.index)}
                onSaveAndMovePrevious={(nextText) => editor.saveAndMoveToPrevious(segment, nextText, virtualRow.index)}
                onSaveTiming={(startSeconds, endSeconds) => editor.saveSegmentTiming(segment, startSeconds, endSeconds)}
                onSelectSegment={() => selectSegment(segment)}
                onSplit={(offset) => editor.splitSegment(segment, offset, virtualRow.index)}
                onTimingEditEnd={() => endTimingEdit(segment.id)}
                onTimingEditStart={() => startTimingEdit(segment.id)}
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