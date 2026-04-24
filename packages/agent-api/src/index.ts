import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import type { ExportFormat, JobWithSource, ModelId, ResourceStatus, TranscriptSegment } from '@voxmire/contracts';
import { getResourceStatus, type ResourcePaths } from '@voxmire/engine';
import {
  createJsonlRuntimeLogger,
  createVoxmireRuntime,
  type JobRecoveryResult,
  type VoxmireRuntime,
  type VoxmireRuntimeLogEvent
} from '@voxmire/runtime';
import { openVoxmireDatabase, type VoxmireDatabase } from '@voxmire/storage';

export type VoxmireAgentPaths = {
  dataDirectory: string;
  databasePath: string;
  engineOutputDirectory: string;
  exportDirectory: string;
  logDirectory: string;
  logPath: string;
  projectRoot: string;
};

export type VoxmireAgentOptions = {
  dataDirectory?: string;
  projectRoot?: string;
};

export type ReadLogsOptions = {
  jobId?: string;
  limit?: number;
};

export class VoxmireAgentApi {
  readonly runtime: VoxmireRuntime;
  readonly resources: ResourcePaths;

  constructor(
    readonly paths: VoxmireAgentPaths,
    private readonly db: VoxmireDatabase
  ) {
    this.resources = { projectRoot: paths.projectRoot };
    this.runtime = createVoxmireRuntime({
      db,
      resources: this.resources,
      directories: {
        engineOutputDirectory: paths.engineOutputDirectory,
        exportDirectory: paths.exportDirectory
      },
      logger: createJsonlRuntimeLogger(paths.logPath)
    });
  }

  close(): void {
    this.db.close();
  }

  getResourceStatus(): ResourceStatus[] {
    return getResourceStatus(this.resources);
  }

  listJobs(): JobWithSource[] {
    return this.runtime.listJobs();
  }

  getJob(jobId: string): JobWithSource | null {
    return this.runtime.getJob(jobId);
  }

  getTranscript(jobId: string): TranscriptSegment[] {
    return this.runtime.getTranscriptSegments(jobId);
  }

  async transcribeFile(input: { sourcePath: string; modelId: ModelId }): Promise<JobWithSource> {
    const created = await this.runtime.createTranscriptionJob({
      sourcePath: resolve(input.sourcePath),
      modelId: input.modelId,
      startImmediately: false
    });
    await this.runtime.runTranscriptionJob(created.job.id, input.modelId);
    return this.runtime.getJob(created.job.id) ?? created;
  }

  async createJob(input: { sourcePath: string; modelId: ModelId }): Promise<JobWithSource> {
    return this.runtime.createTranscriptionJob({
      sourcePath: resolve(input.sourcePath),
      modelId: input.modelId,
      startImmediately: false
    });
  }

  async runJob(jobId: string): Promise<JobWithSource | null> {
    const existing = this.runtime.getJob(jobId);
    if (!existing) {
      return null;
    }

    await this.runtime.runTranscriptionJob(jobId, existing.job.modelId);
    return this.runtime.getJob(jobId);
  }

  async recoverInterruptedJobs(input: { start?: boolean } = {}): Promise<JobRecoveryResult[]> {
    return this.runtime.recoverInterruptedJobs({ start: input.start ?? true });
  }

  exportTranscript(jobId: string, format: ExportFormat): { path: string; format: ExportFormat } {
    return this.runtime.exportTranscript(jobId, format);
  }

  readLogs(options: ReadLogsOptions = {}): VoxmireRuntimeLogEvent[] {
    if (!existsSync(this.paths.logPath)) {
      return [];
    }

    const limit = options.limit ?? 100;
    const lines = readFileSync(this.paths.logPath, 'utf8').trim().split(/\r?\n/).filter(Boolean);
    const entries = lines
      .map((line) => parseLogLine(line))
      .filter((entry): entry is VoxmireRuntimeLogEvent => entry !== null)
      .filter((entry) => !options.jobId || entry.jobId === options.jobId);

    return entries.slice(Math.max(0, entries.length - limit));
  }
}

export function createVoxmireAgentApi(options: VoxmireAgentOptions = {}): VoxmireAgentApi {
  const paths = resolveAgentPaths(options);
  for (const directory of [paths.dataDirectory, paths.engineOutputDirectory, paths.exportDirectory, paths.logDirectory]) {
    mkdirSync(directory, { recursive: true });
  }

  return new VoxmireAgentApi(paths, openVoxmireDatabase(paths.databasePath));
}

export function resolveAgentPaths(options: VoxmireAgentOptions = {}): VoxmireAgentPaths {
  const dataDirectory = options.dataDirectory ?? process.env.VOXMIRE_DATA_DIR ?? defaultDataDirectory();
  const projectRoot = options.projectRoot ?? resolve(process.env.VOXMIRE_PROJECT_ROOT ?? findProjectRoot(process.cwd()));
  const logDirectory = join(dataDirectory, 'logs');

  return {
    dataDirectory,
    databasePath: join(dataDirectory, 'voxmire.sqlite'),
    engineOutputDirectory: join(dataDirectory, 'engine-output'),
    exportDirectory: join(dataDirectory, 'exports'),
    logDirectory,
    logPath: join(logDirectory, 'voxmire.jsonl'),
    projectRoot
  };
}

function defaultDataDirectory(): string {
  if (process.platform === 'win32') {
    return join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'Voxmire');
  }

  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'Voxmire');
  }

  return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'Voxmire');
}

function findProjectRoot(startDirectory: string): string {
  let current = resolve(startDirectory);

  while (true) {
    if (existsSync(join(current, 'resources')) && existsSync(join(current, 'pnpm-workspace.yaml'))) {
      return current;
    }

    const parent = resolve(current, '..');
    if (parent === current) {
      return startDirectory;
    }

    current = parent;
  }
}

function parseLogLine(line: string): VoxmireRuntimeLogEvent | null {
  try {
    return JSON.parse(line) as VoxmireRuntimeLogEvent;
  } catch {
    return null;
  }
}

export function summarizeJob(jobWithSource: JobWithSource): string {
  return `${jobWithSource.job.id}  ${jobWithSource.job.status.padEnd(12)}  ${Math.round(jobWithSource.job.progress * 100)
    .toString()
    .padStart(3)}%  ${basename(jobWithSource.sourceFile.path)}`;
}
