import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createVoxmireAgentApi, resolveAgentPaths, summarizeJob } from '@voxmire/agent-api';
import { exportFormatSchema, modelIdSchema, type ExportFormat, type ModelId, type ResourceStatus } from '@voxmire/contracts';

type CliOptions = {
  flags: Map<string, string | true>;
  positional: string[];
};

const args = process.argv.slice(2).filter((arg, index) => !(index === 0 && arg === '--'));

main(args).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

async function main(rawArgs: string[]): Promise<void> {
  const command = rawArgs[0];

  if (!command || command === 'help' || command === '--help' || command === '-h') {
    printHelp();
    return;
  }

  const options = parseOptions(rawArgs.slice(1));
  const json = options.flags.has('json');

  if (command === 'paths') {
    const paths = resolveAgentPaths();
    print(json, paths, formatPaths(paths));
    return;
  }

  const api = createVoxmireAgentApi();
  try {
    switch (command) {
      case 'resources':
        print(json, api.getResourceStatus(), formatResources(api.getResourceStatus()));
        break;
      case 'jobs':
        await handleJobs(api, options, json);
        break;
      case 'transcribe':
        await handleTranscribe(api, options, json);
        break;
      case 'transcript':
        handleTranscript(api, options, json);
        break;
      case 'export':
        handleExport(api, options, json);
        break;
      case 'logs':
        handleLogs(api, options, json);
        break;
      default:
        throw new Error(`Unknown command: ${command}`);
    }
  } finally {
    api.close();
  }
}

async function handleJobs(api: ReturnType<typeof createVoxmireAgentApi>, options: CliOptions, json: boolean): Promise<void> {
  const subcommand = options.positional[0] ?? 'list';

  if (subcommand === 'list') {
    const jobs = api.listJobs();
    print(json, jobs, jobs.length === 0 ? 'No jobs found.' : jobs.map(summarizeJob).join('\n'));
    return;
  }

  if (subcommand === 'status') {
    const jobId = requiredArg(options.positional[1], 'jobId');
    const job = api.getJob(jobId);
    print(json, job, job ? summarizeJob(job) : `Job not found: ${jobId}`);
    return;
  }

  if (subcommand === 'create') {
    const sourcePath = requiredArg(options.positional[1], 'sourcePath');
    const modelId = parseModelId(flagValue(options, 'model') ?? 'large-v3-turbo');
    assertFileExists(sourcePath);
    const job = await api.createJob({ sourcePath, modelId });
    print(json, job, summarizeJob(job));
    return;
  }

  if (subcommand === 'run') {
    const jobId = requiredArg(options.positional[1], 'jobId');
    const job = await api.runJob(jobId);
    print(json, job, job ? summarizeJob(job) : `Job not found: ${jobId}`);
    return;
  }

  throw new Error(`Unknown jobs command: ${subcommand}`);
}

async function handleTranscribe(api: ReturnType<typeof createVoxmireAgentApi>, options: CliOptions, json: boolean): Promise<void> {
  const sourcePath = requiredArg(options.positional[0], 'sourcePath');
  const modelId = parseModelId(flagValue(options, 'model') ?? 'large-v3-turbo');
  const exportFormat = options.flags.has('format') ? parseExportFormat(flagValue(options, 'format')) : null;
  assertFileExists(sourcePath);

  const job = await api.transcribeFile({ sourcePath, modelId });
  const exported = exportFormat ? api.exportTranscript(job.job.id, exportFormat) : null;
  const payload = { job, export: exported };
  const text = exported ? `${summarizeJob(job)}\nExported ${exported.format.toUpperCase()} to ${exported.path}` : summarizeJob(job);
  print(json, payload, text);
}

function handleTranscript(api: ReturnType<typeof createVoxmireAgentApi>, options: CliOptions, json: boolean): void {
  const subcommand = options.positional[0] ?? 'get';
  if (subcommand !== 'get') {
    throw new Error(`Unknown transcript command: ${subcommand}`);
  }

  const jobId = requiredArg(options.positional[1], 'jobId');
  const segments = api.getTranscript(jobId);
  print(json, segments, segments.map((segment) => `[${formatTime(segment.startSeconds)}] ${segment.text}`).join('\n'));
}

function handleExport(api: ReturnType<typeof createVoxmireAgentApi>, options: CliOptions, json: boolean): void {
  const jobId = requiredArg(options.positional[0], 'jobId');
  const format = parseExportFormat(flagValue(options, 'format') ?? options.positional[1]);
  const result = api.exportTranscript(jobId, format);
  print(json, result, `Exported ${format.toUpperCase()} to ${result.path}`);
}

function handleLogs(api: ReturnType<typeof createVoxmireAgentApi>, options: CliOptions, json: boolean): void {
  const subcommand = options.positional[0] ?? 'tail';
  if (subcommand !== 'tail') {
    throw new Error(`Unknown logs command: ${subcommand}`);
  }

  const limit = Number(flagValue(options, 'limit') ?? '50');
  const jobId = flagValue(options, 'job');
  const logOptions = jobId
    ? { limit: Number.isFinite(limit) ? limit : 50, jobId }
    : { limit: Number.isFinite(limit) ? limit : 50 };
  const logs = api.readLogs(logOptions);
  print(
    json,
    logs,
    logs
      .map((entry) => `${entry.timestamp} ${entry.level.toUpperCase().padEnd(5)} ${entry.event} ${entry.jobId ?? '-'} ${entry.message}`)
      .join('\n')
  );
}

function parseOptions(rawArgs: string[]): CliOptions {
  const flags = new Map<string, string | true>();
  const positional: string[] = [];

  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (!arg) {
      continue;
    }

    if (arg.startsWith('--')) {
      const [name, inlineValue] = arg.slice(2).split('=', 2);
      if (!name) {
        continue;
      }

      if (inlineValue !== undefined) {
        flags.set(name, inlineValue);
        continue;
      }

      const next = rawArgs[index + 1];
      if (next && !next.startsWith('--')) {
        flags.set(name, next);
        index += 1;
      } else {
        flags.set(name, true);
      }
      continue;
    }

    positional.push(arg);
  }

  return { flags, positional };
}

function flagValue(options: CliOptions, name: string): string | undefined {
  const value = options.flags.get(name);
  return typeof value === 'string' ? value : undefined;
}

function requiredArg(value: string | undefined, label: string): string {
  if (!value) {
    throw new Error(`Missing required argument: ${label}`);
  }

  return value;
}

function parseModelId(value: string): ModelId {
  return modelIdSchema.parse(value);
}

function parseExportFormat(value: string | undefined): ExportFormat {
  if (!value) {
    throw new Error('Missing export format. Use --format txt|json|srt|vtt.');
  }

  return exportFormatSchema.parse(value);
}

function assertFileExists(filePath: string): void {
  const resolved = resolve(filePath);
  if (!existsSync(resolved)) {
    throw new Error(`File not found: ${resolved}`);
  }
}

function print(json: boolean, payload: unknown, text: string): void {
  console.log(json ? JSON.stringify(payload, null, 2) : text);
}

function formatResources(resources: ResourceStatus[]): string {
  return resources
    .map((resource) => `${resource.available ? 'OK  ' : 'MISS'} ${resource.required ? 'required' : 'optional'} ${resource.label} ${resource.path}`)
    .join('\n');
}

function formatPaths(paths: ReturnType<typeof resolveAgentPaths>): string {
  return [
    `Data: ${paths.dataDirectory}`,
    `Database: ${paths.databasePath}`,
    `Logs: ${paths.logPath}`,
    `Project: ${paths.projectRoot}`
  ].join('\n');
}

function formatTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.floor(seconds % 60);
  return `${minutes}:${remainder.toString().padStart(2, '0')}`;
}

function printHelp(): void {
  console.log(`Voxmire CLI

Usage:
  corepack pnpm --filter @voxmire/cli cli -- paths [--json]
  corepack pnpm --filter @voxmire/cli cli -- resources [--json]
  corepack pnpm --filter @voxmire/cli cli -- jobs list [--json]
  corepack pnpm --filter @voxmire/cli cli -- jobs status <jobId> [--json]
  corepack pnpm --filter @voxmire/cli cli -- jobs create <sourcePath> [--model large-v3-turbo] [--json]
  corepack pnpm --filter @voxmire/cli cli -- jobs run <jobId> [--json]
  corepack pnpm --filter @voxmire/cli cli -- transcribe <sourcePath> [--model large-v3-turbo] [--format txt] [--json]
  corepack pnpm --filter @voxmire/cli cli -- transcript get <jobId> [--json]
  corepack pnpm --filter @voxmire/cli cli -- export <jobId> --format txt [--json]
  corepack pnpm --filter @voxmire/cli cli -- logs tail [--limit 50] [--job <jobId>] [--json]
`);
}
