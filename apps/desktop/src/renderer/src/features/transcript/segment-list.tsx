import { type Dispatch, type ReactElement, type SetStateAction, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { TranscriptSegment, TranscriptSegmentListResult } from '@voxmire/contracts';
import { EditableSegmentRow } from './editable-segment-row';
import { useSegmentEditor } from './use-segment-editor';
import { getPlaybackWordState, type PlaybackWordState } from './word-timing';
import { debugTranscriptInteraction } from './transcript-interaction-debug';
import type { TranscriptFocusTarget, TranscriptWorkspaceState } from './transcript-workspace-state';

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
  jobId: string | null;
  playbackTime: number;
  resetSignal: number;
  searchQuery: string;
  segments: TranscriptSegment[];
  setWorkspaceState: Dispatch<SetStateAction<TranscriptWorkspaceState>>;
  workspaceState: TranscriptWorkspaceState;
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
  jobId,
  playbackTime,
  resetSignal,
  searchQuery,
  segments,
  setWorkspaceState,
  workspaceState
}: VirtualizedSegmentListProps): ReactElement {
  const scrollParentRef = useRef<HTMLDivElement | null>(null);
  const lastWordDiagnosticKeyRef = useRef('');
  const suppressActiveScrollCountRef = useRef(0);
  const explicitSegmentSelectionRef = useRef(false);
  const restoredWorkspaceJobIdRef = useRef<string | null>(null);
  const scrollPersistFrameRef = useRef<number | null>(null);
  const latestScrollTopRef = useRef(0);
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

  function escapeAttributeValue(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }

  function focusTargetSelector(segmentId: string, focusTarget: TranscriptFocusTarget): string {
    return `[data-segment-id="${escapeAttributeValue(segmentId)}"][data-transcript-focus-target="${focusTarget}"]`;
  }

  function suppressActiveScroll(count = 1): void {
    suppressActiveScrollCountRef.current = Math.max(suppressActiveScrollCountRef.current, count);
  }

  function currentScrollTop(): number {
    return scrollParentRef.current?.scrollTop ?? latestScrollTopRef.current;
  }

  function persistWorkspaceState(patch: Partial<TranscriptWorkspaceState>): void {
    if (!jobId) {
      return;
    }

    setWorkspaceState((current) => ({
      ...current,
      jobId,
      scrollTop: patch.scrollTop ?? currentScrollTop(),
      ...patch
    }));
  }

  function getFirstVisibleSegment(): TranscriptSegment | null {
    const scrollElement = scrollParentRef.current;
    if (!scrollElement) {
      return null;
    }

    const scrollRect = scrollElement.getBoundingClientRect();
    const visibleRow = Array.from(scrollElement.querySelectorAll<HTMLElement>('.segment-virtual-row'))
      .find((rowElement) => rowElement.getBoundingClientRect().bottom >= scrollRect.top + 8);
    const visibleSegmentId = visibleRow
      ?.querySelector<HTMLElement>('[data-segment-id]')
      ?.dataset.segmentId;

    if (visibleSegmentId) {
      return segments.find((segment) => segment.id === visibleSegmentId) ?? null;
    }

    const visibleItem = rowVirtualizer.getVirtualItems()
      .find((virtualItem) => virtualItem.end >= latestScrollTopRef.current)
      ?? rowVirtualizer.getVirtualItems()[0];
    return visibleItem ? segments[visibleItem.index] ?? null : null;
  }

  function hasActiveTranscriptTarget(): boolean {
    return document.activeElement instanceof Element && Boolean(document.activeElement.closest('[data-transcript-focus-target]'));
  }

  function persistScrollTop(scrollTop: number): void {
    latestScrollTopRef.current = scrollTop;
    if (scrollPersistFrameRef.current !== null) {
      return;
    }

    scrollPersistFrameRef.current = window.requestAnimationFrame(() => {
      scrollPersistFrameRef.current = null;
      const patch: Partial<TranscriptWorkspaceState> = { scrollTop: latestScrollTopRef.current };

      if (!hasActiveTranscriptTarget()) {
        const visibleSegment = getFirstVisibleSegment();
        if (visibleSegment) {
          patch.focusTarget = null;
          patch.segmentId = visibleSegment.id;
        }
      }

      persistWorkspaceState(patch);
    });
  }

  function rememberSegmentFocus(segment: TranscriptSegment, focusTarget: TranscriptFocusTarget): void {
    persistWorkspaceState({ focusTarget, scrollTop: currentScrollTop(), segmentId: segment.id });
  }

  useEffect(() => {
    const scrollElement = scrollParentRef.current;
    if (!scrollElement) {
      return;
    }

    const scrollContainer = scrollElement;
    function handleNativeScroll(): void {
      persistScrollTop(scrollContainer.scrollTop);
    }

    scrollContainer.addEventListener('scroll', handleNativeScroll, { passive: true });
    return () => {
      scrollContainer.removeEventListener('scroll', handleNativeScroll);
    };
  }, [jobId, rowVirtualizer, segments]);

  useEffect(() => {
    return () => {
      if (scrollPersistFrameRef.current !== null) {
        window.cancelAnimationFrame(scrollPersistFrameRef.current);
        scrollPersistFrameRef.current = null;
      }

      const scrollElement = scrollParentRef.current;
      if (scrollElement && jobId) {
        const visibleSegment = hasActiveTranscriptTarget() ? null : getFirstVisibleSegment();
        setWorkspaceState((current) => ({
          ...current,
          jobId,
          scrollTop: scrollElement.scrollTop,
          ...(visibleSegment ? { focusTarget: null, segmentId: visibleSegment.id } : {})
        }));
      }
    };
  }, [jobId, setWorkspaceState]);

  useLayoutEffect(() => {
    const scrollElement = scrollParentRef.current;
    if (
      !scrollElement ||
      !jobId ||
      workspaceState.jobId !== jobId ||
      segments.length === 0 ||
      restoredWorkspaceJobIdRef.current === jobId
    ) {
      return;
    }

    restoredWorkspaceJobIdRef.current = jobId;
    suppressActiveScroll(2);

    const segmentIndex = workspaceState.segmentId
      ? segments.findIndex((segment) => segment.id === workspaceState.segmentId)
      : -1;
    const segment = segmentIndex >= 0 ? segments[segmentIndex] : null;
    const restoredScrollTop = Math.max(0, workspaceState.scrollTop);


    if (segmentIndex >= 0) {
      rowVirtualizer.scrollToIndex(segmentIndex, { align: workspaceState.focusTarget ? 'center' : 'start' });
    } else if (restoredScrollTop > 0) {
      scrollElement.scrollTop = restoredScrollTop;
    }

    if (workspaceState.focusTarget === 'text' && segment) {
      editor.startEditing(segment, { seek: false });
    } else if (workspaceState.focusTarget && segment) {
      setTimingEditSegmentId(segment.id);
    }

    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        if (segmentIndex >= 0) {
          rowVirtualizer.scrollToIndex(segmentIndex, { align: workspaceState.focusTarget ? 'center' : 'start' });
        } else if (restoredScrollTop > 0) {
          scrollElement.scrollTop = restoredScrollTop;
        }

        if (!workspaceState.segmentId || !workspaceState.focusTarget) {
          return;
        }

        const target = scrollElement.querySelector<HTMLElement>(
          focusTargetSelector(workspaceState.segmentId, workspaceState.focusTarget)
        );
        if (target) {
          target.focus({ preventScroll: true });
        } else if (segmentIndex >= 0) {
          rowVirtualizer.scrollToIndex(segmentIndex, { align: 'center' });
          window.requestAnimationFrame(() => {
            const retryTarget = scrollElement.querySelector<HTMLElement>(
              focusTargetSelector(workspaceState.segmentId!, workspaceState.focusTarget!)
            );
            retryTarget?.focus({ preventScroll: true });
          });
        }
      });
    });
  }, [jobId, rowVirtualizer, segments, workspaceState.focusTarget, workspaceState.jobId, workspaceState.scrollTop, workspaceState.segmentId]);

  useLayoutEffect(() => {
    if (activeSegmentIndex >= 0 && !editor.editingSegmentId && !timingEditSegmentId) {
      if (suppressActiveScrollCountRef.current > 0) {
        suppressActiveScrollCountRef.current -= 1;
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
    suppressActiveScroll(2);
    setTimingEditSegmentId(segmentId);
  }

  function endTimingEdit(segmentId: string): void {
    if (!explicitSegmentSelectionRef.current) {
      suppressActiveScroll(2);
    }
    setTimingEditSegmentId((current) => (current === segmentId ? null : current));
  }

  function selectSegment(segment: TranscriptSegment): void {
    explicitSegmentSelectionRef.current = true;
    suppressActiveScrollCountRef.current = 0;
    setTimingEditSegmentId(null);
    persistWorkspaceState({ focusTarget: null, scrollTop: currentScrollTop(), segmentId: segment.id });
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
                onFocusTargetChange={(focusTarget) => rememberSegmentFocus(segment, focusTarget)}
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