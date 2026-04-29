import { type CSSProperties, type MouseEvent as ReactMouseEvent, type MutableRefObject, type PointerEvent as ReactPointerEvent, type ReactElement, useEffect, useRef, useState } from 'react';
import { PanelLeftClose, PanelLeftOpen, X } from 'lucide-react';
import { formatDuration, formatTime } from '../../lib/format';
import { clampVideoPreviewWidth, defaultVideoPreviewWidth, type VideoPreviewDock } from './video-preview-preferences';

type VideoPreviewProps = {
  currentTime: number;
  dock: VideoPreviewDock;
  duration: number | null;
  hidden: boolean;
  mediaRef: MutableRefObject<HTMLMediaElement | null>;
  mediaUrl: string;
  onDurationChange: (duration: number | null) => void;
  onError: (message: string | null) => void;
  onHide: () => void;
  onMediaDiagnostic: (eventName: string, media: HTMLMediaElement) => void;
  onTimeChange: (time: number) => void;
  onWidthChange: (width: number) => void;
  playbackSpeed: number;
  playing: boolean;
  setDock: (dock: VideoPreviewDock) => void;
  setPlaying: (playing: boolean) => void;
  viewportHeight: number;
  viewportWidth: number;
  width: number;
};

export function VideoPreview({
  currentTime,
  dock,
  duration,
  hidden,
  mediaRef,
  mediaUrl,
  onDurationChange,
  onError,
  onHide,
  onMediaDiagnostic,
  onTimeChange,
  onWidthChange,
  playbackSpeed,
  playing,
  setDock,
  setPlaying,
  viewportHeight,
  viewportWidth,
  width
}: VideoPreviewProps): ReactElement {
  const [resizing, setResizing] = useState(false);
  const dragStartXRef = useRef(0);
  const dragStartWidthRef = useRef(width);
  const boundedWidth = clampVideoPreviewWidth(width, dock, viewportWidth, viewportHeight);

  useEffect(() => {
    const nextWidth = clampVideoPreviewWidth(width, dock, viewportWidth, viewportHeight);
    if (nextWidth !== width) {
      onWidthChange(nextWidth);
    }
  }, [dock, onWidthChange, viewportHeight, viewportWidth, width]);

  function beginResize(event: ReactPointerEvent<HTMLButtonElement>): void {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragStartXRef.current = event.clientX;
    dragStartWidthRef.current = boundedWidth;
    setResizing(true);
  }

  function resize(event: ReactPointerEvent<HTMLButtonElement>): void {
    if (!resizing) return;
    event.preventDefault();
    event.stopPropagation();
    onWidthChange(clampVideoPreviewWidth(dragStartWidthRef.current + event.clientX - dragStartXRef.current, dock, viewportWidth, viewportHeight));
  }

  function endResize(event: ReactPointerEvent<HTMLButtonElement>): void {
    event.preventDefault();
    event.stopPropagation();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setResizing(false);
  }

  function resetSize(event: ReactMouseEvent<HTMLButtonElement>): void {
    event.preventDefault();
    event.stopPropagation();
    onWidthChange(clampVideoPreviewWidth(defaultVideoPreviewWidth, dock, viewportWidth, viewportHeight));
  }

  return (
    <section aria-hidden={hidden || undefined} className={'video-preview-panel ' + (hidden ? 'hidden ' : '') + (resizing ? 'resizing' : '')} style={{ '--preview-width': boundedWidth + 'px' } as CSSProperties} aria-label="Video preview">
      <div
        className="video-preview-surface"
        onClick={() => setPlaying(!playing)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            setPlaying(!playing);
          }
        }}
        role="button"
        tabIndex={hidden ? -1 : 0}
        title={playing ? 'Pause video' : 'Play video'}
      >
        <video
          onDurationChange={(event) => {
            const nextDuration = event.currentTarget.duration;
            onDurationChange(Number.isFinite(nextDuration) ? nextDuration : null);
          }}
          onEnded={(event) => {
            const nextTime = Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : event.currentTarget.currentTime;
            onTimeChange(nextTime);
            setPlaying(false);
          }}
          onError={() => {
            setPlaying(false);
            onError('Video source could not be loaded.');
          }}
          onLoadedMetadata={(event) => {
            const nextDuration = event.currentTarget.duration;
            event.currentTarget.playbackRate = playbackSpeed;
            onDurationChange(Number.isFinite(nextDuration) ? nextDuration : null);
            onTimeChange(event.currentTarget.currentTime);
          }}
          onPause={() => setPlaying(false)}
          onPlay={() => setPlaying(true)}
          onSeeked={(event) => onTimeChange(event.currentTarget.currentTime)}
          onSeeking={(event) => onMediaDiagnostic('video:seeking', event.currentTarget)}
          onStalled={(event) => onMediaDiagnostic('video:stalled', event.currentTarget)}
          onWaiting={(event) => onMediaDiagnostic('video:waiting', event.currentTarget)}
          playsInline
          preload="metadata"
          ref={(element) => { mediaRef.current = element; }}
          src={mediaUrl}
        />
        <div className="video-preview-actions" onClick={(event) => event.stopPropagation()}>
          <button aria-label={dock === 'top' ? 'Dock video preview to side' : 'Dock video preview above transcript'} onClick={() => setDock(dock === 'top' ? 'side' : 'top')} title={dock === 'top' ? 'Dock side' : 'Dock top'} type="button">
            {dock === 'top' ? <PanelLeftOpen size={14} /> : <PanelLeftClose size={14} />}
          </button>
          <button aria-label="Hide video preview" onClick={onHide} title="Hide preview" type="button"><X size={14} /></button>
        </div>
        <span className="video-preview-time">{formatTime(currentTime)} / {formatDuration(duration)}</span>
        <span className="video-preview-size">{Math.round(boundedWidth)}px</span>
        <button aria-label="Resize video preview" className="video-resize-handle" onClick={(event) => event.stopPropagation()} onDoubleClick={resetSize} onPointerCancel={endResize} onPointerDown={beginResize} onPointerMove={resize} onPointerUp={endResize} title="Drag to resize. Double-click to reset." type="button" />
      </div>
    </section>
  );
}
