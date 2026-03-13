function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, '');
}

function firstDefined(...values: Array<string | undefined>): string | undefined {
  return values.find((value) => typeof value === 'string' && value.trim().length > 0)?.trim();
}

const DEFAULT_BASE_URL = 'https://jowork.work';
const DEFAULT_API_PATH = '/api';

export function getApiBaseUrl(): string {
  const explicit = firstDefined(
    process.env['JOWORK_API_URL'],
    process.env['JOWORK_CLOUD_URL'],
  );
  return normalizeBaseUrl(
    explicit ?? `${getWebBaseUrl()}${DEFAULT_API_PATH}`,
  );
}

export function getWebBaseUrl(): string {
  return normalizeBaseUrl(
    firstDefined(
      process.env['JOWORK_APP_URL'],
      process.env['JOWORK_WEB_URL'],
      process.env['JOWORK_BASE_URL'],
      process.env['JOWORK_API_URL'],
    ) ?? DEFAULT_BASE_URL,
  );
}

export function getHealthBaseUrl(): string {
  return normalizeBaseUrl(
    firstDefined(
      process.env['JOWORK_HEALTH_URL'],
      process.env['JOWORK_BASE_URL'],
      process.env['JOWORK_WEB_URL'],
      process.env['JOWORK_APP_URL'],
    ) ?? DEFAULT_BASE_URL,
  );
}
