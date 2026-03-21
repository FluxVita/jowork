import type { Command } from 'commander';
import { writeFileSync, existsSync, unlinkSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { joworkDir } from '../utils/paths.js';

const HOME = process.env['HOME'] ?? '';

export function installServiceCommand(program: Command): void {
  program
    .command('install-service')
    .description('Generate system service config (macOS LaunchAgent / Linux systemd)')
    .option('--uninstall', 'Remove the service')
    .action(async (opts: { uninstall?: boolean }) => {
      if (process.platform === 'darwin') {
        installLaunchAgent(!!opts.uninstall);
      } else if (process.platform === 'linux') {
        installSystemd(!!opts.uninstall);
      } else {
        console.error('Unsupported platform. Only macOS and Linux are supported.');
      }
    });
}

function installLaunchAgent(uninstall: boolean): void {
  const plistPath = join(HOME, 'Library', 'LaunchAgents', 'work.jowork.daemon.plist');

  if (uninstall) {
    if (existsSync(plistPath)) {
      unlinkSync(plistPath);
      console.log(`✓ Removed ${plistPath}`);
      console.log('  Run: launchctl unload work.jowork.daemon');
    } else {
      console.log('Service not installed.');
    }
    return;
  }

  // Find jowork binary
  const joworkBin = process.argv[0]; // node
  const joworkScript = process.argv[1]; // cli.js path

  const logsPath = join(joworkDir(), 'logs');
  mkdirSync(logsPath, { recursive: true });

  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>work.jowork.daemon</string>
  <key>ProgramArguments</key>
  <array>
    <string>${joworkBin}</string>
    <string>${joworkScript}</string>
    <string>serve</string>
    <string>--daemon</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${HOME}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${logsPath}/daemon-stdout.log</string>
  <key>StandardErrorPath</key>
  <string>${logsPath}/daemon-stderr.log</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin</string>
  </dict>
</dict>
</plist>`;

  writeFileSync(plistPath, plist);
  console.log(`✓ LaunchAgent written to ${plistPath}`);
  console.log('');
  console.log('To start:');
  console.log(`  launchctl load ${plistPath}`);
  console.log('');
  console.log('To stop:');
  console.log(`  launchctl unload ${plistPath}`);
  console.log('  jowork install-service --uninstall');
}

function installSystemd(uninstall: boolean): void {
  const serviceDir = join(HOME, '.config', 'systemd', 'user');
  const servicePath = join(serviceDir, 'jowork.service');

  if (uninstall) {
    if (existsSync(servicePath)) {
      unlinkSync(servicePath);
      console.log(`✓ Removed ${servicePath}`);
      console.log('  Run: systemctl --user disable jowork');
    } else {
      console.log('Service not installed.');
    }
    return;
  }

  mkdirSync(serviceDir, { recursive: true });

  const service = `[Unit]
Description=JoWork Daemon — AI Agent Infrastructure
After=network.target

[Service]
Type=simple
ExecStart=${process.execPath} ${process.argv[1]} serve --daemon
WorkingDirectory=${HOME}
Restart=on-failure
RestartSec=10

[Install]
WantedBy=default.target
`;

  writeFileSync(servicePath, service);
  console.log(`✓ Systemd service written to ${servicePath}`);
  console.log('');
  console.log('To start:');
  console.log('  systemctl --user daemon-reload');
  console.log('  systemctl --user enable --now jowork');
}
