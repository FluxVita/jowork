/**
 * mDNS/Bonjour 广播与发现
 * 用于 Jowork Host 模式向局域网广播服务，Join 模式自动发现服务
 *
 * 依赖 bonjour-service（可选，失败时静默降级）
 */

import { createRequire } from 'node:module';
import { networkInterfaces } from 'node:os';

const SERVICE_TYPE = 'jowork';

let bonjourInstance: unknown = null;
let publishedService: unknown = null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function requireBonjour(): any {
  try {
    const req = createRequire(import.meta.url);
    return req('bonjour-service');
  } catch {
    return null;
  }
}

/**
 * 返回本机所有非回环 IPv4 地址
 */
export function getLocalIps(): string[] {
  const nets = networkInterfaces();
  const ips: string[] = [];
  for (const list of Object.values(nets)) {
    for (const iface of list ?? []) {
      if (!iface.internal && iface.family === 'IPv4') {
        ips.push(iface.address);
      }
    }
  }
  return ips;
}

/**
 * 开始 mDNS 广播（Host 模式）
 */
export function startAdvertising(port: number, name = 'Jowork'): void {
  const mod = requireBonjour();
  if (!mod) return;

  try {
    const BonjourClass = mod.Bonjour ?? mod.default ?? mod;
    bonjourInstance = new BonjourClass();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    publishedService = (bonjourInstance as any).publish({
      name,
      type: SERVICE_TYPE,
      port,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (publishedService as any).start?.();
  } catch (err) {
    console.warn('[mdns] advertise failed:', err);
  }
}

/**
 * 停止 mDNS 广播
 */
export function stopAdvertising(): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (publishedService as any)?.stop?.(() => {});
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (bonjourInstance as any)?.destroy?.();
  } catch {
    // ignore
  }
  bonjourInstance = null;
  publishedService = null;
}

export interface DiscoveredService {
  name: string;
  host: string;
  port: number;
  url: string;
}

/**
 * 扫描局域网内的 Jowork 服务（Join 模式用）
 * @param timeoutMs 超时时间（默认 3 秒）
 */
export function discoverServices(timeoutMs = 3000): Promise<DiscoveredService[]> {
  return new Promise((resolve) => {
    const mod = requireBonjour();
    if (!mod) { resolve([]); return; }

    try {
      const BonjourClass = mod.Bonjour ?? mod.default ?? mod;
      const b = new BonjourClass();
      const found: DiscoveredService[] = [];
      const seen = new Set<string>();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      b.find({ type: SERVICE_TYPE }, (svc: any) => {
        const host: string = svc.addresses?.[0] ?? svc.host ?? '';
        const key = `${host}:${svc.port}`;
        if (seen.has(key)) return;
        seen.add(key);
        found.push({
          name: svc.name ?? 'Jowork',
          host,
          port: svc.port,
          url: `http://${host}:${svc.port}`,
        });
      });

      setTimeout(() => {
        try { b.destroy(); } catch { /* ignore */ }
        resolve(found);
      }, timeoutMs);
    } catch {
      resolve([]);
    }
  });
}
