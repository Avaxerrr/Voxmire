import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createVoxmireAgentApi } from './index';

describe('VoxmireAgentApi dev helpers', () => {
  it('seeds a completed transcript for renderer stress testing', () => {
    const dataDirectory = mkdtempSync(join(tmpdir(), 'voxmire-agent-api-'));
    const api = createVoxmireAgentApi({ dataDirectory });

    try {
      const result = api.seedTranscript({
        name: 'Stress fixture',
        segments: 25,
        wordsPerSegment: 6
      });

      expect(result.segmentCount).toBe(25);
      expect(result.job.job.status).toBe('completed');
      expect(result.job.job.progress).toBe(1);
      expect(api.getTranscript(result.job.job.id)).toHaveLength(25);
    } finally {
      api.close();
    }
  });
});
