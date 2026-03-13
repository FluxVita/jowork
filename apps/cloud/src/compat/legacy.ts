import type { Context } from 'hono';

const BUILTIN_SERVICES = [
  {
    service_id: 'svc_page_chat',
    type: 'page',
    name: 'AI Assistant',
    source: 'builtin',
  },
  {
    service_id: 'svc_page_ai_services',
    type: 'page',
    name: 'AI Services',
    source: 'builtin',
  },
  {
    service_id: 'svc_page_admin',
    type: 'page',
    name: 'Admin',
    source: 'builtin',
  },
];

export function getMyServices(c: Context): Response {
  return c.json({ services: BUILTIN_SERVICES });
}
