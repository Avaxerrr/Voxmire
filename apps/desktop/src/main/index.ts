import { app, BrowserWindow, ipcMain, nativeTheme, shell } from 'electron';
import { join } from 'node:path';

const isDev = !app.isPackaged;

function createMainWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1024,
    minHeight: 680,
    title: 'Voxmire',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#111318' : '#f6f7f9',
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  if (isDev && process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
    return;
  }

  void mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
}

ipcMain.handle('app:get-info', () => ({
  name: 'Voxmire',
  version: app.getVersion(),
  platform: process.platform,
  arch: process.arch
}));

void app.whenReady().then(() => {
  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
