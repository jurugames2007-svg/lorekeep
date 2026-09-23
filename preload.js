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
  // La API Key ya no vive en el JSON de datos: se guarda cifrada con safeStorage
  // del sistema operativo y el renderer la pide/suelta por estos canales.
  secretsGet: () => ipcRenderer.invoke('secrets:get'),
  secretsSet: (apiKey) => ipcRenderer.invoke('secrets:set', apiKey),
  secretsStatus: () => ipcRenderer.invoke('secrets:status'),
  clipboardWrite: (text) => ipcRenderer.invoke('clipboard:write', text),
  systemScanHardware: () => ipcRenderer.invoke('system:scanHardware'),
  // Permite a la UI informar el estado real del almacenamiento del secreto.
  onAppEvent: (channel, callback) => {
    const allowed = ['app:save-failed', 'app:navigation-blocked'];
    if (!allowed.includes(channel)) return () => {};
    const listener = (_evt, payload) => callback(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
  isDesktop: true
});
