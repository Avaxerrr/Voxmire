import { describe, expect, it } from 'vitest';
import { parseWhisperProgressLine } from './index';

describe('parseWhisperProgressLine', () => {
  it('parses whisper.cpp progress output', () => {
    expect(parseWhisperProgressLine('whisper_full_with_state: progress =  14%')).toBe(0.14);
    expect(parseWhisperProgressLine('progress = 99.5%')).toBe(0.995);
  });

  it('ignores unrelated output', () => {
    expect(parseWhisperProgressLine('whisper_init_from_file_with_params: loading model')).toBeNull();
  });
});
