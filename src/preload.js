// Preload bridge: exposes exactly two file operations to the renderer, nothing else.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('files', {
  // Asks the main process to open a text file via the native dialog.
  open: () => ipcRenderer.invoke('file:open'),
  // Asks the main process to save text, prompting natively if no path is known.
  save: (path, text) => ipcRenderer.invoke('file:save', { path, text })
});
