// Main process: window lifecycle and file IO only; all drawing lives in the renderer.
const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const fs = require('fs');
const path = require('path');

// Rasterise on the GPU; frame pacing is left to the compositor, which tracks the panel's true refresh rate.
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

let win = null;

// Creates the single frameless-feeling window that hosts the paper.
function createWindow() {
  win = new BrowserWindow({
    width: 1280, height: 800, backgroundColor: '#f4efe6', autoHideMenuBar: true,
    title: 'Calligraphy',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false }
  });
  win.setMenu(null);
  win.loadFile(path.join(__dirname, 'index.html'));
}

// Shows the standard open dialog and returns the chosen markdown or text file's path and contents.
async function openFile() {
  const r = await dialog.showOpenDialog(win, { filters: [{ name: 'Markdown & Text', extensions: ['md', 'markdown', 'txt'] }, { name: 'All Files', extensions: ['*'] }], properties: ['openFile'] });
  if (r.canceled || !r.filePaths[0]) return null;
  return { path: r.filePaths[0], text: fs.readFileSync(r.filePaths[0], 'utf8') };
}

// Writes text to the known path, or asks with the standard save dialog when the file is new.
async function saveFile(_e, { path: p, text }) {
  let target = p;
  if (!target) {
    const r = await dialog.showSaveDialog(win, { filters: [{ name: 'Markdown', extensions: ['md'] }, { name: 'Text', extensions: ['txt'] }], defaultPath: 'notes.md' });
    if (r.canceled || !r.filePath) return null;
    target = r.filePath;
  }
  fs.writeFileSync(target, text, 'utf8');
  return target;
}

app.whenReady().then(() => {
  ipcMain.handle('file:open', openFile);
  ipcMain.handle('file:save', saveFile);
  createWindow();
});
app.on('window-all-closed', () => app.quit());
