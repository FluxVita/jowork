import type { Command } from 'commander';
import { readConfig, writeConfig } from '../utils/config.js';

export function configCommand(program: Command): void {
  const cfg = program.command('config').description('View or update JoWork configuration');

  cfg.command('get')
    .description('Get a config value')
    .argument('<key>', 'Config key to read')
    .action((key: string) => {
      const config = readConfig();
      const value = (config as unknown as Record<string, unknown>)[key];
      if (value === undefined) {
        console.log('(not set)');
      } else {
        console.log(typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value));
      }
    });

  cfg.command('set')
    .description('Set a config value')
    .argument('<key>', 'Config key to set')
    .argument('<value>', 'Value to set')
    .action((key: string, value: string) => {
      const config = readConfig();
      let parsed: unknown = value;
      if (value === 'true') parsed = true;
      else if (value === 'false') parsed = false;
      else if (/^\d+$/.test(value)) parsed = parseInt(value, 10);
      else if (value.startsWith('{') || value.startsWith('[')) {
        try { parsed = JSON.parse(value); } catch { parsed = value; }
      }
      (config as unknown as Record<string, unknown>)[key] = parsed;
      writeConfig(config);
      console.log(`${key} = ${JSON.stringify(parsed)}`);
    });

  cfg.command('list')
    .description('Show all configuration')
    .action(() => {
      const config = readConfig();
      console.log(JSON.stringify(config, null, 2));
    });
}
