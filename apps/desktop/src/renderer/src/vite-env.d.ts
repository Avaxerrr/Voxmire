/// <reference types="vite/client" />

type VoxmireAppInfo = {
  name: string;
  version: string;
  platform: string;
  arch: string;
};

declare global {
  interface Window {
    voxmire: {
      app: {
        getInfo: () => Promise<VoxmireAppInfo>;
      };
    };
  }
}

export {};
