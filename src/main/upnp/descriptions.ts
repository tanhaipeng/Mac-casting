import { escapeXml } from "./xml";

export const AV_TRANSPORT = "urn:schemas-upnp-org:service:AVTransport:1";
export const CONNECTION_MANAGER = "urn:schemas-upnp-org:service:ConnectionManager:1";
export const RENDERING_CONTROL = "urn:schemas-upnp-org:service:RenderingControl:1";
export const MEDIA_RENDERER = "urn:schemas-upnp-org:device:MediaRenderer:1";

export function deviceDescription(options: {
  friendlyName: string;
  uuid: string;
  baseUrl: string;
}) {
  const { friendlyName, uuid, baseUrl } = options;

  return `<?xml version="1.0" encoding="utf-8"?>
<root xmlns="urn:schemas-upnp-org:device-1-0">
  <specVersion>
    <major>1</major>
    <minor>0</minor>
  </specVersion>
  <URLBase>${escapeXml(baseUrl)}</URLBase>
  <device>
    <deviceType>${MEDIA_RENDERER}</deviceType>
    <friendlyName>${escapeXml(friendlyName)}</friendlyName>
    <manufacturer>Local</manufacturer>
    <manufacturerURL>http://localhost/</manufacturerURL>
    <modelDescription>Minimal DLNA Renderer for macOS</modelDescription>
    <modelName>Mac DLNA Casting</modelName>
    <modelNumber>0.1.0</modelNumber>
    <UDN>uuid:${escapeXml(uuid)}</UDN>
    <serviceList>
      <service>
        <serviceType>${AV_TRANSPORT}</serviceType>
        <serviceId>urn:upnp-org:serviceId:AVTransport</serviceId>
        <SCPDURL>/service/AVTransport/scpd.xml</SCPDURL>
        <controlURL>/service/AVTransport/control</controlURL>
        <eventSubURL>/service/AVTransport/event</eventSubURL>
      </service>
      <service>
        <serviceType>${CONNECTION_MANAGER}</serviceType>
        <serviceId>urn:upnp-org:serviceId:ConnectionManager</serviceId>
        <SCPDURL>/service/ConnectionManager/scpd.xml</SCPDURL>
        <controlURL>/service/ConnectionManager/control</controlURL>
        <eventSubURL>/service/ConnectionManager/event</eventSubURL>
      </service>
      <service>
        <serviceType>${RENDERING_CONTROL}</serviceType>
        <serviceId>urn:upnp-org:serviceId:RenderingControl</serviceId>
        <SCPDURL>/service/RenderingControl/scpd.xml</SCPDURL>
        <controlURL>/service/RenderingControl/control</controlURL>
        <eventSubURL>/service/RenderingControl/event</eventSubURL>
      </service>
    </serviceList>
  </device>
</root>`;
}

export function avTransportScpd() {
  return scpd([
    action("SetAVTransportURI", inArgs(["InstanceID", "CurrentURI", "CurrentURIMetaData"])),
    action("SetNextAVTransportURI", inArgs(["InstanceID", "NextURI", "NextURIMetaData"])),
    action("Play", inArgs(["InstanceID", "Speed"])),
    action("Pause", inArgs(["InstanceID"])),
    action("Stop", inArgs(["InstanceID"])),
    action("Seek", inArgs(["InstanceID", "Unit", "Target"])),
    action("GetTransportInfo", [
      ...inArgs(["InstanceID"]),
      ...outArgs(["CurrentTransportState", "CurrentTransportStatus", "CurrentSpeed"])
    ]),
    action("GetPositionInfo", [
      ...inArgs(["InstanceID"]),
      ...outArgs(["Track", "TrackDuration", "TrackMetaData", "TrackURI", "RelTime", "AbsTime", "RelCount", "AbsCount"])
    ]),
    action("GetMediaInfo", [
      ...inArgs(["InstanceID"]),
      ...outArgs(["NrTracks", "MediaDuration", "CurrentURI", "CurrentURIMetaData", "NextURI", "NextURIMetaData", "PlayMedium", "RecordMedium", "WriteStatus"])
    ]),
    action("GetCurrentTransportActions", [
      ...inArgs(["InstanceID"]),
      ...outArgs(["Actions"])
    ]),
    action("GetDeviceCapabilities", [
      ...inArgs(["InstanceID"]),
      ...outArgs(["PlayMedia", "RecMedia", "RecQualityModes"])
    ]),
    action("GetTransportSettings", [
      ...inArgs(["InstanceID"]),
      ...outArgs(["PlayMode", "RecQualityMode"])
    ]),
    action("SetPlayMode", inArgs(["InstanceID", "NewPlayMode"]))
  ], [
    stateVariable("InstanceID", "ui4"),
    stateVariable("TransportState", "string"),
    stateVariable("TransportStatus", "string"),
    stateVariable("TransportPlaySpeed", "string"),
    stateVariable("CurrentURI", "string"),
    stateVariable("CurrentURIMetaData", "string"),
    stateVariable("NextURI", "string"),
    stateVariable("NextURIMetaData", "string"),
    stateVariable("RelativeTimePosition", "string"),
    stateVariable("AbsoluteTimePosition", "string"),
    stateVariable("TrackDuration", "string"),
    stateVariable("Track", "ui4"),
    stateVariable("TrackMetaData", "string"),
    stateVariable("TrackURI", "string"),
    stateVariable("RelativeCounterPosition", "i4"),
    stateVariable("AbsoluteCounterPosition", "i4"),
    stateVariable("NumberOfTracks", "ui4"),
    stateVariable("CurrentTransportActions", "string"),
    stateVariable("PlaybackStorageMedium", "string"),
    stateVariable("RecordStorageMedium", "string"),
    stateVariable("RecordMediumWriteStatus", "string"),
    stateVariable("CurrentPlayMode", "string"),
    stateVariable("CurrentRecordQualityMode", "string"),
    stateVariable("A_ARG_TYPE_SeekMode", "string"),
    stateVariable("A_ARG_TYPE_SeekTarget", "string")
  ]);
}

export function connectionManagerScpd() {
  return scpd([
    action("GetProtocolInfo", outArgs(["Source", "Sink"])),
    action("GetCurrentConnectionIDs", outArgs(["ConnectionIDs"])),
    action("GetCurrentConnectionInfo", [
      ...inArgs(["ConnectionID"]),
      ...outArgs(["RcsID", "AVTransportID", "ProtocolInfo", "PeerConnectionManager", "PeerConnectionID", "Direction", "Status"])
    ]),
    action("PrepareForConnection", [
      ...inArgs(["RemoteProtocolInfo", "PeerConnectionManager", "PeerConnectionID", "Direction"]),
      ...outArgs(["ConnectionID", "AVTransportID", "RcsID"])
    ]),
    action("ConnectionComplete", inArgs(["ConnectionID"]))
  ], [
    stateVariable("SourceProtocolInfo", "string"),
    stateVariable("SinkProtocolInfo", "string"),
    stateVariable("CurrentConnectionIDs", "string"),
    stateVariable("A_ARG_TYPE_ConnectionID", "i4"),
    stateVariable("A_ARG_TYPE_AVTransportID", "i4"),
    stateVariable("A_ARG_TYPE_RcsID", "i4"),
    stateVariable("A_ARG_TYPE_ConnectionManager", "string"),
    stateVariable("A_ARG_TYPE_Direction", "string"),
    stateVariable("A_ARG_TYPE_ConnectionStatus", "string"),
    stateVariable("A_ARG_TYPE_ProtocolInfo", "string")
  ]);
}

export function renderingControlScpd() {
  return scpd([
    action("SetVolume", inArgs(["InstanceID", "Channel", "DesiredVolume"])),
    action("GetVolume", [
      ...inArgs(["InstanceID", "Channel"]),
      ...outArgs(["CurrentVolume"])
    ]),
    action("SetMute", inArgs(["InstanceID", "Channel", "DesiredMute"])),
    action("GetMute", [
      ...inArgs(["InstanceID", "Channel"]),
      ...outArgs(["CurrentMute"])
    ])
  ], [
    stateVariable("InstanceID", "ui4"),
    stateVariable("A_ARG_TYPE_Channel", "string"),
    stateVariable("Volume", "ui2"),
    stateVariable("Mute", "boolean")
  ]);
}

function scpd(actions: string[], stateVariables: string[]) {
  return `<?xml version="1.0" encoding="utf-8"?>
<scpd xmlns="urn:schemas-upnp-org:service-1-0">
  <specVersion>
    <major>1</major>
    <minor>0</minor>
  </specVersion>
  <actionList>
    ${actions.join("\n")}
  </actionList>
  <serviceStateTable>
    ${stateVariables.join("\n")}
  </serviceStateTable>
</scpd>`;
}

type Argument = {
  name: string;
  direction: "in" | "out";
};

function action(name: string, args: Argument[]) {
  return `<action>
  <name>${name}</name>
  <argumentList>
    ${args.map((arg) => `<argument><name>${arg.name}</name><direction>${arg.direction}</direction><relatedStateVariable>${relatedStateVariable(arg.name)}</relatedStateVariable></argument>`).join("\n")}
  </argumentList>
</action>`;
}

function inArgs(names: string[]) {
  return names.map((name) => ({ name, direction: "in" as const }));
}

function outArgs(names: string[]) {
  return names.map((name) => ({ name, direction: "out" as const }));
}

function stateVariable(name: string, dataType: string) {
  return `<stateVariable sendEvents="no"><name>${name}</name><dataType>${dataType}</dataType></stateVariable>`;
}

function relatedStateVariable(arg: string) {
  switch (arg) {
    case "CurrentURI":
      return "CurrentURI";
    case "CurrentURIMetaData":
      return "CurrentURIMetaData";
    case "DesiredVolume":
      return "Volume";
    case "DesiredMute":
      return "Mute";
    case "CurrentVolume":
      return "Volume";
    case "CurrentMute":
      return "Mute";
    case "Channel":
      return "A_ARG_TYPE_Channel";
    case "ConnectionID":
      return "A_ARG_TYPE_ConnectionID";
    case "ConnectionIDs":
      return "CurrentConnectionIDs";
    case "AVTransportID":
      return "A_ARG_TYPE_AVTransportID";
    case "RcsID":
      return "A_ARG_TYPE_RcsID";
    case "ProtocolInfo":
      return "SinkProtocolInfo";
    case "PeerConnectionManager":
      return "A_ARG_TYPE_ConnectionManager";
    case "PeerConnectionID":
      return "A_ARG_TYPE_ConnectionID";
    case "Direction":
      return "A_ARG_TYPE_Direction";
    case "Status":
      return "A_ARG_TYPE_ConnectionStatus";
    case "Source":
      return "SourceProtocolInfo";
    case "Sink":
      return "SinkProtocolInfo";
    case "CurrentTransportState":
      return "TransportState";
    case "CurrentTransportStatus":
      return "TransportStatus";
    case "CurrentSpeed":
    case "Speed":
      return "TransportPlaySpeed";
    case "TrackDuration":
    case "MediaDuration":
      return "TrackDuration";
    case "TrackMetaData":
      return "CurrentURIMetaData";
    case "TrackURI":
      return "CurrentURI";
    case "RelTime":
      return "RelativeTimePosition";
    case "AbsTime":
      return "AbsoluteTimePosition";
    case "RelCount":
      return "RelativeCounterPosition";
    case "AbsCount":
      return "AbsoluteCounterPosition";
    case "NrTracks":
      return "NumberOfTracks";
    case "NextURI":
      return "NextURI";
    case "NextURIMetaData":
      return "NextURIMetaData";
    case "PlayMedium":
    case "PlayMedia":
      return "PlaybackStorageMedium";
    case "RecordMedium":
    case "RecMedia":
      return "RecordStorageMedium";
    case "WriteStatus":
      return "RecordMediumWriteStatus";
    case "RecQualityModes":
    case "RecQualityMode":
      return "CurrentRecordQualityMode";
    case "PlayMode":
    case "NewPlayMode":
      return "CurrentPlayMode";
    case "Actions":
      return "CurrentTransportActions";
    case "RemoteProtocolInfo":
      return "A_ARG_TYPE_ProtocolInfo";
    case "Unit":
      return "A_ARG_TYPE_SeekMode";
    case "Target":
      return "A_ARG_TYPE_SeekTarget";
    default:
      return arg;
  }
}
