export type VideoPreviewDock = 'top' | 'side';

export type VideoPreviewPreference = {
  dock: VideoPreviewDock;
  hidden: boolean;
  width: number;
};

const videoPreviewPreferenceKey = 'voxmire:videoPreviewPreference';
export const defaultVideoPreviewWidth = 320;
const minVideoPreviewWidth = 180;
const maxTopVideoPreviewWidth = 420;
const maxSideVideoPreviewWidth = 360;
const sidePreviewBreakpoint = 1180;

export function loadVideoPreviewPreference(): VideoPreviewPreference {
  const fallback: VideoPreviewPreference = { dock: 'top', hidden: false, width: defaultVideoPreviewWidth };

  try {
    const rawValue = window.localStorage.getItem(videoPreviewPreferenceKey);
    if (!rawValue) {
      return fallback;
    }

    const value = JSON.parse(rawValue) as Partial<VideoPreviewPreference>;
    return {
      dock: value.dock === 'side' ? 'side' : 'top',
      hidden: typeof value.hidden === 'boolean' ? value.hidden : fallback.hidden,
      width: typeof value.width === 'number' && Number.isFinite(value.width) ? Math.max(minVideoPreviewWidth, Math.min(maxTopVideoPreviewWidth, Math.round(value.width))) : fallback.width
    };
  } catch {
    return fallback;
  }
}

export function saveVideoPreviewPreference(preference: VideoPreviewPreference): void {
  try {
    window.localStorage.setItem(videoPreviewPreferenceKey, JSON.stringify(preference));
  } catch {
    // Best-effort UI preference only.
  }
}

export function clampVideoPreviewWidth(width: number, dock: VideoPreviewDock, viewportWidth: number, viewportHeight: number): number {
  const dockedToSide = dock === 'side' && viewportWidth > sidePreviewBreakpoint;
  const baseMaxWidth = dockedToSide ? maxSideVideoPreviewWidth : maxTopVideoPreviewWidth;
  const widthLimit = dockedToSide ? Math.floor(viewportWidth * 0.28) : Math.floor(viewportWidth * 0.5);
  const availableHeight = viewportHeight - (dockedToSide ? 300 : 430);
  const heightLimit = Math.floor(Math.max(0, availableHeight) * 9 / 16);
  const maxWidth = Math.max(minVideoPreviewWidth, Math.min(baseMaxWidth, widthLimit, Math.max(minVideoPreviewWidth, heightLimit)));

  return Math.max(minVideoPreviewWidth, Math.min(maxWidth, Math.round(width)));
}
