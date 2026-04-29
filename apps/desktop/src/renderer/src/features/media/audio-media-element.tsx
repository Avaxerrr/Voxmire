import { type MutableRefObject, type ReactElement } from 'react';
import { type MediaKind } from '../../lib/media-kind';

type AudioMediaElementProps = {
  audioRef: MutableRefObject<HTMLMediaElement | null>;
  mediaKind: MediaKind;
  mediaUrl: string | null;
  onDurationChange: (duration: number | null) => void;
  onError: (message: string | null) => void;
  onMediaDiagnostic: (eventName: string, media: HTMLMediaElement) => void;
  onTimeChange: (time: number) => void;
  playbackSpeed: number;
  recordSeekSample: (media: HTMLMediaElement, time: number) => void;
  setPlaying: (playing: boolean) => void;
  setVisualTime: (time: number) => void;
  syncPlaybackSample: (time: number, force?: boolean) => void;
};

export function AudioMediaElement({
  audioRef,
  mediaKind,
  mediaUrl,
  onDurationChange,
  onError,
  onMediaDiagnostic,
  onTimeChange,
  playbackSpeed,
  recordSeekSample,
  setPlaying,
  setVisualTime,
  syncPlaybackSample
}: AudioMediaElementProps): ReactElement | null {
  if (mediaKind !== 'audio') {
    return null;
  }

  return (
    <audio
      className="playback-media"
      onDurationChange={(event) => {
        const nextDuration = event.currentTarget.duration;
        onDurationChange(Number.isFinite(nextDuration) ? nextDuration : null);
      }}
      onEnded={(event) => {
        const nextTime = Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : event.currentTarget.currentTime;
        setVisualTime(nextTime);
        onTimeChange(nextTime);
        setPlaying(false);
      }}
      onError={() => {
        setPlaying(false);
        onError('Media source could not be loaded.');
      }}
      onLoadedMetadata={(event) => {
        const nextDuration = event.currentTarget.duration;
        event.currentTarget.playbackRate = playbackSpeed;
        setVisualTime(event.currentTarget.currentTime);
        onDurationChange(Number.isFinite(nextDuration) ? nextDuration : null);
        onTimeChange(event.currentTarget.currentTime);
      }}
      onPause={() => setPlaying(false)}
      onPlay={() => setPlaying(true)}
      onSeeked={(event) => {
        setVisualTime(event.currentTarget.currentTime);
        recordSeekSample(event.currentTarget, event.currentTarget.currentTime);
        syncPlaybackSample(event.currentTarget.currentTime, true);
        onMediaDiagnostic('audio:seeked', event.currentTarget);
      }}
      onSeeking={(event) => onMediaDiagnostic('audio:seeking', event.currentTarget)}
      onStalled={(event) => onMediaDiagnostic('audio:stalled', event.currentTarget)}
      onWaiting={(event) => onMediaDiagnostic('audio:waiting', event.currentTarget)}
      preload="metadata"
      ref={(element) => {
        audioRef.current = element;
      }}
      src={mediaUrl ?? undefined}
    />
  );
}
