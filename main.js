const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');

const isDev = !app.isPackaged;

function getDataPath() {
  return path.join(app.getPath('userData'), 'loreara-data.json');
}

function defaultData() {
  return {
    settings: {
      theme: 'dark',
      authorName: 'Escritor/a',
      ai: {
        provider: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        apiKey: '',
        model: 'gpt-4o-mini'
      }
    },
    stories: [],
    globalDocs: [],
    activityLog: []
  };
}

function loadData() {
  try {
    const p = getDataPath();
    if (!fs.existsSync(p)) {
      const initial = defaultData();
      fs.writeFileSync(p, JSON.stringify(initial, null, 2), 'utf-8');
      return initial;
    }
    const raw = fs.readFileSync(p, 'utf-8');
    const parsed = JSON.parse(raw);
    const base = defaultData();
    return { ...base, ...parsed, settings: { ...base.settings, ...(parsed.settings || {}), ai: { ...base.settings.ai, ...((parsed.settings || {}).ai || {}) } } };
  } catch (err) {
    console.error('Error cargando datos, usando datos por defecto', err);
    return defaultData();
  }
}

function saveData(data) {
  const p = getDataPath();
  fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf-8');
  return true;
}

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#0b0c10',
    title: 'LoreAra',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  if (isDev && process.env.LoreAra_DEVTOOLS) {
    mainWindow.webContents.openDevTools();
  }
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('ai:models', async (_evt, payload) => {
  const { baseUrl, apiKey } = payload;
  if (!apiKey) return { ok: false, error: 'Falta la API Key.' };
  try {
    const url = `${(baseUrl || 'https://api.openai.com/v1').replace(/\/$/, '')}/models`;
    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    };
    if (baseUrl && baseUrl.includes('openrouter.ai')) {
      headers['HTTP-Referer'] = 'https://loreara.app';
      headers['X-Title'] = 'LoreAra Desktop';
    }
    const res = await fetch(url, { method: 'GET', headers });
    if (!res.ok) {
      const errText = await res.text();
      return { ok: false, error: `Error ${res.status}: ${errText.slice(0, 300)}` };
    }
    const json = await res.json();
    const list = json.data || json.models || [];
    const models = list.map(m => m.id || m.name || m).filter(Boolean);
    return { ok: true, models };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
});

ipcMain.handle('data:load', async () => {
  return loadData();
});

ipcMain.handle('data:save', async (_evt, data) => {
  return saveData(data);
});

ipcMain.handle('data:exportFile', async (_evt, data) => {
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: 'Exportar datos de LoreAra',
    defaultPath: 'loreara-backup.json',
    filters: [{ name: 'JSON', extensions: ['json'] }]
  });
  if (canceled || !filePath) return { ok: false };
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  return { ok: true, filePath };
});

ipcMain.handle('data:importFile', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: 'Importar datos de LoreAra',
    filters: [{ name: 'JSON', extensions: ['json'] }],
    properties: ['openFile']
  });
  if (canceled || !filePaths[0]) return { ok: false };
  try {
    const raw = fs.readFileSync(filePaths[0], 'utf-8');
    const parsed = JSON.parse(raw);
    saveData(parsed);
    return { ok: true, data: parsed };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
});

ipcMain.handle('shell:openExternal', async (_evt, url) => {
  await shell.openExternal(url);
});

ipcMain.handle('ai:generate', async (_evt, payload) => {
  const { provider, baseUrl, apiKey, model, messages, maxTokens } = payload;

  if (!apiKey) {
    return { ok: false, error: 'Falta configurar tu API Key en Ajustes > Muse AI.' };
  }

  try {
    const url = `${(baseUrl || 'https://api.openai.com/v1').replace(/\/$/, '')}/chat/completions`;
    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    };

    if (baseUrl && baseUrl.includes('openrouter.ai')) {
      headers['HTTP-Referer'] = 'https://loreara.app';
      headers['X-Title'] = 'LoreAra Desktop';
    }

    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: model || 'gpt-4o-mini',
        messages,
        max_tokens: maxTokens || 500,
        temperature: 0.9
      })
    });

    if (!res.ok) {
      const errText = await res.text();
      return { ok: false, error: `Error API (${res.status}): ${errText.slice(0, 400)}` };
    }

    const json = await res.json();
    const text = json?.choices?.[0]?.message?.content || '';
    return { ok: true, text };
  } catch (err) {
    return { ok: false, error: `No se pudo conectar con el proveedor de IA: ${String(err)}` };
  }
});
