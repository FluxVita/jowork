// @jowork/core/network — mDNS-SD service advertisement
// Broadcasts this gateway on the LAN so clients can discover it.
// Uses Node.js built-in dgram — no external dependencies.
// Gracefully degrades if multicast is unavailable.

import { createSocket, Socket } from 'node:dgram';
import { networkInterfaces, hostname } from 'node:os';
import { logger } from '../utils/index.js';

const MDNS_ADDR = '224.0.0.251';
const MDNS_PORT = 5353;
const SERVICE_TYPE = '_jowork._tcp.local';
const ANNOUNCE_INTERVAL_MS = 20_000; // re-announce every 20 s

// ─── DNS packet encoding ──────────────────────────────────────────────────────

function encodeName(name: string): Buffer {
  const parts = name.split('.');
  const bufs: Buffer[] = [];
  for (const part of parts) {
    if (!part) continue;
    const label = Buffer.from(part, 'ascii');
    bufs.push(Buffer.from([label.length]), label);
  }
  bufs.push(Buffer.from([0]));
  return Buffer.concat(bufs);
}

function encodeRecord(
  name: string,
  type: number,
  ttl: number,
  rdata: Buffer,
  cacheFlush = false,
): Buffer {
  const nameBuf = encodeName(name);
  const hdr = Buffer.alloc(10);
  hdr.writeUInt16BE(type, 0);
  hdr.writeUInt16BE(cacheFlush ? 0x8001 : 0x0001, 2); // Class IN (+ cache-flush bit)
  hdr.writeUInt32BE(ttl, 4);
  hdr.writeUInt16BE(rdata.length, 8);
  return Buffer.concat([nameBuf, hdr, rdata]);
}

function encodePTR(service: string, instance: string): Buffer {
  return encodeRecord(service, 12, 4500, encodeName(instance));
}

function encodeSRV(instance: string, target: string, port: number): Buffer {
  const targetBuf = encodeName(target);
  const data = Buffer.alloc(6 + targetBuf.length);
  data.writeUInt16BE(0, 0);    // priority
  data.writeUInt16BE(0, 2);    // weight
  data.writeUInt16BE(port, 4); // port
  targetBuf.copy(data, 6);
  return encodeRecord(instance, 33, 120, data, true);
}

function encodeTXT(instance: string, pairs: Record<string, string>): Buffer {
  const data = Buffer.concat(
    Object.entries(pairs).map(([k, v]) => {
      const b = Buffer.from(`${k}=${v}`, 'utf8');
      return Buffer.concat([Buffer.from([b.length]), b]);
    }),
  );
  return encodeRecord(instance, 16, 4500, data, true);
}

function encodeA(host: string, ip: string): Buffer {
  const octets = ip.split('.').map(Number);
  return encodeRecord(host, 1, 120, Buffer.from(octets), true);
}

function buildAnnouncement(instanceName: string, hostLocal: string, ip: string, port: number): Buffer {
  const ptr = encodePTR(SERVICE_TYPE, instanceName);
  const srv = encodeSRV(instanceName, hostLocal, port);
  const txt = encodeTXT(instanceName, { version: '0.1.0', port: String(port) });
  const a   = encodeA(hostLocal, ip);

  const hdr = Buffer.alloc(12);
  hdr.writeUInt16BE(0, 0);     // ID = 0 (mDNS)
  hdr.writeUInt16BE(0x8400, 2); // QR=1, AA=1
  hdr.writeUInt16BE(0, 4);     // QDCOUNT
  hdr.writeUInt16BE(3, 6);     // ANCOUNT (PTR + SRV + TXT)
  hdr.writeUInt16BE(0, 8);     // NSCOUNT
  hdr.writeUInt16BE(1, 10);    // ARCOUNT (A)

  return Buffer.concat([hdr, ptr, srv, txt, a]);
}

// ─── Local IP helper ──────────────────────────────────────────────────────────

export function getLocalIp(): string {
  const ifaces = networkInterfaces();
  for (const iface of Object.values(ifaces)) {
    if (!iface) continue;
    for (const addr of iface) {
      if (addr.family === 'IPv4' && !addr.internal) return addr.address;
    }
  }
  return '127.0.0.1';
}

export function getLocalIps(): string[] {
  const ips: string[] = [];
  const ifaces = networkInterfaces();
  for (const iface of Object.values(ifaces)) {
    if (!iface) continue;
    for (const addr of iface) {
      if (addr.family === 'IPv4' && !addr.internal) ips.push(addr.address);
    }
  }
  return ips;
}

// ─── Advertiser ───────────────────────────────────────────────────────────────

export interface MdnsAdvertiser {
  stop(): void;
}

/** Advertise this gateway via mDNS-SD. Returns a stop function. */
export function advertiseMdns(port: number, serviceName = 'jowork-gateway'): MdnsAdvertiser {
  const host = hostname();
  const hostLocal = `${host}.local`;
  const instanceName = `${serviceName}.${SERVICE_TYPE}`;
  const ip = getLocalIp();
  const packet = buildAnnouncement(instanceName, hostLocal, ip, port);

  let sock: Socket | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;

  function cleanup() {
    if (timer) { clearInterval(timer); timer = undefined; }
    if (sock) { try { sock.close(); } catch { /* ignore */ } sock = undefined; }
  }

  try {
    sock = createSocket({ type: 'udp4', reuseAddr: true });

    sock.on('error', (err: Error) => {
      logger.warn('mDNS socket error', { err: err.message });
      cleanup();
    });

    sock.bind(MDNS_PORT, () => {
      try {
        sock!.addMembership(MDNS_ADDR);
        sock!.setMulticastTTL(255);
      } catch (e) {
        logger.warn('mDNS multicast setup failed', { err: String(e) });
      }

      const send = () => {
        sock!.send(packet, 0, packet.length, MDNS_PORT, MDNS_ADDR, (err) => {
          if (err) logger.warn('mDNS send failed', { err: err.message });
        });
      };

      send(); // initial announcement
      timer = setInterval(send, ANNOUNCE_INTERVAL_MS);

      logger.info('mDNS advertising', {
        service: `${instanceName}`,
        ip,
        port,
      });
    });
  } catch (err) {
    logger.warn('mDNS unavailable', { err: String(err) });
  }

  return { stop: cleanup };
}
