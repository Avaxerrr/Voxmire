export function applyMediaSeek(media: HTMLMediaElement, seconds: number, approximate: boolean): void {
  const fastSeek = (media as HTMLMediaElement & { fastSeek?: (time: number) => void }).fastSeek;
  if (approximate && typeof fastSeek === 'function') {
    try {
      fastSeek.call(media, seconds);
      return;
    } catch {
      // Fall back to precise seeking when the runtime exposes fastSeek but cannot use it for this media.
    }
  }

  media.currentTime = seconds;
}
