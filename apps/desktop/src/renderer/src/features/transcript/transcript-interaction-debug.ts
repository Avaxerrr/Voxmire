export function debugTranscriptInteraction(eventName: string, details: Record<string, unknown> = {}): void {
  try {
    if (window.localStorage.getItem('voxmire:debug:transcript-interactions') !== '1') {
      return;
    }
  } catch {
    return;
  }

  console.debug(`[transcript-interaction] ${eventName}`, details);
}