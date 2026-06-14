import dgram from "node:dgram";
import http, { IncomingMessage, ServerResponse } from "node:http";
import https from "node:https";
import os from "node:os";
import {
  AV_TRANSPORT,
  CONNECTION_MANAGER,
  MEDIA_RENDERER,
  RENDERING_CONTROL,
  avTransportScpd,
  connectionManagerScpd,
  deviceDescription,
  renderingControlScpd
} from "./descriptions";
import { escapeXml, getSoapValue, soapEnvelope, soapFault } from "./xml";

type TransportState = "STOPPED" | "PLAYING" | "PAUSED_PLAYBACK" | "TRANSITIONING";

export type DlnaCommand =
  | { type: "load"; uri: string; playbackUri: string; metadata: string }
  | { type: "play" }
  | { type: "pause" }
  | { type: "stop" }
  | { type: "seek"; seconds: number }
  | { type: "volume"; volume: number }
  | { type: "mute"; muted: boolean };

export type DlnaStatus = {
  friendlyName: string;
  address: string;
  port: number;
};

export type DlnaLogEntry = {
  level: "info" | "warn" | "error";
  message: string;
  detail?: string;
};

export type PlaybackSnapshot = {
  currentTime: number;
  duration: number;
  paused: boolean;
  ended: boolean;
  src: string;
};

type DlnaRendererOptions = {
  friendlyName: string;
  uuid: string;
  onCommand: (command: DlnaCommand) => void;
  onStatus: (status: DlnaStatus) => void;
  onLog?: (entry: DlnaLogEntry) => void;
};

const MULTICAST_ADDRESS = "239.255.255.250";
const SSDP_PORT = 1900;
const DEFAULT_HTTP_PORT = Number.parseInt(process.env.DLNA_HTTP_PORT ?? "49356", 10);
const RESPONSE_DELAY_MS = 80;
const ALIVE_INTERVAL_MS = 60_000;
const SSDP_MAX_AGE = 120;

const SEARCH_TARGETS = [
  "upnp:rootdevice",
  MEDIA_RENDERER,
  AV_TRANSPORT,
  CONNECTION_MANAGER,
  RENDERING_CONTROL
];

const KNOWN_SOAP_ACTIONS = [
  "SetAVTransportURI",
  "SetNextAVTransportURI",
  "Play",
  "Pause",
  "Stop",
  "Seek",
  "GetTransportInfo",
  "GetPositionInfo",
  "GetMediaInfo",
  "GetCurrentTransportActions",
  "GetDeviceCapabilities",
  "GetTransportSettings",
  "SetPlayMode",
  "GetProtocolInfo",
  "GetCurrentConnectionIDs",
  "GetCurrentConnectionInfo",
  "PrepareForConnection",
  "ConnectionComplete",
  "SetVolume",
  "GetVolume",
  "SetMute",
  "GetMute"
];

export class DlnaRenderer {
  private httpServer?: http.Server;
  private ssdpSocket?: dgram.Socket;
  private aliveTimer?: NodeJS.Timeout;
  private port = 0;
  private state: TransportState = "STOPPED";
  private currentUri = "";
  private currentMetadata = "";
  private volume = 60;
  private muted = false;
  private playback: PlaybackSnapshot = {
    currentTime: 0,
    duration: 0,
    paused: true,
    ended: false,
    src: ""
  };

  constructor(private readonly options: DlnaRendererOptions) {}

  async start() {
    await this.startHttpServer();
    await this.startSsdp();

    const address = getPrimaryAddress();
    this.options.onStatus({
      friendlyName: this.options.friendlyName,
      address: `${address}:${this.port}`,
      port: this.port
    });

    this.sendAliveNotifications();
    this.aliveTimer = setInterval(() => this.sendAliveNotifications(), ALIVE_INTERVAL_MS);
    this.log("info", "DLNA renderer started", `${address}:${this.port}`);
  }

  stop() {
    if (this.aliveTimer) {
      clearInterval(this.aliveTimer);
    }

    this.sendByebyeNotifications();
    this.ssdpSocket?.close();
    this.httpServer?.close();
    this.log("info", "DLNA renderer stopped");
  }

  updatePlayback(snapshot: PlaybackSnapshot) {
    this.playback = snapshot;
    if (snapshot.ended) {
      this.state = "STOPPED";
    } else if (snapshot.paused && this.state === "PLAYING") {
      this.state = "PAUSED_PLAYBACK";
    }
  }

  private async startHttpServer() {
    this.httpServer = http.createServer((request, response) => {
      this.handleHttpRequest(request, response).catch((error) => {
        console.error(error);
        response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
        response.end("Internal Server Error");
      });
    });

    await this.listenHttp(DEFAULT_HTTP_PORT);
  }

  private listenHttp(port: number) {
    return new Promise<void>((resolve, reject) => {
      const onError = (error: NodeJS.ErrnoException) => {
        this.httpServer?.off("listening", onListening);
        if (port !== 0 && error.code === "EADDRINUSE") {
          this.log("warn", "Fixed HTTP port is busy, falling back to random port", String(port));
          this.listenHttp(0).then(resolve, reject);
          return;
        }
        reject(error);
      };

      const onListening = () => {
        this.httpServer?.off("error", onError);
        const address = this.httpServer?.address();
        if (address && typeof address === "object") {
          this.port = address.port;
        }
        resolve();
      };

      this.httpServer?.once("error", onError);
      this.httpServer?.once("listening", onListening);
      this.httpServer?.listen(port, "0.0.0.0");
    });
  }

  private async startSsdp() {
    this.ssdpSocket = dgram.createSocket({ type: "udp4", reuseAddr: true });

    this.ssdpSocket.on("message", (message, remote) => {
      this.handleSsdpMessage(message.toString("utf8"), remote.address, remote.port);
    });

    await new Promise<void>((resolve, reject) => {
      this.ssdpSocket?.once("error", reject);
      this.ssdpSocket?.bind(SSDP_PORT, () => {
        this.ssdpSocket?.addMembership(MULTICAST_ADDRESS);
        this.ssdpSocket?.setMulticastTTL(4);
        this.ssdpSocket?.setMulticastLoopback(false);
        resolve();
      });
    });
  }

  private async handleHttpRequest(request: IncomingMessage, response: ServerResponse) {
    const method = request.method ?? "GET";
    const url = normalizePath(request.url ?? "/");
    this.log("info", `${method} ${url}`, request.headers["user-agent"]);

    if (method === "GET" && url === "/description.xml") {
      this.respondXml(response, deviceDescription({
        friendlyName: this.options.friendlyName,
        uuid: this.options.uuid,
        baseUrl: `http://${request.headers.host ?? `127.0.0.1:${this.port}`}/`
      }));
      return;
    }

    if (method === "GET" && url === "/proxy") {
      this.proxyMedia(request, response);
      return;
    }

    if (method === "GET" && url === "/service/AVTransport/scpd.xml") {
      this.respondXml(response, avTransportScpd());
      return;
    }

    if (method === "GET" && url === "/service/ConnectionManager/scpd.xml") {
      this.respondXml(response, connectionManagerScpd());
      return;
    }

    if (method === "GET" && url === "/service/RenderingControl/scpd.xml") {
      this.respondXml(response, renderingControlScpd());
      return;
    }

    if (method === "POST" && url === "/service/AVTransport/control") {
      await this.handleSoap(request, response, AV_TRANSPORT);
      return;
    }

    if (method === "POST" && url === "/service/ConnectionManager/control") {
      await this.handleSoap(request, response, CONNECTION_MANAGER);
      return;
    }

    if (method === "POST" && url === "/service/RenderingControl/control") {
      await this.handleSoap(request, response, RENDERING_CONTROL);
      return;
    }

    if ((method === "SUBSCRIBE" || method === "UNSUBSCRIBE") && url.includes("/event")) {
      response.writeHead(200, {
        SID: `uuid:${this.options.uuid}`,
        TIMEOUT: "Second-1800",
        "Content-Length": "0"
      });
      response.end();
      return;
    }

    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not Found");
  }

  private async handleSoap(request: IncomingMessage, response: ServerResponse, serviceType: string) {
    const body = await readBody(request);
    const action = getSoapAction(request.headers.soapaction, body);
    this.log("info", `${serviceName(serviceType)}#${action || "UnknownAction"}`, summarizeSoapBody(body));

    let responseXml: string;
    let statusCode = 200;

    try {
      responseXml = this.dispatchSoap(serviceType, action, body);
    } catch (error) {
      statusCode = 500;
      const message = error instanceof Error ? error.message : "Unknown error";
      this.log("error", message, `${serviceName(serviceType)}#${action || "UnknownAction"}`);
      responseXml = soapFault(401, message);
    }

    response.writeHead(statusCode, {
      "Content-Type": "text/xml; charset=utf-8",
      "Content-Length": Buffer.byteLength(responseXml)
    });
    response.end(responseXml);
  }

  private dispatchSoap(serviceType: string, action: string, body: string) {
    if (serviceType === AV_TRANSPORT) {
      return this.dispatchAvTransport(action, body);
    }

    if (serviceType === CONNECTION_MANAGER) {
      return this.dispatchConnectionManager(action);
    }

    if (serviceType === RENDERING_CONTROL) {
      return this.dispatchRenderingControl(action, body);
    }

    throw new Error("Invalid service");
  }

  private dispatchAvTransport(action: string, body: string) {
    switch (action) {
      case "SetAVTransportURI": {
        const uri = getSoapValue(body, "CurrentURI");
        const metadata = getSoapValue(body, "CurrentURIMetaData");
        if (!uri) {
          throw new Error("CurrentURI is required");
        }
        this.currentUri = uri;
        this.currentMetadata = metadata;
        this.playback = { currentTime: 0, duration: 0, paused: true, ended: false, src: uri };
        this.state = "TRANSITIONING";
        this.options.onCommand({ type: "load", uri, playbackUri: this.proxyUrl(uri), metadata });
        return soapEnvelope(AV_TRANSPORT, action);
      }
      case "SetNextAVTransportURI":
        return soapEnvelope(AV_TRANSPORT, action);
      case "Play":
        this.state = "PLAYING";
        this.options.onCommand({ type: "play" });
        return soapEnvelope(AV_TRANSPORT, action);
      case "Pause":
        this.state = "PAUSED_PLAYBACK";
        this.options.onCommand({ type: "pause" });
        return soapEnvelope(AV_TRANSPORT, action);
      case "Stop":
        this.state = "STOPPED";
        this.playback = { ...this.playback, currentTime: 0, paused: true, ended: true };
        this.options.onCommand({ type: "stop" });
        return soapEnvelope(AV_TRANSPORT, action);
      case "Seek": {
        const target = getSoapValue(body, "Target");
        const seconds = parseTimeTarget(target);
        this.playback = { ...this.playback, currentTime: seconds };
        this.options.onCommand({ type: "seek", seconds });
        return soapEnvelope(AV_TRANSPORT, action);
      }
      case "GetTransportInfo":
        return soapEnvelope(AV_TRANSPORT, action, `
          <CurrentTransportState>${this.state}</CurrentTransportState>
          <CurrentTransportStatus>OK</CurrentTransportStatus>
          <CurrentSpeed>1</CurrentSpeed>`);
      case "GetPositionInfo":
        return soapEnvelope(AV_TRANSPORT, action, `
          <Track>1</Track>
          <TrackDuration>${formatDuration(this.playback.duration)}</TrackDuration>
          <TrackMetaData>${escapeXml(this.currentMetadata)}</TrackMetaData>
          <TrackURI>${escapeXml(this.currentUri)}</TrackURI>
          <RelTime>${formatDuration(this.playback.currentTime)}</RelTime>
          <AbsTime>${formatDuration(this.playback.currentTime)}</AbsTime>
          <RelCount>2147483647</RelCount>
          <AbsCount>2147483647</AbsCount>`);
      case "GetMediaInfo":
        return soapEnvelope(AV_TRANSPORT, action, `
          <NrTracks>${this.currentUri ? 1 : 0}</NrTracks>
          <MediaDuration>${formatDuration(this.playback.duration)}</MediaDuration>
          <CurrentURI>${escapeXml(this.currentUri)}</CurrentURI>
          <CurrentURIMetaData>${escapeXml(this.currentMetadata)}</CurrentURIMetaData>
          <NextURI></NextURI>
          <NextURIMetaData></NextURIMetaData>
          <PlayMedium>NETWORK</PlayMedium>
          <RecordMedium>NOT_IMPLEMENTED</RecordMedium>
          <WriteStatus>NOT_IMPLEMENTED</WriteStatus>`);
      case "GetCurrentTransportActions":
        return soapEnvelope(AV_TRANSPORT, action, `
          <Actions>Play,Pause,Stop,Seek</Actions>`);
      case "GetDeviceCapabilities":
        return soapEnvelope(AV_TRANSPORT, action, `
          <PlayMedia>NETWORK</PlayMedia>
          <RecMedia>NOT_IMPLEMENTED</RecMedia>
          <RecQualityModes>NOT_IMPLEMENTED</RecQualityModes>`);
      case "GetTransportSettings":
        return soapEnvelope(AV_TRANSPORT, action, `
          <PlayMode>NORMAL</PlayMode>
          <RecQualityMode>NOT_IMPLEMENTED</RecQualityMode>`);
      case "SetPlayMode":
        return soapEnvelope(AV_TRANSPORT, action);
      default:
        throw new Error(`Unsupported AVTransport action: ${action}`);
    }
  }

  private dispatchConnectionManager(action: string) {
    switch (action) {
      case "GetProtocolInfo":
        return soapEnvelope(CONNECTION_MANAGER, action, `
          <Source></Source>
          <Sink>${escapeXml(protocolInfo())}</Sink>`);
      case "GetCurrentConnectionIDs":
        return soapEnvelope(CONNECTION_MANAGER, action, "<ConnectionIDs>0</ConnectionIDs>");
      case "GetCurrentConnectionInfo":
        return soapEnvelope(CONNECTION_MANAGER, action, `
          <RcsID>0</RcsID>
          <AVTransportID>0</AVTransportID>
          <ProtocolInfo>${escapeXml(protocolInfo())}</ProtocolInfo>
          <PeerConnectionManager></PeerConnectionManager>
          <PeerConnectionID>-1</PeerConnectionID>
          <Direction>Input</Direction>
          <Status>OK</Status>`);
      case "PrepareForConnection":
        return soapEnvelope(CONNECTION_MANAGER, action, `
          <ConnectionID>0</ConnectionID>
          <AVTransportID>0</AVTransportID>
          <RcsID>0</RcsID>`);
      case "ConnectionComplete":
        return soapEnvelope(CONNECTION_MANAGER, action);
      default:
        throw new Error(`Unsupported ConnectionManager action: ${action}`);
    }
  }

  private dispatchRenderingControl(action: string, body: string) {
    switch (action) {
      case "SetVolume": {
        const volume = Number.parseInt(getSoapValue(body, "DesiredVolume"), 10);
        this.volume = clamp(Number.isFinite(volume) ? volume : this.volume, 0, 100);
        this.options.onCommand({ type: "volume", volume: this.volume });
        return soapEnvelope(RENDERING_CONTROL, action);
      }
      case "GetVolume":
        return soapEnvelope(RENDERING_CONTROL, action, `<CurrentVolume>${this.volume}</CurrentVolume>`);
      case "SetMute": {
        this.muted = getSoapValue(body, "DesiredMute") === "1";
        this.options.onCommand({ type: "mute", muted: this.muted });
        return soapEnvelope(RENDERING_CONTROL, action);
      }
      case "GetMute":
        return soapEnvelope(RENDERING_CONTROL, action, `<CurrentMute>${this.muted ? 1 : 0}</CurrentMute>`);
      default:
        throw new Error(`Unsupported RenderingControl action: ${action}`);
    }
  }

  private respondXml(response: ServerResponse, xml: string) {
    response.writeHead(200, {
      "Content-Type": "text/xml; charset=utf-8",
      "Content-Length": Buffer.byteLength(xml)
    });
    response.end(xml);
  }

  private proxyUrl(uri: string) {
    return `http://127.0.0.1:${this.port}/proxy?url=${encodeURIComponent(uri)}`;
  }

  private proxyMedia(request: IncomingMessage, response: ServerResponse) {
    const baseUrl = `http://${request.headers.host ?? `127.0.0.1:${this.port}`}`;
    const parsed = new URL(request.url ?? "/", baseUrl);
    const remoteUrl = parsed.searchParams.get("url");

    if (!remoteUrl) {
      response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Missing url");
      return;
    }

    this.log("info", "Proxy request", `${request.headers.range ?? "full"} ${shorten(remoteUrl, 160)}`);
    this.pipeRemoteMedia(remoteUrl, request, response, 0);
  }

  private pipeRemoteMedia(remoteUrl: string, clientRequest: IncomingMessage, clientResponse: ServerResponse, redirectCount: number) {
    if (redirectCount > 5) {
      clientResponse.writeHead(508, { "Content-Type": "text/plain; charset=utf-8" });
      clientResponse.end("Too many redirects");
      return;
    }

    let target: URL;
    try {
      target = new URL(remoteUrl);
    } catch {
      clientResponse.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
      clientResponse.end("Invalid media url");
      return;
    }

    if (target.protocol !== "http:" && target.protocol !== "https:") {
      clientResponse.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
      clientResponse.end("Unsupported media url");
      return;
    }

    const upstream = target.protocol === "https:" ? https : http;
    const upstreamRequest = upstream.request({
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port,
      path: `${target.pathname}${target.search}`,
      method: "GET",
      headers: {
        "User-Agent": "Mozilla/5.0 (Linux; Android 14; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Mobile Safari/537.36 MicroMessenger/8.0",
        "Accept": "*/*",
        "Accept-Encoding": "identity",
        "Connection": "close",
        ...(clientRequest.headers.range ? { Range: clientRequest.headers.range } : {})
      }
    }, (upstreamResponse) => {
      const statusCode = upstreamResponse.statusCode ?? 502;
      const location = upstreamResponse.headers.location;

      if (isRedirect(statusCode) && location) {
        upstreamResponse.resume();
        const nextUrl = new URL(location, target).toString();
        this.log("info", "Proxy redirect", shorten(nextUrl, 180));
        this.pipeRemoteMedia(nextUrl, clientRequest, clientResponse, redirectCount + 1);
        return;
      }

      this.log("info", "Proxy upstream", `${statusCode} ${upstreamResponse.headers["content-type"] ?? "unknown"} ${upstreamResponse.headers["content-range"] ?? upstreamResponse.headers["content-length"] ?? ""}`);

      clientResponse.writeHead(statusCode, mediaResponseHeaders(upstreamResponse.headers));
      upstreamResponse.pipe(clientResponse);
    });

    upstreamRequest.on("error", (error) => {
      this.log("error", "Proxy upstream error", error.message);
      if (!clientResponse.headersSent) {
        clientResponse.writeHead(502, { "Content-Type": "text/plain; charset=utf-8" });
      }
      clientResponse.end("Media proxy error");
    });

    clientResponse.on("close", () => {
      upstreamRequest.destroy();
    });

    upstreamRequest.end();
  }

  private handleSsdpMessage(message: string, remoteAddress: string, remotePort: number) {
    if (!/^M-SEARCH \* HTTP\/1\.1/im.test(message) || !/MAN:\s*"?ssdp:discover"?/im.test(message)) {
      return;
    }

    const st = getHeader(message, "ST");
    if (!st || !this.matchesSearchTarget(st)) {
      return;
    }

    this.log("info", `SSDP search ${st}`, `${remoteAddress}:${remotePort}`);
    const targets = st.toLowerCase() === "ssdp:all" ? SEARCH_TARGETS : [st];
    for (const target of targets) {
      setTimeout(() => {
        this.sendSsdpResponse(remoteAddress, remotePort, target);
      }, RESPONSE_DELAY_MS);
    }
  }

  private matchesSearchTarget(st: string) {
    const normalized = st.toLowerCase();
    return normalized === "ssdp:all"
      || normalized === "upnp:rootdevice"
      || normalized === `uuid:${this.options.uuid}`.toLowerCase()
      || SEARCH_TARGETS.some((target) => target.toLowerCase() === normalized);
  }

  private sendSsdpResponse(remoteAddress: string, remotePort: number, target: string) {
    const localAddress = getAddressForRemote(remoteAddress);
    const response = [
      "HTTP/1.1 200 OK",
      `CACHE-CONTROL: max-age=${SSDP_MAX_AGE}`,
      `DATE: ${new Date().toUTCString()}`,
      "EXT:",
      `LOCATION: http://${localAddress}:${this.port}/description.xml`,
      "SERVER: macOS UPnP/1.1 MacDLNACasting/0.1",
      `ST: ${target}`,
      `USN: ${this.usn(target)}`,
      "",
      ""
    ].join("\r\n");

    this.ssdpSocket?.send(Buffer.from(response), remotePort, remoteAddress);
  }

  private sendAliveNotifications() {
    const address = getPrimaryAddress();
    for (const target of SEARCH_TARGETS) {
      this.sendNotification(target, "ssdp:alive", address);
    }
  }

  private sendByebyeNotifications() {
    const address = getPrimaryAddress();
    for (const target of SEARCH_TARGETS) {
      this.sendNotification(target, "ssdp:byebye", address);
    }
  }

  private sendNotification(target: string, subtype: "ssdp:alive" | "ssdp:byebye", address: string) {
    const headers = [
      "NOTIFY * HTTP/1.1",
      `HOST: ${MULTICAST_ADDRESS}:${SSDP_PORT}`,
      `CACHE-CONTROL: max-age=${SSDP_MAX_AGE}`,
      `LOCATION: http://${address}:${this.port}/description.xml`,
      `NT: ${target}`,
      `NTS: ${subtype}`,
      "SERVER: macOS UPnP/1.1 MacDLNACasting/0.1",
      `USN: ${this.usn(target)}`,
      "",
      ""
    ].join("\r\n");

    this.ssdpSocket?.send(Buffer.from(headers), SSDP_PORT, MULTICAST_ADDRESS);
  }

  private usn(target: string) {
    const uuid = `uuid:${this.options.uuid}`;
    return target.toLowerCase() === uuid.toLowerCase() ? uuid : `${uuid}::${target}`;
  }

  private log(level: DlnaLogEntry["level"], message: string, detail?: string) {
    const entry = { level, message, detail };
    if (level === "error") {
      console.error(`[DLNA] ${message}`, detail ?? "");
    } else {
      console.log(`[DLNA] ${message}`, detail ?? "");
    }
    this.options.onLog?.(entry);
  }
}

function getSoapAction(header: string | string[] | undefined, body: string) {
  const value = Array.isArray(header) ? header[0] : header;
  const fromHeader = value?.trim().replace(/^"|"$/g, "").split("#")[1];
  if (fromHeader) {
    return fromHeader;
  }

  for (const action of KNOWN_SOAP_ACTIONS) {
    const pattern = new RegExp(`<(?:[A-Za-z0-9_]+:)?${action}\\b`, "i");
    if (pattern.test(body)) {
      return action;
    }
  }

  return "";
}

function readBody(request: IncomingMessage) {
  return new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

function getHeader(message: string, name: string) {
  const match = message.match(new RegExp(`^${name}:\\s*(.*?)\\s*$`, "im"));
  return match?.[1];
}

function normalizePath(rawUrl: string) {
  const path = rawUrl.split("?")[0] || "/";
  if (path.length > 1 && path.endsWith("/")) {
    return path.slice(0, -1);
  }
  return path;
}

function serviceName(serviceType: string) {
  if (serviceType === AV_TRANSPORT) {
    return "AVTransport";
  }
  if (serviceType === CONNECTION_MANAGER) {
    return "ConnectionManager";
  }
  if (serviceType === RENDERING_CONTROL) {
    return "RenderingControl";
  }
  return serviceType;
}

function summarizeSoapBody(body: string) {
  const uri = getSoapValue(body, "CurrentURI");
  const target = getSoapValue(body, "Target");
  const volume = getSoapValue(body, "DesiredVolume");
  const parts = [
    uri ? `uri=${uri}` : "",
    target ? `target=${target}` : "",
    volume ? `volume=${volume}` : ""
  ].filter(Boolean);

  return parts.join(" ") || body.replace(/\s+/g, " ").trim().slice(0, 180);
}

function protocolInfo() {
  return [
    "http-get:*:video/mp4:*",
    "http-get:*:video/quicktime:*",
    "http-get:*:video/x-matroska:*",
    "http-get:*:video/x-msvideo:*",
    "http-get:*:video/mpeg:*",
    "http-get:*:application/vnd.apple.mpegurl:*",
    "http-get:*:application/x-mpegURL:*",
    "http-get:*:audio/mpeg:*",
    "http-get:*:audio/mp4:*"
  ].join(",");
}

function isRedirect(statusCode: number) {
  return [301, 302, 303, 307, 308].includes(statusCode);
}

function mediaResponseHeaders(headers: http.IncomingHttpHeaders) {
  const names = [
    "accept-ranges",
    "cache-control",
    "content-length",
    "content-range",
    "content-type",
    "etag",
    "expires",
    "last-modified"
  ];
  const nextHeaders: Record<string, string | string[]> = {
    "Access-Control-Allow-Origin": "*"
  };

  for (const name of names) {
    const value = headers[name];
    if (typeof value === "string" || Array.isArray(value)) {
      nextHeaders[name] = value;
    }
  }

  return nextHeaders;
}

function shorten(value: string, maxLength: number) {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}...` : value;
}

function parseTimeTarget(target: string) {
  const time = target.trim();
  const match = time.match(/^(\d+):(\d{2}):(\d{2})(?:\.(\d+))?$/);
  if (!match) {
    return Number.parseFloat(time) || 0;
  }

  const [, hours, minutes, seconds, fraction = "0"] = match;
  return Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds) + Number(`0.${fraction}`);
}

function formatDuration(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return "00:00:00";
  }

  const whole = Math.floor(seconds);
  const h = Math.floor(whole / 3600).toString().padStart(2, "0");
  const m = Math.floor((whole % 3600) / 60).toString().padStart(2, "0");
  const s = Math.floor(whole % 60).toString().padStart(2, "0");
  return `${h}:${m}:${s}`;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function getPrimaryAddress() {
  for (const addresses of Object.values(os.networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === "IPv4" && !address.internal) {
        return address.address;
      }
    }
  }

  return "127.0.0.1";
}

function getAddressForRemote(remoteAddress: string) {
  const socket = dgram.createSocket("udp4");
  try {
    socket.connect(SSDP_PORT, remoteAddress);
    const address = socket.address();
    return typeof address === "object" ? address.address : getPrimaryAddress();
  } catch {
    return getPrimaryAddress();
  } finally {
    socket.close();
  }
}
