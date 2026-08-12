const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('lorevinci', {
  loadData: () => ipcRenderer.invoke('data:load'),
  saveData: (data) => ipcRenderer.invoke('data:save', data),
  exportFile: (data) => ipcRenderer.invoke('data:exportFile', data),
  importFile: () => ipcRenderer.invoke('data:importFile'),
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  aiGenerate: (payload) => ipcRenderer.invoke('ai:generate', payload)
});
