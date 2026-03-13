import React from 'react';
import { 
  MessageSquare, 
  Unplug, 
  BrainCircuit, 
  Sparkles, 
  PenTool, 
  CalendarClock, 
  Bell, 
  Terminal, 
  CreditCard, 
  Users, 
  Settings 
} from 'lucide-react';

export interface NavItem {
  path: string;
  key: string;
  icon: React.ReactNode;
}

export const NAV_ITEMS: readonly NavItem[] = [
  { path: '/', key: 'conversation', icon: <MessageSquare className="w-4 h-4" /> },
  { path: '/connectors', key: 'connectors', icon: <Unplug className="w-4 h-4" /> },
  { path: '/memories', key: 'memories', icon: <BrainCircuit className="w-4 h-4" /> },
  { path: '/skills', key: 'skills', icon: <Sparkles className="w-4 h-4" /> },
  { path: '/workstyle', key: 'workstyle', icon: <PenTool className="w-4 h-4" /> },
  { path: '/scheduler', key: 'scheduler', icon: <CalendarClock className="w-4 h-4" /> },
  { path: '/notifications', key: 'notifications', icon: <Bell className="w-4 h-4" /> },
  { path: '/terminal', key: 'terminal', icon: <Terminal className="w-4 h-4" /> },
  { path: '/billing', key: 'billing', icon: <CreditCard className="w-4 h-4" /> },
  { path: '/team', key: 'team', icon: <Users className="w-4 h-4" /> },
  { path: '/settings', key: 'settings', icon: <Settings className="w-4 h-4" /> },
] as const;
