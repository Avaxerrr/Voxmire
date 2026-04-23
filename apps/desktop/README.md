# Voxmire Desktop

Electron desktop app for Voxmire.

This app owns platform-specific desktop behavior:

- Windows, macOS, and Linux app shell
- Native file dialogs
- IPC bridge
- App packaging
- Auto-update flow
- Local binary resource resolution

Reusable product behavior should live in `packages/*`.
