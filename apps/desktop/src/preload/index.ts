import { contextBridge, ipcRenderer } from 'electron';

const api = {
  app: {
    getInfo: () => ipcRenderer.invoke('app:get-info')
  }
};

contextBridge.exposeInMainWorld('voxmire', api);
