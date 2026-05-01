import { type Dispatch, type ReactElement, type SetStateAction, useEffect, useMemo, useRef, useState } from 'react';
import type { ExportFormat, ExportTextMode, JobWithSource, TranscriptSegment, TranscriptSegmentListResult } from '@voxmire/contracts';
import { FindReplacePanel } from '../features/transcript/find-replace-panel';
import { TranscriptHeader } from '../features/transcript/transcript-header';
import { findActiveSegmentIndex, preferredActiveSegmentIndexForPlayback, transcriptSubtitle, type PreferredActiveSegment } from '../features/transcript/transcript-selection';
import { TranscriptStage } from '../features/transcript/transcript-stage';
import { TranscriptSwitcherDrawer } from '../features/transcript/transcript-switcher-drawer';
import { useTranscriptHistory } from '../features/transcript/use-transcript-history';
import { useTranscriptSearchReplace } from '../features/transcript/use-transcript-search-replace';
import { ResetTranscriptModal } from '../components/project-dialogs';
import type { TranscriptWorkspaceState } from '../features/transcript/transcript-workspace-state';
import { applyMediaSeek } from '../features/media/media-seek';
import { solverLabelForJob, type SolverLabelsByJobId } from '../lib/engines';
import { buildPlaybackTimingDiagnostic, logPlaybackDiagnostic, logWordTimingDiagnostic, recordPlaybackTimingDiagnostic, usePlaybackDiagnosticsEnabled } from '../features/media/playback-diagnostics';
import { AudioDeck, type PlaybackClockSample } from '../features/media/playback-controls';
import { loadVideoPreviewPreference, saveVideoPreviewPreference, type VideoPreviewDock } from '../features/media/video-preview-preferences';
import { isPlainSpaceKey, isPlaybackShortcutTarget } from '../lib/keyboard';
import { mediaKindFromExtension, type MediaKind } from '../lib/media-kind';

type MediaInfo = {
  contentType: string;
  hasAudio: boolean;
  hasVideo: boolean;
  kind: MediaKind;
};

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
  solverLabelsByJobId: SolverLabelsByJobId;
  setPlaying: (playing: boolean) => void;
  setTranscriptWorkspaceState: Dispatch<SetStateAction<TranscriptWorkspaceState>>;
  transcriptWorkspaceState: TranscriptWorkspaceState;
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
  solverLabelsByJobId,
  setPlaying,
  setTranscriptWorkspaceState,
  transcriptWorkspaceState,
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
  const selectedSolverLabel = selectedJob ? solverLabelForJob(selectedJob, solverLabelsByJobId[selectedJob.job.id]) : null;
  const selectedSubtitle = selectedJob ? transcriptSubtitle(selectedJob, progress, selectedMediaKind, selectedSolverLabel) : 'Choose a project from Library or import a recording.';
  const activeSegmentIndex = useMemo(() => findActiveSegmentIndex(segments, playbackTime), [playbackTime, segments]);
  const preferredActiveSegmentIndex = useMemo(
    () => preferredActiveSegmentIndexForPlayback(segments, playbackTime, preferredActiveSegment),
    [playbackTime, preferredActiveSegment, segments]
  );
  const transcriptActiveSegmentIndex = preferredActiveSegmentIndex >= 0 ? preferredActiveSegmentIndex : activeSegmentIndex;
  const resolvedPlaybackDuration = playbackDuration ?? selectedJob?.sourceFile.durationSeconds ?? null;
  const playbackTimingDiagnostic = useMemo(
    () => diagnosticsEnabled ? buildPlaybackTimingDiagnostic({ activeSegmentIndex, playbackClockSample, playbackTime, segments }) : null,
    [activeSegmentIndex, diagnosticsEnabled, playbackClockSample, playbackTime, segments]
  );
  const {
    applyTranscriptHistory,
    editorResetSignal,
    historyBusy,
    mergeSegmentWithHistory,
    redoLabel,
    rememberTranscriptHistory,
    resetTranscriptOpen,
    resetTranscriptWithHistory,
    resettingTranscript,
    setResetTranscriptOpen,
    splitSegmentWithHistory,
    undoLabel,
    updateSegmentTimingWithHistory,
    updateSegmentWithHistory
  } = useTranscriptHistory({
    mergeSegment,
    replaceSegments,
    resetSegments,
    selectedJobId: selectedJob?.job.id ?? null,
    segments,
    splitSegment,
    updateSegment,
    updateSegmentTiming
  });
  const {
    activeFindIndex,
    activeFindSegment,
    findMatchCount,
    findMatchIndexesCount,
    findPanelOpen,
    findQuery,
    jumpToFindMatch,
    replaceAllTranscriptMatches,
    replacePanelOpen,
    replaceQuery,
    replacingText,
    setFindPanelOpen,
    setFindQuery,
    setReplacePanelOpen,
    setReplaceQuery,
    toggleFindPanel
  } = useTranscriptSearchReplace({
    onSeekSegment: seekToSegment,
    rememberTranscriptHistory,
    segments,
    updateSegment
  });

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
  }, [exportMenuOpen, findPanelOpen, setFindPanelOpen, setReplacePanelOpen, switcherOpen]);

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
        redoLabel={redoLabel}
        resettingTranscript={resettingTranscript}
        selectedJob={selectedJob}
        selectedSubtitle={selectedSubtitle}
        switcherOpen={switcherOpen}
        undoLabel={undoLabel}
      />

      <section className="transcript-layout">
        {switcherOpen ? (
          <TranscriptSwitcherDrawer
            jobs={jobs}
            onClose={() => setSwitcherOpen(false)}
            onDeleteProject={(project) => {
              setSwitcherOpen(false);
              onDeleteProject(project);
            }}
            onDetailsProject={(jobId) => {
              setSwitcherOpen(false);
              onDetailsProject(jobId);
            }}
            onRenameProject={(project) => {
              setSwitcherOpen(false);
              onRenameProject(project);
            }}
            onSelectJob={onSelectJob}
            query={switcherQuery}
            selectedJobId={selectedJob?.job.id ?? null}
            setQuery={setSwitcherQuery}
            solverLabelsByJobId={solverLabelsByJobId}
          />
        ) : null}

        {findPanelOpen ? (
          <FindReplacePanel
            activeFindIndex={activeFindIndex}
            findMatchCount={findMatchCount}
            findMatchIndexesCount={findMatchIndexesCount}
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
            setTranscriptWorkspaceState={setTranscriptWorkspaceState}
            selectedJob={selectedJob}
            selectedMediaKind={selectedMediaKind}
            solverLabel={selectedSolverLabel}
            transcriptWorkspaceState={transcriptWorkspaceState}
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
