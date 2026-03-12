import i18next, { type i18n as I18nInstance } from 'i18next';
import zh from './zh.json';
import en from './en.json';

export const i18n: I18nInstance = i18next.createInstance();

i18n.init({
  lng: 'zh',
  fallbackLng: 'zh',
  supportedLngs: ['zh', 'en'],
  interpolation: { escapeValue: false },
  resources: {
    zh: { translation: zh },
    en: { translation: en },
  },
});
