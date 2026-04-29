export type WaveformScaleMode = 'actual' | 'boost' | 'db';

export const waveformScaleModes: WaveformScaleMode[] = ['actual', 'boost', 'db'];

export function scaleWaveformPeak(peak: number, mode: WaveformScaleMode): number {
  const clampedPeak = Math.max(0, Math.min(1, peak));

  if (mode === 'actual') {
    return clampedPeak;
  }

  if (mode === 'boost') {
    return Math.pow(clampedPeak, 0.72);
  }

  const floorDb = -60;
  const db = 20 * Math.log10(Math.max(clampedPeak, 0.001));
  return Math.max(0, Math.min(1, (db - floorDb) / Math.abs(floorDb)));
}

export function formatPlaybackSpeed(speed: number): string {
  return Number.isInteger(speed) ? `${speed}x` : `${speed.toFixed(2).replace(/0$/, '')}x`;
}

export function waveformScaleLabel(mode: WaveformScaleMode): string {
  switch (mode) {
    case 'actual':
      return 'Actual';
    case 'boost':
      return 'Boost';
    case 'db':
      return 'dB';
    default:
      return mode;
  }
}

export function waveformScaleDescription(mode: WaveformScaleMode): string {
  switch (mode) {
    case 'actual':
      return 'Linear full-scale peaks. Most truthful for quiet vs loud audio.';
    case 'boost':
      return 'Visual boost for inspecting quiet audio without normalizing to the loudest peak.';
    case 'db':
      return 'Logarithmic dB-style peak view for low-level detail.';
    default:
      return String(mode);
  }
}
