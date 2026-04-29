import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { VoxmireRuntimeLogEvent, VoxmireRuntimeLogger } from './types';

export function createJsonlRuntimeLogger(filePath: string): VoxmireRuntimeLogger {
  mkdirSync(dirname(filePath), { recursive: true });
  return {
    log: (event) => {
      const entry: VoxmireRuntimeLogEvent = {
        timestamp: new Date().toISOString(),
        ...event
      };
      appendFileSync(filePath, `${JSON.stringify(entry)}\n`, 'utf8');
    }
  };
}