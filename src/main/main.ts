import { app, BrowserWindow, ipcMain, Menu } from "electron";
import path from "node:path";
import crypto from "node:crypto";
import { DlnaCommand, DlnaLogEntry, DlnaRenderer, DlnaStatus, PlaybackSnapshot } from "./upnp/dlnaRenderer";

let mainWindow: BrowserWindow | null = null;
let renderer: DlnaRenderer | null = null;
let rendererReady = false;
let lastStatus: DlnaStatus | null = null;
const pendingCommands: DlnaCommand[] = [];
const recentLogs: DlnaLogEntry[] = [];

app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");

function createWindow() {
  rendererReady = false;
  mainWindow = new BrowserWindow({
    width: 1080,
    height: 720,
    minWidth: 720,
    minHeight: 480,
    backgroundColor: "#111418",
    title: "Mac DLNA Casting",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
    rendererReady = false;
  });

  mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
}

function sendToRenderer(channel: string, payload: unknown) {
  if (!mainWindow || mainWindow.webContents.isDestroyed() || !rendererReady) {
    return false;
  }

  mainWindow.webContents.send(channel, payload);
  return true;
}

function deliverCommand(command: DlnaCommand) {
  if (sendToRenderer("dlna-command", command)) {
    console.log(`[IPC] sent command ${command.type}`);
    return;
  }

  console.log(`[IPC] queued command ${command.type}`);
  pendingCommands.push(command);
}

function deliverStatus(status: DlnaStatus) {
  lastStatus = status;
  sendToRenderer("dlna-status", status);
}

function deliverLog(entry: DlnaLogEntry) {
  recentLogs.push(entry);
  recentLogs.splice(0, Math.max(0, recentLogs.length - 20));
  sendToRenderer("dlna-log", entry);
}

function flushRendererState() {
  if (!mainWindow || mainWindow.webContents.isDestroyed()) {
    return;
  }

  if (lastStatus) {
    mainWindow.webContents.send("dlna-status", lastStatus);
  }

  for (const entry of recentLogs) {
    mainWindow.webContents.send("dlna-log", entry);
  }

  while (pendingCommands.length > 0) {
    const command = pendingCommands.shift();
    if (command) {
      console.log(`[IPC] flushed command ${command.type}`);
      mainWindow.webContents.send("dlna-command", command);
    }
  }
}

function getPersistentUuid() {
  const key = "dlna-renderer-uuid";
  const existing = app.getPath("userData");
  const seed = `${existing}:mac-dlna-casting:v2`;
  return crypto.createHash("sha1").update(seed).digest("hex").replace(
    /^(.{8})(.{4})(.{4})(.{4})(.{12}).*$/,
    "$1-$2-$3-$4-$5"
  );
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  createWindow();

  renderer = new DlnaRenderer({
    friendlyName: "Mac DLNA Casting",
    uuid: getPersistentUuid(),
    onCommand: (command) => {
      deliverCommand(command);
    },
    onStatus: (status) => {
      deliverStatus(status);
    },
    onLog: (entry) => {
      deliverLog(entry);
    }
  });

  await renderer.start();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

ipcMain.on("playback-state", (_event, snapshot: PlaybackSnapshot) => {
  renderer?.updatePlayback(snapshot);
});

ipcMain.on("renderer-ready", () => {
  rendererReady = true;
  console.log("[IPC] renderer ready");
  flushRendererState();
});

app.on("before-quit", () => {
  renderer?.stop();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
