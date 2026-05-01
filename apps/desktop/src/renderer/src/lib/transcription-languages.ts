import type { TranscriptionLanguage } from '@voxmire/contracts';

export type TranscriptionLanguageOption = {
  id: TranscriptionLanguage;
  label: string;
};

export const transcriptionLanguageOptions: readonly TranscriptionLanguageOption[] = [
  { id: 'auto', label: 'Auto detect' },
  { id: 'en', label: 'English' },
  { id: 'es', label: 'Spanish' },
  { id: 'fr', label: 'French' },
  { id: 'de', label: 'German' },
  { id: 'it', label: 'Italian' },
  { id: 'pt', label: 'Portuguese' },
  { id: 'nl', label: 'Dutch' },
  { id: 'ja', label: 'Japanese' },
  { id: 'ko', label: 'Korean' },
  { id: 'zh', label: 'Chinese' },
  { id: 'ru', label: 'Russian' },
  { id: 'ar', label: 'Arabic' },
  { id: 'hi', label: 'Hindi' },
  { id: 'vi', label: 'Vietnamese' },
  { id: 'id', label: 'Indonesian' },
  { id: 'tr', label: 'Turkish' },
  { id: 'pl', label: 'Polish' },
  { id: 'uk', label: 'Ukrainian' }
];

export function transcriptionLanguageLabel(language: TranscriptionLanguage): string {
  return transcriptionLanguageOptions.find((option) => option.id === language)?.label ?? language.toUpperCase();
}
