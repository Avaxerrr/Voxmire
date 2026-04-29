import { app, screen, type BrowserWindow, type Rectangle } from 'electron';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const minimumWindowWidth = 1024;
export const minimumWindowHeight = 680;

const defaultWindowBounds = {
  width: 1280,
  height: 820
};

type WindowBounds = {
  height: number;
  width: number;
  x?: number;
  y?: number;
};

export type WindowState = WindowBounds & {
  isMaximized: boolean;
};

export function attachWindowStatePersistence(window: BrowserWindow): void {
  let saveTimer: ReturnType<typeof setTimeout> | null = null;

  const scheduleSave = (): void => {
    if (window.isDestroyed() || window.isMinimized()) {
      return;
    }

    if (saveTimer) {
      clearTimeout(saveTimer);
    }

    saveTimer = setTimeout(() => {
      saveTimer = null;
      saveWindowState(window);
    }, 400);
  };

  window.on('move', scheduleSave);
  window.on('resize', scheduleSave);
  window.on('maximize', scheduleSave);
  window.on('unmaximize', scheduleSave);
  window.on('close', () => {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    saveWindowState(window);
  });
}

export function loadWindowState(): WindowState | null {
  try {
    const parsed = JSON.parse(readFileSync(windowStatePath(), 'utf8')) as Partial<WindowState>;
    const bounds = normalizeWindowBounds(parsed);
    if (!bounds || !windowBoundsAreVisible(bounds)) {
      return null;
    }

    return {
      ...bounds,
      isMaximized: parsed.isMaximized === true
    };
  } catch {
    return null;
  }
}

export function windowStateToBrowserBounds(state: WindowState | null): WindowBounds {
  if (!state) {
    return defaultWindowBounds;
  }

  return {
    ...(state.x !== undefined ? { x: state.x } : {}),
    ...(state.y !== undefined ? { y: state.y } : {}),
    width: state.width,
    height: state.height
  };
}

function saveWindowState(window: BrowserWindow): void {
  if (window.isDestroyed() || window.isMinimized()) {
    return;
  }

  const bounds = window.isMaximized() ? window.getNormalBounds() : window.getBounds();
  const state: WindowState = {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    isMaximized: window.isMaximized()
  };

  try {
    writeFileSync(windowStatePath(), JSON.stringify(state, null, 2), 'utf8');
  } catch {
    // Window state is a best-effort UI preference.
  }
}

function normalizeWindowBounds(value: Partial<WindowBounds>): WindowBounds | null {
  if (!Number.isFinite(value.width) || !Number.isFinite(value.height)) {
    return null;
  }

  const width = Math.max(minimumWindowWidth, Math.round(value.width ?? defaultWindowBounds.width));
  const height = Math.max(minimumWindowHeight, Math.round(value.height ?? defaultWindowBounds.height));
  const x = Number.isFinite(value.x) ? Math.round(value.x as number) : undefined;
  const y = Number.isFinite(value.y) ? Math.round(value.y as number) : undefined;

  return {
    ...(x !== undefined ? { x } : {}),
    ...(y !== undefined ? { y } : {}),
    width,
    height
  };
}

function windowBoundsAreVisible(bounds: WindowBounds): boolean {
  if (bounds.x === undefined || bounds.y === undefined) {
    return true;
  }

  const visibleBounds = { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
  return screen.getAllDisplays().some((display) => rectanglesIntersect(visibleBounds, display.workArea));
}

function rectanglesIntersect(first: Required<WindowBounds>, second: Rectangle): boolean {
  return (
    first.x < second.x + second.width &&
    first.x + first.width > second.x &&
    first.y < second.y + second.height &&
    first.y + first.height > second.y
  );
}

function windowStatePath(): string {
  return join(app.getPath('userData'), 'window-state.json');
}
