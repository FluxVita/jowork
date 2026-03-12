/// <reference types="vite/client" />

import type { JoWorkAPI } from '../preload/index';

declare global {
  interface Window {
    jowork: JoWorkAPI;
  }
}
