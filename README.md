# Mac DLNA Casting

一个最小可用的 macOS DLNA Renderer。启动后，手机上的 DLNA 投屏软件可以发现 `Mac DLNA Casting`，并把视频 URL 推送到 Mac 窗口播放。

## 运行

```bash
npm install
npm run build
npm start
```

如果 Electron 下载很慢，可以使用镜像源：

```bash
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npm install
```

## 手机端使用

1. 确保手机和 Mac 在同一个局域网。
2. 启动本应用。
3. 在手机 DLNA App 里选择投屏设备 `Mac DLNA Casting`。
4. 选择视频并投送到该设备。

首次运行时，macOS 可能会弹出本地网络访问权限，请允许，否则手机可能搜不到设备。

窗口底部的 `最近请求` 会显示手机端发来的 DLNA 请求：

- 能看到 `SetAVTransportURI`：Mac 已收到视频地址。
- 能看到 `Play`：手机端已要求播放。
- 能看到 `视频无法播放`：协议已通，问题通常是视频格式、编码或手机端给出的 URL 无法被 Chromium 播放。
- 只能看到 `SSDP search`，看不到 `POST /service/...`：手机发现了设备，但控制请求没有打到 Mac，优先检查本地网络权限、防火墙、手机和 Mac 是否在同一个网段。

## 当前能力

- SSDP 设备发现
- UPnP 设备描述与服务描述
- `AVTransport`：设置视频 URL、播放、暂停、停止、跳转、状态查询
- `RenderingControl`：音量、静音
- `ConnectionManager`：协议能力查询
- Electron 窗口内 HTML5 video 播放

## 当前限制

播放能力取决于 Chromium 的 `<video>`。第一版适合 `mp4`、部分 `mov`、部分 HLS。遇到 `mkv`、部分 `ts`、特殊编码或 HEVC 兼容问题时，后续需要接入 `mpv` 或 `ffmpeg` 做播放器后端。
