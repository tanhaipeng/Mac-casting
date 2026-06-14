import { contextBridge, ipcRenderer } from "electron";
import type { DlnaCommand, DlnaLogEntry, DlnaStatus, PlaybackSnapshot } from "./upnp/dlnaRenderer";

contextBridge.exposeInMainWorld("casting", {
  ready() {
    ipcRenderer.send("renderer-ready");
  },
  onCommand(callback: (command: DlnaCommand) => void) {
    ipcRenderer.on("dlna-command", (_event, command: DlnaCommand) => callback(command));
  },
  onStatus(callback: (status: DlnaStatus) => void) {
    ipcRenderer.on("dlna-status", (_event, status: DlnaStatus) => callback(status));
  },
  onLog(callback: (entry: DlnaLogEntry) => void) {
    ipcRenderer.on("dlna-log", (_event, entry: DlnaLogEntry) => callback(entry));
  },
  sendPlaybackState(snapshot: PlaybackSnapshot) {
    ipcRenderer.send("playback-state", snapshot);
  }
});
