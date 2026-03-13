import i18next, { type i18n as I18nInstance } from 'i18next';

// zh namespaces
import zhCommon from './locales/zh/common.json';
import zhSidebar from './locales/zh/sidebar.json';
import zhChat from './locales/zh/chat.json';
import zhConnectors from './locales/zh/connectors.json';
import zhSettings from './locales/zh/settings.json';
import zhBilling from './locales/zh/billing.json';
import zhTeam from './locales/zh/team.json';
import zhMemory from './locales/zh/memory.json';
import zhSkills from './locales/zh/skills.json';
import zhScheduler from './locales/zh/scheduler.json';
import zhOnboarding from './locales/zh/onboarding.json';
import zhAuth from './locales/zh/auth.json';
import zhNotifications from './locales/zh/notifications.json';

// en namespaces
import enCommon from './locales/en/common.json';
import enSidebar from './locales/en/sidebar.json';
import enChat from './locales/en/chat.json';
import enConnectors from './locales/en/connectors.json';
import enSettings from './locales/en/settings.json';
import enBilling from './locales/en/billing.json';
import enTeam from './locales/en/team.json';
import enMemory from './locales/en/memory.json';
import enSkills from './locales/en/skills.json';
import enScheduler from './locales/en/scheduler.json';
import enOnboarding from './locales/en/onboarding.json';
import enAuth from './locales/en/auth.json';
import enNotifications from './locales/en/notifications.json';

export const i18nNamespaces = [
  'common', 'sidebar', 'chat', 'connectors', 'settings',
  'billing', 'team', 'memory', 'skills', 'scheduler', 'onboarding', 'auth', 'notifications',
] as const;

export type I18nNamespace = (typeof i18nNamespaces)[number];

export const i18n: I18nInstance = i18next.createInstance();

i18n.init({
  lng: 'zh',
  fallbackLng: 'zh',
  supportedLngs: ['zh', 'en'],
  ns: [...i18nNamespaces],
  defaultNS: 'common',
  interpolation: { escapeValue: false },
  resources: {
    zh: {
      common: zhCommon,
      sidebar: zhSidebar,
      chat: zhChat,
      connectors: zhConnectors,
      settings: zhSettings,
      billing: zhBilling,
      team: zhTeam,
      memory: zhMemory,
      skills: zhSkills,
      scheduler: zhScheduler,
      onboarding: zhOnboarding,
      auth: zhAuth,
      notifications: zhNotifications,
    },
    en: {
      common: enCommon,
      sidebar: enSidebar,
      chat: enChat,
      connectors: enConnectors,
      settings: enSettings,
      billing: enBilling,
      team: enTeam,
      memory: enMemory,
      skills: enSkills,
      scheduler: enScheduler,
      onboarding: enOnboarding,
      auth: enAuth,
      notifications: enNotifications,
    },
  },
});
