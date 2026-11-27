import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('desktop', {
  isDesktop: true,
  platform: process.platform,
  version: process.versions.electron,
  closeQuickAdd: () => ipcRenderer.send('quick-add:close'),
  resizeQuickAdd: (height: number) => ipcRenderer.send('quick-add:resize', height),
  openSettings: () => ipcRenderer.send('app:open-settings'),
  openMain: () => ipcRenderer.send('app:show-main'),
});
