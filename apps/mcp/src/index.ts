import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  createVoxmireAgentApi,
  summarizeJob,
  type SeedTranscriptOptions,
  type VoxmireAgentApi
} from '@voxmire/agent-api';
import { engineBackendSchema, exportFormatSchema, modelIdSchema } from '@voxmire/contracts';
import { z } from 'zod';

const api = createVoxmireAgentApi();
const server = new McpServer({
  name: 'voxmire',
  version: '0.1.0'
});

function jsonResult(data: unknown) {
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(data, null, 2)
      }
    ]
  };
}

function notFoundResult(kind: string, id: string) {
  return {
    isError: true,
    content: [
      {
        type: 'text' as const,
        text: `${kind} not found: ${id}`
      }
    ]
  };
}

server.registerTool(
  'voxmire_paths',
  {
    title: 'Voxmire paths',
    description: 'Return the local data, database, export, log, and project paths used by Voxmire.'
  },
  async () => jsonResult(api.paths)
);

server.registerTool(
  'voxmire_resources',
  {
    title: 'Voxmire resources',
    description: 'Return local ffmpeg, ffprobe, whisper engine, and model availability.'
  },
  async () => jsonResult(api.getResourceStatus())
);

server.registerTool(
  'voxmire_machine_profile',
  {
    title: 'Voxmire machine profile',
    description: 'Return local CPU, memory, backend availability, and recommended backend/model.'
  },
  async () => jsonResult(await api.getMachineProfile())
);

server.registerTool(
  'voxmire_jobs_list',
  {
    title: 'List Voxmire jobs',
    description: 'List transcription jobs in the local Voxmire database.'
  },
  async () => jsonResult(api.listJobs())
);

server.registerTool(
  'voxmire_jobs_status',
  {
    title: 'Get Voxmire job',
    description: 'Get one transcription job and source file by job ID.',
    inputSchema: {
      jobId: z.string().min(1)
    }
  },
  async ({ jobId }) => {
    const job = api.getJob(jobId);
    return job ? jsonResult(job) : notFoundResult('Job', jobId);
  }
);

server.registerTool(
  'voxmire_jobs_create',
  {
    title: 'Create Voxmire job',
    description: 'Create a transcription job for a local source path without starting transcription.',
    inputSchema: {
      sourcePath: z.string().min(1),
      modelId: modelIdSchema.default('large-v3-turbo'),
      engineBackend: engineBackendSchema.default('cpu')
    }
  },
  async ({ sourcePath, modelId, engineBackend }) => jsonResult(await api.createJob({ sourcePath, modelId, engineBackend }))
);

server.registerTool(
  'voxmire_jobs_run',
  {
    title: 'Run Voxmire job',
    description: 'Run an existing queued or resumable transcription job.',
    inputSchema: {
      jobId: z.string().min(1)
    }
  },
  async ({ jobId }) => {
    const job = await api.runJob(jobId);
    return job ? jsonResult(job) : notFoundResult('Job', jobId);
  }
);

server.registerTool(
  'voxmire_jobs_pause',
  {
    title: 'Pause Voxmire job',
    description: 'Pause a queued or active transcription job.',
    inputSchema: {
      jobId: z.string().min(1)
    }
  },
  async ({ jobId }) => {
    const job = api.pauseJob(jobId);
    return job ? jsonResult(job) : notFoundResult('Job', jobId);
  }
);

server.registerTool(
  'voxmire_jobs_resume',
  {
    title: 'Resume Voxmire job',
    description: 'Resume a paused transcription job and continue unfinished chunks.',
    inputSchema: {
      jobId: z.string().min(1)
    }
  },
  async ({ jobId }) => {
    const job = await api.resumeJob(jobId);
    return job ? jsonResult(job) : notFoundResult('Job', jobId);
  }
);

server.registerTool(
  'voxmire_jobs_recover',
  {
    title: 'Recover Voxmire jobs',
    description: 'Recover jobs left queued, preparing, or transcribing after interruption.',
    inputSchema: {
      start: z.boolean().default(true)
    }
  },
  async ({ start }) => jsonResult(await api.recoverInterruptedJobs({ start }))
);

server.registerTool(
  'voxmire_transcript_get',
  {
    title: 'Get Voxmire transcript',
    description: 'Return transcript segments for a job. Results are sliced to keep MCP responses manageable.',
    inputSchema: {
      jobId: z.string().min(1),
      limit: z.number().int().min(1).max(1000).default(200),
      offset: z.number().int().min(0).default(0)
    }
  },
  async ({ jobId, limit, offset }) => {
    if (!api.getJob(jobId)) {
      return notFoundResult('Job', jobId);
    }

    const segments = api.getTranscript(jobId);
    return jsonResult({
      jobId,
      offset,
      limit,
      total: segments.length,
      segments: segments.slice(offset, offset + limit)
    });
  }
);

server.registerTool(
  'voxmire_export_transcript',
  {
    title: 'Export Voxmire transcript',
    description: 'Export a completed transcript to txt, json, srt, or vtt.',
    inputSchema: {
      jobId: z.string().min(1),
      format: exportFormatSchema
    }
  },
  async ({ jobId, format }) => {
    if (!api.getJob(jobId)) {
      return notFoundResult('Job', jobId);
    }

    return jsonResult(api.exportTranscript(jobId, format));
  }
);

server.registerTool(
  'voxmire_logs_tail',
  {
    title: 'Tail Voxmire logs',
    description: 'Read recent structured runtime JSONL logs, optionally filtered to a job.',
    inputSchema: {
      jobId: z.string().min(1).optional(),
      limit: z.number().int().min(1).max(1000).default(100)
    }
  },
  async ({ jobId, limit }) => jsonResult(api.readLogs(jobId ? { jobId, limit } : { limit }))
);

server.registerTool(
  'voxmire_dev_seed_transcript',
  {
    title: 'Seed Voxmire transcript',
    description: 'Development-only helper that creates a completed transcript with many segments for UI and agent stress tests.',
    inputSchema: {
      name: z.string().min(1).optional(),
      segments: z.number().int().min(1).max(100000).default(5000),
      wordsPerSegment: z.number().int().min(1).max(240).default(18)
    }
  },
  async ({ name, segments, wordsPerSegment }) =>
    jsonResult(
      formatSeedResult(api, {
        ...(name ? { name } : {}),
        segments,
        wordsPerSegment
      })
    )
);

function formatSeedResult(agentApi: VoxmireAgentApi, input: SeedTranscriptOptions) {
  const result = agentApi.seedTranscript(input);
  return {
    ...result,
    summary: summarizeJob(result.job)
  };
}

async function shutdown(signal: NodeJS.Signals) {
  api.close();
  await server.close();
  process.kill(process.pid, signal);
}

process.once('SIGINT', () => {
  void shutdown('SIGINT');
});

process.once('SIGTERM', () => {
  void shutdown('SIGTERM');
});

await server.connect(new StdioServerTransport());
