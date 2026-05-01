import {
  type FocusEvent as ReactFocusEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
  useEffect,
  useRef,
  useState
} from 'react';
import { ArrowDownToLine, ArrowUpToLine, Scissors } from 'lucide-react';
import type { TranscriptSegment } from '@voxmire/contracts';
import { formatEditableTime, formatTime, parseEditableTime } from '../../lib/format';
import { HighlightedTranscriptText } from './highlighted-transcript-text';

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

export function EditableSegmentRow({
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
    <div className={`segment-row ${active ? 'active' : ''} ${editing ? 'editing' : ''} ${searchMatch ? 'search-match' : ''} ${activeSearchMatch ? 'search-current' : ''}`} onPointerDown={handleSegmentPointerDown}>
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
        {saveError || saving ? (
          <div className={`segment-save-state ${saving ? 'saving' : ''} ${saveError ? 'error' : ''}`} role="status">
            {saveError ? 'Not saved' : 'Saving'}
          </div>
        ) : null}
      </div>
    </div>
  );
}