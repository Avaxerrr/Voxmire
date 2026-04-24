import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createVoxmireAgentApi, resolveAgentPaths } from './index';

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

describe('resolveAgentPaths', () => {
  it('prefers the existing Electron dev data directory when running from the workspace', () => {
    const previousAppData = process.env.APPDATA;
    const previousDataDir = process.env.VOXMIRE_DATA_DIR;
    const appData = mkdtempSync(join(tmpdir(), 'voxmire-appdata-'));
    const projectRoot = mkdtempSync(join(tmpdir(), 'voxmire-project-'));
    const devDataDirectory = join(appData, '@voxmire', 'desktop');

    mkdirSync(join(projectRoot, 'apps', 'desktop'), { recursive: true });
    mkdirSync(join(projectRoot, 'resources'), { recursive: true });
    mkdirSync(devDataDirectory, { recursive: true });
    writeFileSync(join(projectRoot, 'apps', 'desktop', 'package.json'), '{}');
    process.env.APPDATA = appData;
    delete process.env.VOXMIRE_DATA_DIR;

    try {
      expect(resolveAgentPaths({ projectRoot }).dataDirectory).toBe(devDataDirectory);
    } finally {
      if (previousAppData === undefined) {
        delete process.env.APPDATA;
      } else {
        process.env.APPDATA = previousAppData;
      }

      if (previousDataDir === undefined) {
        delete process.env.VOXMIRE_DATA_DIR;
      } else {
        process.env.VOXMIRE_DATA_DIR = previousDataDir;
      }
    }
  });
});
