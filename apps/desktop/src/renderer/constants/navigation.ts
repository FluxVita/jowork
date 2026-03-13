export interface NavItem {
  path: string;
  key: string;
  icon: string;
}

export const NAV_ITEMS: readonly NavItem[] = [
  { path: '/', key: 'conversation', icon: '💬' },
  { path: '/connectors', key: 'connectors', icon: '🔌' },
  { path: '/memories', key: 'memories', icon: '🧠' },
  { path: '/skills', key: 'skills', icon: '⚡' },
  { path: '/workstyle', key: 'workstyle', icon: '✏️' },
  { path: '/scheduler', key: 'scheduler', icon: '🕐' },
  { path: '/notifications', key: 'notifications', icon: '🔔' },
  { path: '/terminal', key: 'terminal', icon: '>' },
  { path: '/billing', key: 'billing', icon: '$' },
  { path: '/team', key: 'team', icon: '👥' },
  { path: '/settings', key: 'settings', icon: '⚙️' },
] as const;
