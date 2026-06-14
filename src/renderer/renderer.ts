type DlnaCommand =
  | { type: "load"; uri: string; playbackUri: string; metadata: string }
  | { type: "play" }
  | { type: "pause" }
  | { type: "stop" }
  | { type: "seek"; seconds: number }
  | { type: "volume"; volume: number }
  | { type: "mute"; muted: boolean };

type DlnaStatus = {
  friendlyName: string;
  address: string;
  port: number;
};

type DlnaLogEntry = {
  level: "info" | "warn" | "error";
  message: string;
  detail?: string;
};

type PlaybackSnapshot = {
  currentTime: number;
  duration: number;
  paused: boolean;
  ended: boolean;
  src: string;
};

interface Window {
  casting: {
    ready(): void;
    onCommand(callback: (command: DlnaCommand) => void): void;
    onStatus(callback: (status: DlnaStatus) => void): void;
    onLog(callback: (entry: DlnaLogEntry) => void): void;
    sendPlaybackState(snapshot: PlaybackSnapshot): void;
  };
}

const player = queryRequired<HTMLVideoElement>("#player");
const emptyState = queryRequired<HTMLDivElement>("#emptyState");
const statusEl = queryRequired<HTMLParagraphElement>("#status");
const deviceName = queryRequired<HTMLSpanElement>("#deviceName");
const nowPlaying = queryRequired<HTMLSpanElement>("#nowPlaying");
const logPanel = queryRequired<HTMLElement>("#logPanel");
const logToggle = queryRequired<HTMLButtonElement>("#logToggle");
const logList = queryRequired<HTMLOListElement>("#logList");

function queryRequired<T extends Element>(selector: string) {
  const element = document.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Missing required element: ${selector}`);
  }
  return element;
}

let currentUri = "";
const logs: DlnaLogEntry[] = [];
let logExpanded = false;

function showPlayer(show: boolean) {
  player.classList.toggle("is-visible", show);
  emptyState.classList.toggle("is-hidden", show);
}

function sendSnapshot() {
  window.casting.sendPlaybackState({
    currentTime: Number.isFinite(player.currentTime) ? player.currentTime : 0,
    duration: Number.isFinite(player.duration) ? player.duration : 0,
    paused: player.paused,
    ended: player.ended,
    src: currentUri
  });
}

function logPlayerEvent(message: string, detail = currentUri) {
  appendLog({ level: "info", message, detail });
}

async function safePlay() {
  try {
    await player.play();
    showPlayer(true);
    statusEl.textContent = "正在播放";
    logPlayerEvent("播放器已开始播放");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    statusEl.textContent = `播放失败：${message}`;
    const entry = { level: "error" as const, message: "播放器播放失败", detail: message };
    appendLog(entry);
  }
}

function appendLog(entry: DlnaLogEntry) {
  logs.unshift(entry);
  logs.splice(8);
  logList.replaceChildren(...logs.map((item) => {
    const row = document.createElement("li");
    row.className = item.level;

    const message = document.createElement("span");
    message.textContent = item.message;

    const detail = document.createElement("small");
    detail.textContent = item.detail ?? "";

    row.append(message, detail);
    return row;
  }));
}

function setLogExpanded(expanded: boolean) {
  logExpanded = expanded;
  logPanel.classList.toggle("is-hidden", !expanded);
  logToggle.setAttribute("aria-expanded", String(expanded));
}

window.casting.onStatus((nextStatus) => {
  deviceName.textContent = `${nextStatus.friendlyName} · ${nextStatus.address}`;
  statusEl.textContent = `已启动，等待手机 DLNA App 推送视频`;
});

window.casting.onCommand((command) => {
  appendLog({
    level: "info",
    message: `播放器命令：${command.type}`,
    detail: command.type === "load" ? command.playbackUri : ""
  });

  switch (command.type) {
    case "load": {
      currentUri = command.uri;
      player.src = command.playbackUri;
      player.load();
      nowPlaying.textContent = command.uri;
      appendLog({ level: "info", message: "播放器代理地址", detail: command.playbackUri });
      statusEl.textContent = "已收到视频，正在尝试播放";
      showPlayer(true);
      window.setTimeout(() => {
        if (currentUri === command.uri && player.paused) {
          safePlay();
        }
      }, 150);
      break;
    }
    case "play":
      safePlay();
      break;
    case "pause":
      player.pause();
      break;
    case "stop":
      player.pause();
      player.removeAttribute("src");
      player.load();
      currentUri = "";
      nowPlaying.textContent = "暂无视频";
      statusEl.textContent = "已停止，等待下一次投屏";
      showPlayer(false);
      break;
    case "seek":
      player.currentTime = command.seconds;
      break;
    case "volume":
      player.volume = Math.max(0, Math.min(1, command.volume / 100));
      break;
    case "mute":
      player.muted = command.muted;
      break;
  }

  sendSnapshot();
});

player.addEventListener("play", sendSnapshot);
player.addEventListener("pause", sendSnapshot);
player.addEventListener("ended", sendSnapshot);
player.addEventListener("timeupdate", sendSnapshot);
player.addEventListener("durationchange", sendSnapshot);
player.addEventListener("loadstart", () => logPlayerEvent("视频开始加载"));
player.addEventListener("loadedmetadata", () => {
  logPlayerEvent("已读取视频信息", `duration=${Number.isFinite(player.duration) ? player.duration.toFixed(1) : "unknown"} src=${currentUri}`);
  sendSnapshot();
});
player.addEventListener("canplay", () => logPlayerEvent("视频可以播放"));
player.addEventListener("playing", () => {
  logPlayerEvent("视频正在播放");
  sendSnapshot();
});
player.addEventListener("waiting", () => logPlayerEvent("视频缓冲中"));
player.addEventListener("stalled", () => appendLog({ level: "warn", message: "视频加载停滞", detail: currentUri }));
player.addEventListener("error", () => {
  const mediaError = player.error;
  statusEl.textContent = mediaError ? `视频无法播放，错误代码 ${mediaError.code}` : "视频无法播放";
  const entry = {
    level: "error" as const,
    message: "视频无法播放",
    detail: mediaError ? `code=${mediaError.code} src=${currentUri}` : currentUri
  };
  appendLog(entry);
  sendSnapshot();
});

window.casting.onLog(appendLog);
document.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === "l") {
    event.preventDefault();
    setLogExpanded(!logExpanded);
  }
});
window.casting.ready();
