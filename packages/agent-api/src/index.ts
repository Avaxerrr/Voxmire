import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { resolveTranscriptionPreset } from '@voxmire/core';
import type { EngineBackend, ExportFormat, JobWithSource, MachineProfile, ModelId, ResourceStatus, TranscriptSegment, TranscriptionJob, TranscriptionPresetId } from '@voxmire/contracts';
import { getMachineProfile, getResourceStatus, type ResourcePaths } from '@voxmire/engine';
import {
  createJsonlRuntimeLogger,
  createVoxmireRuntime,
  type JobRecoveryResult,
  type VoxmireRuntime,
  type VoxmireRuntimeLogEvent
} from '@voxmire/runtime';
import {
  createId,
  createJobRecord,
  openVoxmireDatabase,
  saveTranscriptSegment,
  updateJobStatus,
  type VoxmireDatabase
} from '@voxmire/storage';

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

export type SeedTranscriptOptions = {
  name?: string;
  segments?: number;
  wordsPerSegment?: number;
};

export type SeedTranscriptResult = {
  job: JobWithSource;
  segmentCount: number;
};

export type TranscriptionSelectionInput = {
  engineBackend?: EngineBackend;
  modelId?: ModelId;
  presetId?: TranscriptionPresetId;
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

  getMachineProfile(): Promise<MachineProfile> {
    return getMachineProfile(this.resources);
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

  async transcribeFile(input: { sourcePath: string } & TranscriptionSelectionInput): Promise<JobWithSource> {
    const selection = await this.resolveTranscriptionSelection(input);
    const created = await this.runtime.createTranscriptionJob({
      sourcePath: resolve(input.sourcePath),
      modelId: selection.modelId,
      engineBackend: selection.engineBackend,
      startImmediately: false
    });
    await this.runtime.runTranscriptionJob(created.job.id, selection.modelId);
    return this.runtime.getJob(created.job.id) ?? created;
  }

  async createJob(input: { sourcePath: string } & TranscriptionSelectionInput): Promise<JobWithSource> {
    const selection = await this.resolveTranscriptionSelection(input);
    return this.runtime.createTranscriptionJob({
      sourcePath: resolve(input.sourcePath),
      modelId: selection.modelId,
      engineBackend: selection.engineBackend,
      startImmediately: false
    });
  }

  private async resolveTranscriptionSelection(input: TranscriptionSelectionInput): Promise<{ modelId: ModelId; engineBackend: EngineBackend }> {
    const presetId = input.presetId ?? (input.modelId ? null : 'balanced');
    if (presetId) {
      const resolved = resolveTranscriptionPreset(presetId, {
        machineProfile: await this.getMachineProfile(),
        fallbackBackend: 'cpu'
      });
      return {
        modelId: input.modelId ?? resolved.modelId,
        engineBackend: input.engineBackend ?? resolved.engineBackend
      };
    }

    return {
      modelId: input.modelId ?? 'large-v3-turbo',
      engineBackend: input.engineBackend ?? 'cpu'
    };
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

  pauseJob(jobId: string): TranscriptionJob | null {
    return this.runtime.pauseJob(jobId);
  }

  async resumeJob(jobId: string): Promise<JobWithSource | null> {
    return this.runtime.resumeJob(jobId);
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

  seedTranscript(options: SeedTranscriptOptions = {}): SeedTranscriptResult {
    const segmentCount = clampInteger(options.segments ?? 5000, 1, 100000);
    const wordsPerSegment = clampInteger(options.wordsPerSegment ?? 18, 1, 240);
    const name = options.name?.trim() || `Dev stress transcript ${segmentCount}`;
    const now = new Date().toISOString();
    const durationSeconds = segmentCount * 4;
    const created = createJobRecord(this.db, {
      sourceFile: {
        id: createId('src'),
        path: join(this.paths.dataDirectory, 'dev-seed', `${sanitizeFileName(name)}.wav`),
        name: `${name}.wav`,
        extension: 'wav',
        sizeBytes: 0,
        durationSeconds,
        createdAt: now
      },
      modelId: 'large-v3-turbo'
    });

    this.db.exec('BEGIN');
    try {
      for (let index = 0; index < segmentCount; index += 1) {
        const startSeconds = index * 4;
        saveTranscriptSegment(this.db, {
          id: createId('seg'),
          jobId: created.job.id,
          index,
          startSeconds,
          endSeconds: startSeconds + 3.4,
          text: buildSeedSegmentText(index, wordsPerSegment),
          confidence: null,
          createdAt: now
        });
      }

      updateJobStatus(this.db, created.job.id, 'completed', { progress: 1 });
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }

    return {
      job: this.runtime.getJob(created.job.id) ?? created,
      segmentCount
    };
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
  const projectRoot = options.projectRoot ?? resolve(process.env.VOXMIRE_PROJECT_ROOT ?? findProjectRoot(process.cwd()));
  const dataDirectory = options.dataDirectory ?? process.env.VOXMIRE_DATA_DIR ?? defaultDataDirectory(projectRoot);
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

function defaultDataDirectory(projectRoot: string): string {
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming');
    return existingDevElectronDataDirectory(projectRoot, appData) ?? join(appData, 'Voxmire');
  }

  if (process.platform === 'darwin') {
    const appData = join(homedir(), 'Library', 'Application Support');
    return existingDevElectronDataDirectory(projectRoot, appData) ?? join(appData, 'Voxmire');
  }

  const appData = process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config');
  return existingDevElectronDataDirectory(projectRoot, appData) ?? join(appData, 'Voxmire');
}

function existingDevElectronDataDirectory(projectRoot: string, appData: string): string | null {
  const desktopPackage = join(projectRoot, 'apps', 'desktop', 'package.json');
  const devDataDirectory = join(appData, '@voxmire', 'desktop');
  if (existsSync(desktopPackage) && existsSync(devDataDirectory)) {
    return devDataDirectory;
  }

  return null;
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

function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.max(min, Math.min(max, Math.floor(value)));
}

function buildSeedSegmentText(index: number, wordsPerSegment: number): string {
  const vocabulary = [
    'local',
    'transcript',
    'segment',
    'virtualized',
    'renderer',
    'scroll',
    'stress',
    'sqlite',
    'checkpoint',
    'workspace',
    'progress',
    'audio'
  ];
  const words = Array.from({ length: wordsPerSegment }, (_, wordIndex) => vocabulary[(index + wordIndex) % vocabulary.length]);
  return `Seed segment ${index + 1}. ${words.join(' ')}.`;
}

function sanitizeFileName(value: string): string {
  return value.replace(/[^a-z0-9-_]+/gi, '-').replace(/^-+|-+$/g, '') || 'dev-stress-transcript';
}

export function summarizeJob(jobWithSource: JobWithSource): string {
  return `${jobWithSource.job.id}  ${jobWithSource.job.status.padEnd(12)}  ${Math.round(jobWithSource.job.progress * 100)
    .toString()
    .padStart(3)}%  ${basename(jobWithSource.sourceFile.path)}`;
}
