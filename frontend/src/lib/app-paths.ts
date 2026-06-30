const RAW_BASE_PATH = process.env.NEXT_PUBLIC_NOVA_BASE_PATH || '';

function normalizeBasePath(value: string): string {
  const trimmed = String(value || '').trim();
  if (!trimmed || trimmed === '/') return '';
  const withLeadingSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  return withLeadingSlash.replace(/\/+$/, '');
}

export const NOVA_BASE_PATH = normalizeBasePath(RAW_BASE_PATH);

export function withBasePath(pathname: string): string {
  const normalizedPath = pathname.startsWith('/') ? pathname : `/${pathname}`;
  if (!NOVA_BASE_PATH) return normalizedPath;
  if (normalizedPath === NOVA_BASE_PATH || normalizedPath.startsWith(`${NOVA_BASE_PATH}/`)) {
    return normalizedPath;
  }
  return normalizedPath === '/' ? NOVA_BASE_PATH : `${NOVA_BASE_PATH}${normalizedPath}`;
}

export function apiPath(pathname: string): string {
  return withBasePath(pathname);
}

export function assetPath(pathname: string): string {
  return withBasePath(pathname);
}

export function resolveServerImageUrl(url: string): string {
  if (!url) return url;
  if (url.startsWith('URL:')) return resolveServerImageUrl(url.slice(4));
  if (url.startsWith('MULTI_URL:')) return resolveServerImageUrl(url.slice(10).split('|||')[0] || '');
  if (/^(?:https?:|data:|blob:)/i.test(url)) return url;
  if (url.startsWith('/')) return withBasePath(url);
  return url;
}
