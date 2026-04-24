import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openVoxmireDatabase, saveTranscriptSegment } from '@voxmire/storage';
import { createVoxmireRuntime } from './index';

describe('VoxmireRuntime', () => {
  it('creates jobs and exports transcripts without Electron', async () => {
    const tempDirectory = mkdtempSync(join(tmpdir(), 'voxmire-runtime-'));
    const sourcePath = join(tempDirectory, 'recording.wav');
    writeFileSync(sourcePath, 'placeholder audio');

    const db = openVoxmireDatabase(':memory:');
    const runtime = createVoxmireRuntime({
      db,
      resources: { projectRoot: tempDirectory },
      directories: {
        engineOutputDirectory: join(tempDirectory, 'engine-output'),
        exportDirectory: join(tempDirectory, 'exports')
      }
    });

    const created = await runtime.createTranscriptionJob({
      sourcePath,
      modelId: 'large-v3-turbo',
      startImmediately: false
    });

    saveTranscriptSegment(db, {
      id: 'seg_1',
      jobId: created.job.id,
      index: 0,
      startSeconds: 0,
      endSeconds: 2,
      text: 'Runtime transcript.',
      confidence: null,
      createdAt: '2026-04-23T00:00:00.000Z'
    });

    const exported = runtime.exportTranscript(created.job.id, 'txt');

    expect(runtime.listJobs()).toHaveLength(1);
    expect(created.sourceFile.name).toBe('recording.wav');
    expect(exported.path).toContain('recording');
    db.close();
  });
});
