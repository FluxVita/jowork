function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, '');
}

function firstDefined(...values: Array<string | undefined>): string | undefined {
  return values.find((value) => typeof value === 'string' && value.trim().length > 0)?.trim();
}

const DEFAULT_BASE_URL = 'https://jowork.work';

export function getApiBaseUrl(): string {
  return normalizeBaseUrl(
    firstDefined(
      process.env['JOWORK_API_URL'],
      process.env['JOWORK_CLOUD_URL'],
      process.env['JOWORK_BASE_URL'],
    ) ?? DEFAULT_BASE_URL,
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
