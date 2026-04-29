import { type MutableRefObject, type ReactElement } from 'react';
import { FileText, FolderOpen, Plus, Video } from 'lucide-react';
import type { JobWithSource, TranscriptSegment, TranscriptSegmentListResult } from '@voxmire/contracts';
import { EmptyState } from '../../components/empty-state';
import { VideoPreview } from '../media/video-preview';
import { type VideoPreviewDock } from '../media/video-preview-preferences';
import { type MediaKind } from '../../lib/media-kind';
import { VirtualizedSegmentList } from './segment-list';
import { TranscriptJobStatus } from './transcript-job-status';
import { type PlaybackWordState } from './word-timing';

type WordTimingDiagnosticDetails = {
  activeSegmentIndex: number;
  playbackTime: number;
  segment: TranscriptSegment | undefined;
  wordState: PlaybackWordState | null;
};

type TranscriptStageProps = {
  activeSearchSegmentId: string | null;
  activeSegmentIndex: number;
  busy: boolean;
  diagnosticsEnabled: boolean;
  duration: number | null;
  mediaRef: MutableRefObject<HTMLMediaElement | null>;
  mediaUrl: string | null;
  onBrowseLibrary: () => void;
  onCancel: (jobId: string) => Promise<void>;
  onImport: () => void;
  onMediaDiagnostic: (eventName: string, media: HTMLMediaElement) => void;
  onMergeSegment: (segmentId: string, direction: 'previous' | 'next') => Promise<TranscriptSegment[] | null>;
  onPause: (jobId: string) => Promise<void>;
  onResume: (jobId: string) => Promise<void>;
  onSeek: (segment: TranscriptSegment) => void;
  onSeekTime: (seconds: number, preferredSegmentId?: string) => void;
  onSplitSegment: (segmentId: string, offset: number) => Promise<TranscriptSegment[] | null>;
  onUpdateSegment: (segmentId: string, text: string) => Promise<TranscriptSegment | null>;
  onUpdateTiming: (segmentId: string, startSeconds: number, endSeconds: number) => Promise<TranscriptSegmentListResult | null>;
  onVideoDurationChange: (duration: number | null) => void;
  onVideoError: (message: string | null) => void;
  onVideoTimeChange: (time: number) => void;
  onVideoWidthChange: (width: number) => void;
  onWordTimingDiagnostic: (details: WordTimingDiagnosticDetails) => void;
  playbackSpeed: number;
  playbackTime: number;
  playing: boolean;
  progress: number;
  resetSignal: number;
  searchQuery: string;
  selectedJob: JobWithSource | null;
  selectedMediaKind: MediaKind;
  segments: TranscriptSegment[];
  setPlaying: (playing: boolean) => void;
  setVideoPreviewDock: (dock: VideoPreviewDock) => void;
  setVideoPreviewHidden: (hidden: boolean) => void;
  videoPreviewDock: VideoPreviewDock;
  videoPreviewHidden: boolean;
  videoPreviewWidth: number;
  viewportHeight: number;
  viewportWidth: number;
};

export function TranscriptStage({
  activeSearchSegmentId,
  activeSegmentIndex,
  busy,
  diagnosticsEnabled,
  duration,
  mediaRef,
  mediaUrl,
  onBrowseLibrary,
  onCancel,
  onImport,
  onMediaDiagnostic,
  onMergeSegment,
  onPause,
  onResume,
  onSeek,
  onSeekTime,
  onSplitSegment,
  onUpdateSegment,
  onUpdateTiming,
  onVideoDurationChange,
  onVideoError,
  onVideoTimeChange,
  onVideoWidthChange,
  onWordTimingDiagnostic,
  playbackSpeed,
  playbackTime,
  playing,
  progress,
  resetSignal,
  searchQuery,
  selectedJob,
  selectedMediaKind,
  segments,
  setPlaying,
  setVideoPreviewDock,
  setVideoPreviewHidden,
  videoPreviewDock,
  videoPreviewHidden,
  videoPreviewWidth,
  viewportHeight,
  viewportWidth
}: TranscriptStageProps): ReactElement {
  const hasVideoPreview = selectedMediaKind === 'video' && Boolean(mediaUrl);
  const transcriptList = segments.length === 0 ? (
    <EmptyState title="Transcript pending" body="Transcript text will appear here as the job progresses." />
  ) : (
    <VirtualizedSegmentList
      activeSegmentIndex={activeSegmentIndex}
      diagnosticsEnabled={diagnosticsEnabled}
      onWordTimingDiagnostic={onWordTimingDiagnostic}
      onMergeSegment={onMergeSegment}
      onSeek={onSeek}
      onSeekTime={onSeekTime}
      onSplitSegment={onSplitSegment}
      onUpdateTiming={onUpdateTiming}
      onUpdateSegment={onUpdateSegment}
      activeSearchSegmentId={activeSearchSegmentId}
      playbackTime={playbackTime}
      resetSignal={resetSignal}
      searchQuery={searchQuery}
      segments={segments}
    />
  );

  return (
    <section className={'transcript-stage ' + (hasVideoPreview ? 'has-video-preview preview-' + (videoPreviewHidden ? 'hidden' : videoPreviewDock) : '')}>
      {selectedJob ? (
        <>
          <TranscriptJobStatus
            job={selectedJob}
            onCancel={onCancel}
            onPause={onPause}
            onResume={onResume}
            progress={progress}
          />
          {hasVideoPreview && mediaUrl ? (
            <div className={'transcript-content-with-preview ' + (videoPreviewHidden ? 'hidden' : videoPreviewDock)}>
              {videoPreviewHidden ? (
                <button className="show-video-preview" onClick={() => setVideoPreviewHidden(false)} type="button">
                  <Video size={14} />
                  Show video preview
                </button>
              ) : null}
              <VideoPreview
                currentTime={playbackTime}
                dock={videoPreviewDock}
                duration={duration}
                hidden={videoPreviewHidden}
                mediaRef={mediaRef}
                mediaUrl={mediaUrl}
                onDurationChange={onVideoDurationChange}
                onError={onVideoError}
                onHide={() => setVideoPreviewHidden(true)}
                onMediaDiagnostic={onMediaDiagnostic}
                onTimeChange={onVideoTimeChange}
                onWidthChange={onVideoWidthChange}
                playbackSpeed={playbackSpeed}
                playing={playing}
                setDock={setVideoPreviewDock}
                setPlaying={setPlaying}
                viewportHeight={viewportHeight}
                viewportWidth={viewportWidth}
                width={videoPreviewWidth}
              />
              {transcriptList}
            </div>
          ) : transcriptList}
        </>
      ) : (
        <div className="empty-state transcript-empty-state">
          <FileText size={20} />
          <h4>Open a transcript</h4>
          <p>Choose a transcript from Library or import a recording.</p>
          <div className="empty-actions">
            <button className="secondary-action" onClick={onBrowseLibrary} type="button">
              <FolderOpen size={14} />
              Browse Library
            </button>
            <button className="primary-action compact" disabled={busy} onClick={onImport} type="button">
              <Plus size={16} />
              Import
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
