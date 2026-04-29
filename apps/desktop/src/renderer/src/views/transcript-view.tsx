import { type ReactElement, useEffect, useMemo, useRef, useState } from 'react';
import type { ExportFormat, ExportTextMode, JobWithSource, TranscriptSegment, TranscriptSegmentListResult } from '@voxmire/contracts';
import { FindReplacePanel } from '../features/transcript/find-replace-panel';
import { TranscriptHeader } from '../features/transcript/transcript-header';
import { findActiveSegmentIndex, preferredActiveSegmentIndexForPlayback, transcriptSubtitle, type PreferredActiveSegment } from '../features/transcript/transcript-selection';
import { TranscriptStage } from '../features/transcript/transcript-stage';
import { TranscriptSwitcherDrawer } from '../features/transcript/transcript-switcher-drawer';
import { ResetTranscriptModal } from '../components/project-dialogs';
import { applyMediaSeek } from '../features/media/media-seek';
import { buildPlaybackTimingDiagnostic, logPlaybackDiagnostic, logWordTimingDiagnostic, recordPlaybackTimingDiagnostic, usePlaybackDiagnosticsEnabled } from '../features/media/playback-diagnostics';
import { AudioDeck, type PlaybackClockSample } from '../features/media/playback-controls';
import { loadVideoPreviewPreference, saveVideoPreviewPreference, type VideoPreviewDock } from '../features/media/video-preview-preferences';
import { exportResultLabel } from '../lib/format';
import { isEditableHistoryShortcutTarget, isPlainSpaceKey, isPlaybackShortcutTarget } from '../lib/keyboard';
import { mediaKindFromExtension, type MediaKind } from '../lib/media-kind';
import { countTranscriptMatches, escapeRegExp, findTranscriptMatchIndexes } from '../lib/transcript-search';
import { replaceSegmentInTranscriptSnapshot, transcriptSegmentsEqual, type TranscriptHistoryEntry } from '../lib/transcript-history';

type MediaInfo = {
  contentType: string;
  hasAudio: boolean;
  hasVideo: boolean;
  kind: MediaKind;
};


const transcriptHistoryLimit = 20;

type TranscriptViewProps = {
  busy: boolean;
  exportTranscript: (format: ExportFormat, textMode?: ExportTextMode) => Promise<void>;
  jobs: JobWithSource[];
  onCancel: (jobId: string) => Promise<void>;
  onBrowseLibrary: () => void;
  onDeleteProject: (project: JobWithSource) => void;
  onDetailsProject: (jobId: string) => void;
  onImport: () => void;
  onPause: (jobId: string) => Promise<void>;
  onRenameProject: (project: JobWithSource) => void;
  onResume: (jobId: string) => Promise<void>;
  onSelectJob: (jobId: string) => void;
  playing: boolean;
  selectedJob: JobWithSource | null;
  segments: TranscriptSegment[];
  setPlaying: (playing: boolean) => void;
  splitSegment: (segmentId: string, offset: number) => Promise<TranscriptSegment[] | null>;
  mergeSegment: (segmentId: string, direction: 'previous' | 'next') => Promise<TranscriptSegment[] | null>;
  replaceSegments: (segments: TranscriptSegment[]) => Promise<TranscriptSegment[] | null>;
  resetSegments: () => Promise<TranscriptSegmentListResult | null>;
  updateSegmentTiming: (segmentId: string, startSeconds: number, endSeconds: number) => Promise<TranscriptSegmentListResult | null>;
  updateSegment: (segmentId: string, text: string) => Promise<TranscriptSegment | null>;
};

export function TranscriptView({
  busy,
  exportTranscript,
  jobs,
  onCancel,
  onBrowseLibrary,
  onDeleteProject,
  onDetailsProject,
  onImport,
  onPause,
  onRenameProject,
  onResume,
  onSelectJob,
  playing,
  selectedJob,
  segments,
  setPlaying,
  splitSegment,
  mergeSegment,
  replaceSegments,
  resetSegments,
  updateSegmentTiming,
  updateSegment,
}: TranscriptViewProps): ReactElement {
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [switcherQuery, setSwitcherQuery] = useState('');
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [findPanelOpen, setFindPanelOpen] = useState(false);
  const [findQuery, setFindQuery] = useState('');
  const [replacePanelOpen, setReplacePanelOpen] = useState(false);
  const [replaceQuery, setReplaceQuery] = useState('');
  const [activeFindIndex, setActiveFindIndex] = useState(0);
  const [replacingText, setReplacingText] = useState(false);
  const [resetTranscriptOpen, setResetTranscriptOpen] = useState(false);
  const [resettingTranscript, setResettingTranscript] = useState(false);
  const [undoStack, setUndoStack] = useState<TranscriptHistoryEntry[]>([]);
  const [redoStack, setRedoStack] = useState<TranscriptHistoryEntry[]>([]);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [editorResetSignal, setEditorResetSignal] = useState(0);
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [mediaInfo, setMediaInfo] = useState<MediaInfo | null>(null);
  const [playbackTime, setPlaybackTime] = useState(0);
  const [playbackClockSample, setPlaybackClockSample] = useState<PlaybackClockSample | null>(null);
  const [playbackDuration, setPlaybackDuration] = useState<number | null>(null);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [externalSeekSignal, setExternalSeekSignal] = useState(0);
  const [preferredActiveSegment, setPreferredActiveSegment] = useState<PreferredActiveSegment | null>(null);
  const [videoPreviewHidden, setVideoPreviewHidden] = useState(() => loadVideoPreviewPreference().hidden);
  const [videoPreviewDock, setVideoPreviewDock] = useState<VideoPreviewDock>(() => loadVideoPreviewPreference().dock);
  const [videoPreviewWidth, setVideoPreviewWidth] = useState(() => loadVideoPreviewPreference().width);
  const [viewportSize, setViewportSize] = useState(() => ({ height: window.innerHeight, width: window.innerWidth }));
  const [waveformPeaks, setWaveformPeaks] = useState<number[]>([]);
  const [waveformLoading, setWaveformLoading] = useState(false);
  const exportMenuRef = useRef<HTMLDivElement | null>(null);
  const audioRef = useRef<HTMLMediaElement | null>(null);
  const mediaApi = window.voxmire?.media;
  const diagnosticsEnabled = usePlaybackDiagnosticsEnabled();
  const progress = selectedJob ? Math.round(selectedJob.job.progress * 100) : 0;
  const selectedMediaKind = selectedJob ? mediaInfo?.kind ?? mediaKindFromExtension(selectedJob.sourceFile.extension) : 'audio';
  const selectedSubtitle = selectedJob ? transcriptSubtitle(selectedJob, progress, selectedMediaKind) : 'Choose a project from Library or import a recording.';
  const activeSegmentIndex = useMemo(() => findActiveSegmentIndex(segments, playbackTime), [playbackTime, segments]);
  const preferredActiveSegmentIndex = useMemo(
    () => preferredActiveSegmentIndexForPlayback(segments, playbackTime, preferredActiveSegment),
    [playbackTime, preferredActiveSegment, segments]
  );
  const transcriptActiveSegmentIndex = preferredActiveSegmentIndex >= 0 ? preferredActiveSegmentIndex : activeSegmentIndex;
  const resolvedPlaybackDuration = playbackDuration ?? selectedJob?.sourceFile.durationSeconds ?? null;
  const findMatchCount = useMemo(() => countTranscriptMatches(segments, findQuery), [findQuery, segments]);
  const findMatchIndexes = useMemo(() => findTranscriptMatchIndexes(segments, findQuery), [findQuery, segments]);
  const activeFindSegment = findMatchIndexes.length > 0 ? segments[findMatchIndexes[Math.min(activeFindIndex, findMatchIndexes.length - 1)] ?? -1] ?? null : null;
  const playbackTimingDiagnostic = useMemo(
    () => diagnosticsEnabled ? buildPlaybackTimingDiagnostic({ activeSegmentIndex, playbackClockSample, playbackTime, segments }) : null,
    [activeSegmentIndex, diagnosticsEnabled, playbackClockSample, playbackTime, segments]
  );

  useEffect(() => {
    setActiveFindIndex(0);
  }, [findQuery]);

  useEffect(() => {
    setUndoStack([]);
    setRedoStack([]);
    setEditorResetSignal((value) => value + 1);
  }, [selectedJob?.job.id]);

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
  }, [historyBusy, redoStack, selectedJob?.job.id, undoStack]);

  useEffect(() => {
    function handlePlaybackKeyDown(event: KeyboardEvent): void {
      if (
        event.defaultPrevented ||
        event.repeat ||
        !isPlainSpaceKey(event) ||
        isPlaybackShortcutTarget(event.target) ||
        resetTranscriptOpen ||
        switcherOpen ||
        exportMenuOpen ||
        !selectedJob ||
        !mediaUrl ||
        mediaError
      ) {
        return;
      }

      event.preventDefault();
      setPlaying(!playing);
    }

    window.addEventListener('keydown', handlePlaybackKeyDown);
    return () => window.removeEventListener('keydown', handlePlaybackKeyDown);
  }, [exportMenuOpen, mediaError, mediaUrl, playing, resetTranscriptOpen, selectedJob, setPlaying, switcherOpen]);

  useEffect(() => {
    if (preferredActiveSegment && preferredActiveSegmentIndex < 0) {
      setPreferredActiveSegment(null);
    }
  }, [preferredActiveSegment, preferredActiveSegmentIndex]);

  useEffect(() => {
    if (playbackTimingDiagnostic) {
      recordPlaybackTimingDiagnostic(playbackTimingDiagnostic);
    }
  }, [playbackTimingDiagnostic]);

  useEffect(() => {
    if (!switcherOpen && !exportMenuOpen && !findPanelOpen) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        setSwitcherOpen(false);
        setExportMenuOpen(false);
        setFindPanelOpen(false);
        setReplacePanelOpen(false);
      }
    }

    function handlePointerDown(event: MouseEvent): void {
      if (exportMenuRef.current && !exportMenuRef.current.contains(event.target as Node)) {
        setExportMenuOpen(false);
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('mousedown', handlePointerDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('mousedown', handlePointerDown);
    };
  }, [exportMenuOpen, findPanelOpen, switcherOpen]);

  useEffect(() => {
    function handleResize(): void {
      setViewportSize({ height: window.innerHeight, width: window.innerWidth });
    }

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    saveVideoPreviewPreference({ dock: videoPreviewDock, hidden: videoPreviewHidden, width: videoPreviewWidth });
  }, [videoPreviewDock, videoPreviewHidden, videoPreviewWidth]);

  useEffect(() => {
    let canceled = false;

    setPlaying(false);
    setPlaybackTime(0);
    setPreferredActiveSegment(null);
    setPlaybackClockSample(null);
    setPlaybackDuration(null);
    setMediaError(null);
    setMediaInfo(null);
    setWaveformPeaks([]);
    setWaveformLoading(false);

    if (!selectedJob) {
      setMediaUrl(null);
      return () => {
        canceled = true;
      };
    }

    if (!mediaApi) {
      setMediaUrl(null);
      setMediaError('Media playback is available in the desktop app.');
      return () => {
        canceled = true;
      };
    }

    void mediaApi.getInfo(selectedJob.job.id)
      .then((info) => {
        if (!canceled) {
          setMediaInfo(info);
        }
      })
      .catch(() => {
        if (!canceled) {
          setMediaInfo(null);
        }
      });

    void mediaApi.getSourceUrl(selectedJob.job.id)
      .then((url) => {
        if (canceled) {
          return;
        }

        setMediaUrl(url);
        if (!url) {
          setMediaError('Original media source is unavailable.');
        }
      })
      .catch(() => {
        if (!canceled) {
          setMediaUrl(null);
          setMediaError('Media source could not be prepared.');
        }
      });

    setWaveformLoading(true);
    void mediaApi.getWaveform(selectedJob.job.id)
      .then((waveform) => {
        if (canceled) {
          return;
        }

        setWaveformPeaks(waveform?.peaks ?? []);
        setPlaybackDuration(waveform?.durationSeconds ?? null);
      })
      .catch(() => {
        if (!canceled) {
          setWaveformPeaks([]);
        }
      })
      .finally(() => {
        if (!canceled) {
          setWaveformLoading(false);
        }
      });

    return () => {
      canceled = true;
    };
  }, [mediaApi, selectedJob?.job.id, setPlaying]);

  function rememberTranscriptHistory(label: string, before: TranscriptSegment[], after: TranscriptSegment[]): void {
    if (transcriptSegmentsEqual(before, after)) {
      return;
    }

    setUndoStack((current) => [
      ...current.slice(Math.max(0, current.length - transcriptHistoryLimit + 1)),
      { after, before, label }
    ]);
    setRedoStack([]);
  }

  async function applyTranscriptHistory(direction: 'undo' | 'redo'): Promise<void> {
    if (historyBusy || !selectedJob) {
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
  }

  async function updateSegmentWithHistory(segmentId: string, text: string): Promise<TranscriptSegment | null> {
    const before = segments;
    const updated = await updateSegment(segmentId, text);
    if (updated) {
      rememberTranscriptHistory('Edit text', before, replaceSegmentInTranscriptSnapshot(before, updated));
    }

    return updated;
  }

  async function updateSegmentTimingWithHistory(
    segmentId: string,
    startSeconds: number,
    endSeconds: number
  ): Promise<TranscriptSegmentListResult | null> {
    const before = segments;
    const result = await updateSegmentTiming(segmentId, startSeconds, endSeconds);
    if (result && !result.error) {
      rememberTranscriptHistory('Edit timing', before, result.segments);
    }

    return result;
  }

  async function splitSegmentWithHistory(segmentId: string, offset: number): Promise<TranscriptSegment[] | null> {
    const before = segments;
    const updatedSegments = await splitSegment(segmentId, offset);
    if (updatedSegments) {
      rememberTranscriptHistory('Split segment', before, updatedSegments);
    }

    return updatedSegments;
  }

  async function mergeSegmentWithHistory(segmentId: string, direction: 'previous' | 'next'): Promise<TranscriptSegment[] | null> {
    const before = segments;
    const updatedSegments = await mergeSegment(segmentId, direction);
    if (updatedSegments) {
      rememberTranscriptHistory('Merge segments', before, updatedSegments);
    }

    return updatedSegments;
  }

  async function resetTranscriptWithHistory(): Promise<void> {
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
  }

  function seekToTime(seconds: number, preferredSegmentId: string | null = null): void {
    const nextTime = Math.max(0, seconds);
    const audio = audioRef.current;

    setPreferredActiveSegment(preferredSegmentId ? { segmentId: preferredSegmentId, timeSeconds: nextTime } : null);
    setPlaybackTime(nextTime);
    setExternalSeekSignal((value) => value + 1);
    if (audio) {
      applyMediaSeek(audio, nextTime, false);
    }
  }

  function seekToSegment(segment: TranscriptSegment): void {
    seekToTime(segment.startSeconds);
  }

  function seekToAdjacentSegment(direction: 'previous' | 'next'): void {
    const nextIndex = transcriptActiveSegmentIndex < 0
      ? (direction === 'next' ? 0 : -1)
      : transcriptActiveSegmentIndex + (direction === 'next' ? 1 : -1);
    const segment = segments[nextIndex];
    if (segment) {
      seekToSegment(segment);
    }
  }

  function jumpToFindMatch(direction: 'previous' | 'next'): void {
    if (findMatchIndexes.length === 0) {
      return;
    }

    const nextIndex =
      direction === 'next'
        ? (activeFindIndex + 1) % findMatchIndexes.length
        : (activeFindIndex - 1 + findMatchIndexes.length) % findMatchIndexes.length;
    const segment = segments[findMatchIndexes[nextIndex] ?? -1];
    setActiveFindIndex(nextIndex);
    if (segment) {
      seekToSegment(segment);
    }
  }

  function toggleFindPanel(): void {
    if (findPanelOpen) {
      setReplacePanelOpen(false);
    }

    setFindPanelOpen((open) => !open);
  }

  async function replaceAllTranscriptMatches(): Promise<void> {
    const query = findQuery.trim();
    if (!query || replacingText) {
      return;
    }

    const matcher = new RegExp(escapeRegExp(query), 'gi');
    const matchingSegments = segments.filter((segment) => {
      matcher.lastIndex = 0;
      return matcher.test(segment.text);
    });
    if (matchingSegments.length === 0) {
      return;
    }

    const before = segments;
    let nextSegments = segments;
    setReplacingText(true);
    try {
      for (const segment of matchingSegments) {
        const currentSegment = nextSegments.find((candidate) => candidate.id === segment.id) ?? segment;
        matcher.lastIndex = 0;
        const nextText = currentSegment.text.replace(matcher, replaceQuery);
        if (nextText !== currentSegment.text) {
          const updated = await updateSegment(currentSegment.id, nextText);
          if (updated) {
            nextSegments = replaceSegmentInTranscriptSnapshot(nextSegments, updated);
          }
        }
      }

      rememberTranscriptHistory('Replace all', before, nextSegments);
    } finally {
      setReplacingText(false);
    }
  }

  return (
    <div className="view workspace-page transcript-view">
      <TranscriptHeader
        busy={busy}
        exportMenuOpen={exportMenuOpen}
        exportMenuRef={exportMenuRef}
        findPanelOpen={findPanelOpen}
        hasSegments={segments.length > 0}
        historyBusy={historyBusy}
        jobCount={jobs.length}
        onDeleteProject={() => selectedJob ? onDeleteProject(selectedJob) : undefined}
        onDetailsProject={() => selectedJob ? onDetailsProject(selectedJob.job.id) : undefined}
        onImport={onImport}
        onRedo={() => void applyTranscriptHistory('redo')}
        onRenameProject={() => selectedJob ? onRenameProject(selectedJob) : undefined}
        onResetTranscript={() => setResetTranscriptOpen(true)}
        onSelectExportOption={(format, textMode) => {
          setExportMenuOpen(false);
          void exportTranscript(format, textMode);
        }}
        onToggleExportMenu={() => setExportMenuOpen((open) => !open)}
        onToggleFindPanel={toggleFindPanel}
        onToggleSwitcher={() => setSwitcherOpen((open) => !open)}
        onUndo={() => void applyTranscriptHistory('undo')}
        redoLabel={redoStack[redoStack.length - 1]?.label ?? null}
        resettingTranscript={resettingTranscript}
        selectedJob={selectedJob}
        selectedSubtitle={selectedSubtitle}
        switcherOpen={switcherOpen}
        undoLabel={undoStack[undoStack.length - 1]?.label ?? null}
      />

      <section className="transcript-layout">
        {switcherOpen ? (
          <TranscriptSwitcherDrawer
            jobs={jobs}
            onClose={() => setSwitcherOpen(false)}
            onSelectJob={onSelectJob}
            query={switcherQuery}
            selectedJobId={selectedJob?.job.id ?? null}
            setQuery={setSwitcherQuery}
          />
        ) : null}

        {findPanelOpen ? (
          <FindReplacePanel
            activeFindIndex={activeFindIndex}
            findMatchCount={findMatchCount}
            findMatchIndexesCount={findMatchIndexes.length}
            findQuery={findQuery}
            onFindQueryChange={setFindQuery}
            onJumpMatch={jumpToFindMatch}
            onReplaceAll={() => void replaceAllTranscriptMatches()}
            onReplaceQueryChange={setReplaceQuery}
            onToggleReplacePanel={() => setReplacePanelOpen((open) => !open)}
            replacePanelOpen={replacePanelOpen}
            replaceQuery={replaceQuery}
            replacingText={replacingText}
          />
        ) : null}

        <div className="transcript-main">
          <TranscriptStage
            activeSearchSegmentId={activeFindSegment?.id ?? null}
            activeSegmentIndex={transcriptActiveSegmentIndex}
            busy={busy}
            diagnosticsEnabled={diagnosticsEnabled}
            duration={resolvedPlaybackDuration}
            mediaRef={audioRef}
            mediaUrl={mediaUrl}
            onBrowseLibrary={onBrowseLibrary}
            onCancel={onCancel}
            onImport={onImport}
            onMediaDiagnostic={logPlaybackDiagnostic}
            onMergeSegment={mergeSegmentWithHistory}
            onPause={onPause}
            onResume={onResume}
            onSeek={seekToSegment}
            onSeekTime={seekToTime}
            onSplitSegment={splitSegmentWithHistory}
            onUpdateSegment={updateSegmentWithHistory}
            onUpdateTiming={updateSegmentTimingWithHistory}
            onVideoDurationChange={setPlaybackDuration}
            onVideoError={setMediaError}
            onVideoTimeChange={setPlaybackTime}
            onVideoWidthChange={setVideoPreviewWidth}
            onWordTimingDiagnostic={logWordTimingDiagnostic}
            playbackSpeed={playbackSpeed}
            playbackTime={playbackTime}
            playing={playing}
            progress={progress}
            resetSignal={editorResetSignal}
            searchQuery={findQuery}
            selectedJob={selectedJob}
            selectedMediaKind={selectedMediaKind}
            segments={segments}
            setPlaying={setPlaying}
            setVideoPreviewDock={setVideoPreviewDock}
            setVideoPreviewHidden={setVideoPreviewHidden}
            videoPreviewDock={videoPreviewDock}
            videoPreviewHidden={videoPreviewHidden}
            videoPreviewWidth={videoPreviewWidth}
            viewportHeight={viewportSize.height}
            viewportWidth={viewportSize.width}
          />

          <AudioDeck
            audioRef={audioRef}
            currentTime={playbackTime}
            disabled={!selectedJob}
            duration={resolvedPlaybackDuration}
            externalSeekSignal={externalSeekSignal}
            mediaError={mediaError}
            diagnosticsEnabled={diagnosticsEnabled}
            mediaKind={selectedMediaKind}
            mediaUrl={mediaUrl}
            onClockSample={setPlaybackClockSample}
            onDurationChange={setPlaybackDuration}
            onError={setMediaError}
            onMediaDiagnostic={logPlaybackDiagnostic}
            onNextSegment={() => seekToAdjacentSegment('next')}
            onPreviousSegment={() => seekToAdjacentSegment('previous')}
            onTimeChange={setPlaybackTime}
            playbackSpeed={playbackSpeed}
            playing={playing}
            setPlaybackSpeed={setPlaybackSpeed}
            waveformLoading={waveformLoading}
            waveformPeaks={waveformPeaks}
            canGoNextSegment={segments.length > 0 && transcriptActiveSegmentIndex < segments.length - 1}
            canGoPreviousSegment={transcriptActiveSegmentIndex > 0}
            setPlaying={setPlaying}
          />
        </div>
      </section>

      {resetTranscriptOpen && selectedJob ? (
        <ResetTranscriptModal
          busy={resettingTranscript}
          onClose={() => setResetTranscriptOpen(false)}
          onReset={resetTranscriptWithHistory}
          project={selectedJob}
        />
      ) : null}
    </div>
  );
}
