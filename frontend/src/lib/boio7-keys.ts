'use client';

import {
  enableClientRegistryStorage,
  saveRegistry,
  type ImageModelConfig,
  type NovaModelRegistry,
  type TextModelConfig,
} from '@/lib/nova-models';
import { syncDynamicModelExports } from '@/lib/gemini-config';

const BOIO7_IMAGE_MODEL_ID = 'boio7-gpt-image';
const BOIO7_TEXT_MODEL_ID = 'boio7-text';
const SELECTED_KEY_STORAGE_KEY = 'boio7-selected-api-key';

interface Boio7Key {
  id: string | number;
  raw: string;
  masked: string;
  group: string;
  name: string;
  active: boolean;
  imageEnabled?: boolean;
}

export interface Boio7KeySyncResult {
  ok: boolean;
  key?: Boio7Key;
  error?: string;
}

function maskKey(value: string): string {
  const text = String(value || '').trim();
  if (!text) return '';
  if (text.length <= 14) return text;
  return `${text.slice(0, 6)}...${text.slice(-4)}`;
}

function hasFullKey(value: string): boolean {
  return /^sk-[A-Za-z0-9_.-]{12,}$/.test(String(value || '').trim());
}

function normalizeStatus(value: unknown): boolean {
  if (value === 0 || value === false || value === 'disabled' || value === 'inactive') return false;
  if (value === 'quota_exhausted' || value === 'expired') return false;
  return true;
}

function getNestedString(item: Record<string, unknown>, key: string): string {
  const value = item[key];
  return typeof value === 'string' ? value : '';
}

function normalizeKeys(payload: unknown): Boio7Key[] {
  const data = payload as Record<string, unknown> | unknown[];
  let source: unknown[] = [];
  if (Array.isArray(data)) {
    source = data;
  } else if (Array.isArray(data.data)) {
    source = data.data;
  } else if (data.data && typeof data.data === 'object' && Array.isArray((data.data as Record<string, unknown>).items)) {
    source = (data.data as Record<string, unknown>).items as unknown[];
  } else if (Array.isArray(data.items)) {
    source = data.items;
  } else if (Array.isArray(data.keys)) {
    source = data.keys;
  }

  return source
    .map((rawItem, index) => {
      const item = (rawItem || {}) as Record<string, unknown>;
      const group = (item.group || {}) as Record<string, unknown>;
      const key = getNestedString(item, 'key')
        || getNestedString(item, 'api_key')
        || getNestedString(item, 'apiKey')
        || getNestedString(item, 'token')
        || getNestedString(item, 'value')
        || getNestedString(item, 'secret');
      const groupedName = getNestedString(group, 'name');
      const imageEnabled = item.allow_image_generation
        ?? item.allowImageGeneration
        ?? group.allow_image_generation
        ?? group.allowImageGeneration;

      return {
        id: (item.id as string | number | undefined) ?? (item.key_id as string | number | undefined) ?? index,
        raw: key,
        masked: getNestedString(item, 'masked_key')
          || getNestedString(item, 'maskedKey')
          || getNestedString(item, 'masked')
          || getNestedString(item, 'display_key')
          || getNestedString(item, 'displayKey')
          || maskKey(key),
        group: getNestedString(item, 'group_name')
          || getNestedString(item, 'groupName')
          || groupedName
          || '',
        name: getNestedString(item, 'name')
          || getNestedString(item, 'title')
          || getNestedString(item, 'remark')
          || groupedName
          || 'BOIO7 Key',
        active: normalizeStatus(item.status ?? item.enabled ?? item.is_active ?? item.isActive),
        imageEnabled: typeof imageEnabled === 'boolean' ? imageEnabled : undefined,
      };
    })
    .filter((item) => item.active && hasFullKey(item.raw));
}

function getUrlParam(name: string): string {
  if (typeof window === 'undefined') return '';
  try {
    return new URL(window.location.href).searchParams.get(name) || '';
  } catch {
    return '';
  }
}

function getBoio7Origin(): string {
  if (typeof window === 'undefined') return '';
  const configured = process.env.NEXT_PUBLIC_BOIO7_GATEWAY_BASE_URL || '';
  if (configured) return configured.replace(/\/+$/, '');

  const candidates = [
    getUrlParam('src_host'),
    getUrlParam('src_url'),
    window.location.origin,
  ];

  for (const candidate of candidates) {
    try {
      const url = new URL(candidate);
      return url.origin;
    } catch {
      // Try the next candidate.
    }
  }
  return window.location.origin;
}

function getAuthToken(): string {
  if (typeof window === 'undefined') return '';
  return getUrlParam('token') || window.localStorage.getItem('auth_token') || '';
}

function getEmbeddedUserId(): string {
  if (typeof window === 'undefined') return '';
  const queryUserId = getUrlParam('user_id');
  if (queryUserId) return queryUserId;
  try {
    const user = JSON.parse(window.localStorage.getItem('auth_user') || '{}') as Record<string, unknown>;
    return String(user.id || user.user_id || user.userId || '');
  } catch {
    return '';
  }
}

function getAuthHeaders(): HeadersInit {
  const token = getAuthToken();
  return {
    Accept: 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function fetchJson(pathname: string): Promise<unknown> {
  const url = new URL(pathname, getBoio7Origin());
  const response = await fetch(url.toString(), {
    credentials: 'include',
    headers: getAuthHeaders(),
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function loadBoio7Keys(): Promise<Boio7Key[]> {
  const userId = getEmbeddedUserId();
  const paths = ['/api/v1/keys?page=1&page_size=100'];
  if (userId) paths.push(`/api/v1/admin/users/${encodeURIComponent(userId)}/api-keys`);

  const keys: Boio7Key[] = [];
  for (const path of paths) {
    try {
      keys.push(...normalizeKeys(await fetchJson(path)));
    } catch {
      // Non-admin users cannot read the admin fallback; ignore and keep going.
    }
  }

  const seen = new Set<string>();
  return keys.filter((key) => {
    const marker = key.raw || key.masked || String(key.id);
    if (!marker || seen.has(marker)) return false;
    seen.add(marker);
    return key.imageEnabled !== false;
  });
}

function pickBoio7Key(keys: Boio7Key[]): Boio7Key | undefined {
  if (typeof window !== 'undefined') {
    const selected = window.localStorage.getItem(SELECTED_KEY_STORAGE_KEY);
    if (selected) {
      const match = keys.find((key) => key.raw === selected || String(key.id) === selected);
      if (match) return match;
    }
  }
  return keys[0];
}

function buildBoio7Registry(key: Boio7Key): NovaModelRegistry {
  const baseUrl = getBoio7Origin();
  const imageModel: ImageModelConfig = {
    id: BOIO7_IMAGE_MODEL_ID,
    protocol: 'openai',
    name: 'BOIO7 Image',
    modelId: 'gpt-image-2',
    apiKey: key.raw,
    baseUrl,
    builtinPreset: 'gpt-image-2',
    maxRefImages: 16,
    maxOutputSize: '4K',
    supportsAdvancedParams: true,
  };
  const textModel: TextModelConfig = {
    id: BOIO7_TEXT_MODEL_ID,
    protocol: 'openai',
    name: 'BOIO7 Text',
    modelId: 'gpt-5.4-mini',
    apiKey: key.raw,
    baseUrl,
    note: 'BOIO7 gateway',
  };

  return {
    imageModels: [imageModel],
    textModels: [textModel],
    defaults: {
      textToImage: imageModel.id,
      imageToImage: imageModel.id,
      reversePrompt: textModel.id,
      agent: textModel.id,
      promptOptimize: textModel.id,
      imageDescribe: textModel.id,
    },
  };
}

export async function syncBoio7ModelRegistry(): Promise<Boio7KeySyncResult> {
  if (typeof window === 'undefined') return { ok: false, error: 'browser unavailable' };
  enableClientRegistryStorage();
  try {
    const keys = await loadBoio7Keys();
    const key = pickBoio7Key(keys);
    if (!key) return { ok: false, error: 'No usable BOIO7 image key was found' };

    saveRegistry(buildBoio7Registry(key));
    syncDynamicModelExports();
    window.localStorage.setItem(SELECTED_KEY_STORAGE_KEY, key.raw);
    window.dispatchEvent(new Event('nova-model-registry-updated'));
    return { ok: true, key };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
