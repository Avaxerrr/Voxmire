import { type ReactElement, memo, useMemo } from 'react';
import { scaleWaveformPeak, type WaveformScaleMode } from '../../lib/waveform';

const waveformBars = Array.from({ length: 104 }, (_, index) => {
  const wave = Math.abs(Math.sin(index * 0.44)) * 42;
  const chatter = (index * 19) % 31;
  const pause = index % 21 < 5 ? 13 : 0;
  return Math.max(12, Math.min(92, Math.round(18 + wave + chatter - pause)));
});

type WaveformGraphProps = {
  loading: boolean;
  peaks: number[];
  scaleMode: WaveformScaleMode;
};

export const WaveformGraph = memo(function WaveformGraph({ loading, peaks, scaleMode }: WaveformGraphProps): ReactElement {
  const width = 1200;
  const height = 96;
  const bars = useMemo(() => {
    const rawPeaks = peaks.length > 0 ? peaks : waveformBars.map((barHeight) => barHeight / 100);
    const displayPeaks = rawPeaks.map((peak) => scaleWaveformPeak(peak, scaleMode));
    const barWidth = Math.max(1, width / displayPeaks.length);

    return displayPeaks.map((peak, index) => {
      const normalizedHeight = Math.max(3, peak * height);
      return {
        height: normalizedHeight,
        key: `${index}-${peak.toFixed(3)}`,
        width: Math.max(1, barWidth * 0.72),
        x: index * barWidth,
        y: (height - normalizedHeight) / 2
      };
    });
  }, [peaks, scaleMode]);

  return (
    <svg className={`waveform ${loading ? 'loading' : ''}`} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
      <g>
        {bars.map((bar) => (
          <rect height={bar.height} key={bar.key} rx={1.5} width={bar.width} x={bar.x} y={bar.y} />
        ))}
      </g>
    </svg>
  );
});
