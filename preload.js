const { contextBridge, ipcRenderer } = require('electron');

let aiRequestCounter = 0;
function invokeAiGenerate(payload = {}) {
  const { signal, ...serializable } = payload;
  const requestId = `ai_${Date.now()}_${++aiRequestCounter}`;
  const cancel = () => ipcRenderer.send('ai:cancel', requestId);
  if (signal && typeof signal.addEventListener === 'function') signal.addEventListener('abort', cancel, { once:true });
  const pending = ipcRenderer.invoke('ai:generate', { ...serializable, requestId });
  if (signal && signal.aborted) cancel();
  return pending.finally(() => {
    if (signal && typeof signal.removeEventListener === 'function') signal.removeEventListener('abort', cancel);
  });
}

contextBridge.exposeInMainWorld('lorevinci', {
  loadData: () => ipcRenderer.invoke('data:load'),
  saveData: (data) => ipcRenderer.invoke('data:save', data),
  exportFile: (data) => ipcRenderer.invoke('data:exportFile', data),
  importFile: () => ipcRenderer.invoke('data:importFile'),
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  aiGenerate: invokeAiGenerate,
  aiModels: (payload) => ipcRenderer.invoke('ai:models', payload),
  aiVerify: (payload) => ipcRenderer.invoke('ai:verify', payload),
  omniRouteStatus: (payload) => ipcRenderer.invoke('ai:omnirouteStatus', payload),
  webSearch: (payload) => ipcRenderer.invoke('web:search', payload),
  webFetch: (payload) => ipcRenderer.invoke('web:fetch', payload),
  isDesktop: true
});
