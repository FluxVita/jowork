// @jowork/core/network — public API
export { advertiseMdns, getLocalIp, getLocalIps } from './mdns.js';
export type { MdnsAdvertiser } from './mdns.js';
export { getTunnelState, startTunnel, stopTunnel } from './tunnel.js';
export type { TunnelStatus, TunnelState } from './tunnel.js';
