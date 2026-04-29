import { spawn } from 'node:child_process';
import { basename } from 'node:path';

export type ProcessResult = {
  stdout: string;
  stderr: string;
};

export type CommandDetectionResult = {
  available: boolean;
  output: string | null;
};

export class AsyncValueQueue<T> implements AsyncIterable<T> {
  private readonly values: T[] = [];
  private readonly waiters: Array<(result: IteratorResult<T>) => void> = [];
  private closed = false;

  push(value: T): void {
    if (this.closed) {
      return;
    }

    const waiter = this.waiters.shift();
    if (waiter) {
      waiter({ value, done: false });
      return;
    }

    this.values.push(value);
  }

  close(): void {
    this.closed = true;
    for (const waiter of this.waiters.splice(0)) {
      waiter({ value: undefined, done: true });
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        const value = this.values.shift();
        if (value !== undefined) {
          return Promise.resolve({ value, done: false });
        }

        if (this.closed) {
          return Promise.resolve({ value: undefined, done: true });
        }

        return new Promise<IteratorResult<T>>((resolve) => this.waiters.push(resolve));
      }
    };
  }
}

export function detectCommand(command: string, args: readonly string[], timeoutMilliseconds: number): Promise<CommandDetectionResult> {
  return new Promise((resolve) => {
    const child = spawn(command, [...args], { windowsHide: true });
    const chunks: string[] = [];
    let settled = false;
    const finish = (result: CommandDetectionResult) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      child.kill();
      finish({ available: false, output: null });
    }, timeoutMilliseconds);

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => chunks.push(chunk));
    child.stderr.on('data', (chunk: string) => chunks.push(chunk));
    child.on('error', () => finish({ available: false, output: null }));
    child.on('close', (code: number | null) => {
      finish({ available: code === 0, output: chunks.join('').trim() || null });
    });
  });
}

export function runProcess(
  executablePath: string,
  args: readonly string[],
  onLine?: (line: string) => void,
  signal?: AbortSignal
): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(executablePath, [...args], { windowsHide: true });
    const abort = () => child.kill();
    const stdoutChunks: string[] = [];
    const stderrChunks: string[] = [];

    signal?.addEventListener('abort', abort, { once: true });
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');

    child.stdout.on('data', (chunk: string) => {
      stdoutChunks.push(chunk);
      emitLines(chunk, onLine);
    });

    child.stderr.on('data', (chunk: string) => {
      stderrChunks.push(chunk);
      emitLines(chunk, onLine);
    });

    child.on('error', (error) => {
      signal?.removeEventListener('abort', abort);
      reject(error);
    });

    child.on('close', (code: number | null) => {
      signal?.removeEventListener('abort', abort);
      const stdout = stdoutChunks.join('');
      const stderr = stderrChunks.join('');

      if (signal?.aborted) {
        reject(new Error(`${basename(executablePath)} was canceled.`));
        return;
      }

      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      reject(new Error(`${basename(executablePath)} exited with code ${code}: ${stderr || stdout}`));
    });
  });
}

function emitLines(chunk: string, onLine?: (line: string) => void): void {
  if (!onLine) {
    return;
  }

  for (const line of chunk.split(/\r\n|\n|\r/)) {
    if (line.trim()) {
      onLine(line);
    }
  }
}
