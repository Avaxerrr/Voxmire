import type { TranscriptionOutputMode } from '@voxmire/contracts';

export type TranscriptionOutputModeOption = {
  id: TranscriptionOutputMode;
  label: string;
  selectLabel?: string;
};

export const transcriptionOutputModeOptions: readonly TranscriptionOutputModeOption[] = [
  { id: 'transcribe', label: 'Transcribe original language', selectLabel: 'Original language' },
  { id: 'translate', label: 'Translate to English' }
];

export function transcriptionOutputModeLabel(outputMode: TranscriptionOutputMode): string {
  return transcriptionOutputModeOptions.find((option) => option.id === outputMode)?.label ?? outputMode;
}
