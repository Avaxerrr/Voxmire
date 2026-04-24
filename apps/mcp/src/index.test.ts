import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

describe('Voxmire MCP server', () => {
  it('exposes tools and can seed/read/export a transcript through stdio', async () => {
    const appDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..');
    const projectRoot = resolve(appDirectory, '..', '..');
    const dataDirectory = mkdtempSync(resolve(tmpdir(), 'voxmire-mcp-'));
    const client = new Client({
      name: 'voxmire-mcp-smoke-test',
      version: '0.1.0'
    });
    const transport = new StdioClientTransport({
      command: resolve(appDirectory, 'node_modules', '.bin', process.platform === 'win32' ? 'tsx.CMD' : 'tsx'),
      args: ['src/index.ts'],
      cwd: appDirectory,
      env: {
        ...process.env,
        VOXMIRE_DATA_DIR: dataDirectory,
        VOXMIRE_PROJECT_ROOT: projectRoot
      },
      stderr: 'pipe'
    });

    try {
      await client.connect(transport);

      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name)).toEqual(
        expect.arrayContaining([
          'voxmire_paths',
          'voxmire_machine_profile',
          'voxmire_jobs_list',
          'voxmire_transcript_get',
          'voxmire_dev_seed_transcript'
        ])
      );

      const profileResult = await client.callTool({
        name: 'voxmire_machine_profile',
        arguments: {}
      });
      const profile = parseJsonToolResult<{ recommendedBackend: string; logicalCpuCores: number }>(profileResult);
      expect(profile.logicalCpuCores).toBeGreaterThan(0);
      expect(profile.recommendedBackend).toBeTruthy();

      const seedResult = await client.callTool({
        name: 'voxmire_dev_seed_transcript',
        arguments: {
          name: 'MCP smoke transcript',
          segments: 12,
          wordsPerSegment: 6
        }
      });
      const seed = parseJsonToolResult<{
        job: { job: { id: string; status: string; progress: number } };
        segmentCount: number;
      }>(seedResult);
      expect(seed.job.job.status).toBe('completed');
      expect(seed.segmentCount).toBe(12);

      const listResult = await client.callTool({
        name: 'voxmire_jobs_list',
        arguments: {}
      });
      const jobs = parseJsonToolResult<Array<{ job: { id: string } }>>(listResult);
      expect(jobs.some((job) => job.job.id === seed.job.job.id)).toBe(true);

      const transcriptResult = await client.callTool({
        name: 'voxmire_transcript_get',
        arguments: {
          jobId: seed.job.job.id,
          offset: 2,
          limit: 5
        }
      });
      const transcript = parseJsonToolResult<{ total: number; segments: Array<{ text: string }> }>(transcriptResult);
      expect(transcript.total).toBe(12);
      expect(transcript.segments).toHaveLength(5);

      const exportResult = await client.callTool({
        name: 'voxmire_export_transcript',
        arguments: {
          jobId: seed.job.job.id,
          format: 'txt'
        }
      });
      const exported = parseJsonToolResult<{ path: string; format: string }>(exportResult);
      expect(exported.format).toBe('txt');
      expect(exported.path).toContain(seed.job.job.id);
    } finally {
      await client.close();
    }
  });
});

function parseJsonToolResult<T>(result: Awaited<ReturnType<Client['callTool']>>): T {
  const content = result.content;
  if (!Array.isArray(content)) {
    throw new Error('Expected MCP tool content array.');
  }

  const text = content.find((item): item is { type: 'text'; text: string } => {
    return typeof item === 'object' && item !== null && 'type' in item && item.type === 'text' && 'text' in item && typeof item.text === 'string';
  })?.text;

  if (!text) {
    throw new Error('Expected MCP tool text content.');
  }

  return JSON.parse(text) as T;
}
