import { BrowserWindow, nativeTheme, shell } from 'electron';
import { join } from 'node:path';
import {
  attachWindowStatePersistence,
  loadWindowState,
  minimumWindowHeight,
  minimumWindowWidth,
  windowStateToBrowserBounds
} from './window-state';

export type MainWindowOptions = {
  isDev: boolean;
  rendererUrl: string | undefined;
};

export function createMainWindow(options: MainWindowOptions): void {
  const windowState = loadWindowState();
  const mainWindow = new BrowserWindow({
    ...windowStateToBrowserBounds(windowState),
    minWidth: minimumWindowWidth,
    minHeight: minimumWindowHeight,
    title: 'Voxmire',
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#111318' : '#f6f7f9',
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  attachWindowStatePersistence(mainWindow);
  if (windowState?.isMaximized) {
    mainWindow.maximize();
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  attachDevelopmentShortcuts(mainWindow, options.isDev);

  if (options.isDev && options.rendererUrl) {
    void mainWindow.loadURL(options.rendererUrl);
    return;
  }

  void mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
}

function attachDevelopmentShortcuts(window: BrowserWindow, isDev: boolean): void {
  if (!isDev) {
    return;
  }

  window.webContents.on('before-input-event', (event, input) => {
    const key = input.key.toLowerCase();
    const commandModifier = input.control || input.meta;

    if (input.key === 'F12' || (commandModifier && input.shift && key === 'i')) {
      event.preventDefault();
      window.webContents.toggleDevTools();
      return;
    }

    if (commandModifier && input.alt && input.shift && key === 'd') {
      event.preventDefault();
      void window.webContents.executeJavaScript(`
        (() => {
          const key = 'voxmire:playbackDiagnostics';
          const enabled = window.localStorage.getItem(key) === '1';
          if (enabled) {
            window.localStorage.removeItem(key);
          } else {
            window.localStorage.setItem(key, '1');
          }
          window.dispatchEvent(new CustomEvent('voxmire:playbackDiagnosticsChanged', { detail: { enabled: !enabled } }));
          console.info('[voxmire:playbackDiagnostics]', enabled ? 'disabled' : 'enabled');
          return !enabled;
        })();
      `);
      window.webContents.openDevTools({ mode: 'detach' });
    }
  });
}
