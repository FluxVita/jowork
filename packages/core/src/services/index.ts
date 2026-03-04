// @jowork/core/services — service registry
export { gracefulShutdown } from './shutdown.js';
export { startBackupScheduler, stopBackupScheduler } from './backup-scheduler.js';
// Allows apps/jowork and apps/fluxvita to register services that the core can reference.

export interface ServiceHandle {
  name: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  isRunning(): boolean;
}

const services = new Map<string, ServiceHandle>();

export function registerService(service: ServiceHandle): void {
  services.set(service.name, service);
}

export function getService(name: string): ServiceHandle | undefined {
  return services.get(name);
}

export async function startAllServices(): Promise<void> {
  for (const svc of services.values()) {
    if (!svc.isRunning()) {
      await svc.start();
    }
  }
}

export async function stopAllServices(): Promise<void> {
  for (const svc of services.values()) {
    if (svc.isRunning()) {
      await svc.stop();
    }
  }
}

export function listServices(): { name: string; running: boolean }[] {
  return Array.from(services.values()).map(s => ({ name: s.name, running: s.isRunning() }));
}
