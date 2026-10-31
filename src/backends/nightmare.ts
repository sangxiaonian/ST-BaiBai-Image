import { parseSize, pickSize, type Orientation } from '@/backends/size';
import type { ImageCharacterPrompt } from '@/autoTag/protocol';
import type { ComfyImageResult } from '@/backends/comfyui';
import type { NightmareSettings } from '@/state/settings';

export class NightmareError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'NightmareError';
  }
}

export interface NightmareModel {
  id: string;
  family?: string;
  name?: string;
  scheduler?: string;
}

export interface NightmareGenerateValues {
  /** LLM 生成的 danbooru 短 tag；没有自然语言时作为回退。 */
  prompt: string;
  /** LLM 生成的自然语言；Anima 与 ComfyUI 简易模式一致，存在时优先使用。 */
  nl?: string;
  /** 本地角色外貌提示;Nightmare 不支持原生角色槽,会合并进正向提示词。 */
  characters?: ImageCharacterPrompt[];
  negative?: string;
  seed: number;
  size?: Orientation;
}

export interface NightmarePrompts {
  prompt: string;
  negative: string;
}

/** 按实际发给 Nightmare 的顺序组装正负向提示词。 */
export function composeNightmarePrompts(settings: NightmareSettings, values: NightmareGenerateValues): NightmarePrompts {
  const preset = settings.promptPresets.find(item => item.id === settings.activePromptPresetId);
  const scene = values.nl?.trim() || values.prompt.trim();
  const characters = (values.characters ?? [])
    .map((character, index) => {
      const details = [
        character.tag.trim() ? `Appearance: ${character.tag.trim()}` : '',
        character.nl?.trim() ? `In-scene description: ${character.nl.trim()}` : '',
      ].filter(Boolean);
      return details.length ? `Character ${index + 1}: ${details.join('; ')}` : '';
    })
    .filter(Boolean);
  const hasCharacterPrompts = characters.length > 0;
  return {
    prompt: [
      preset?.prefix.trim(),
      hasCharacterPrompts ? `Scene: ${scene}` : scene,
      ...(hasCharacterPrompts ? [`Characters:\n${characters.join('\n')}`] : []),
      preset?.suffix.trim(),
    ]
      .filter(Boolean)
      .join(hasCharacterPrompts ? '\n\n' : ', '),
    negative: [settings.negativePrompt.trim(), values.negative?.trim()].filter(Boolean).join(', '),
  };
}

const nightmareWaiting: Array<() => void> = [];
let nightmareRunning = false;

async function acquireNightmareSlot(signal?: AbortSignal): Promise<() => void> {
  if (signal?.aborted) throw signal.reason ?? new DOMException('已取消', 'AbortError');
  if (!nightmareRunning) nightmareRunning = true;
  else {
    await new Promise<void>((resolve, reject) => {
      const grant = () => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      };
      const onAbort = () => {
        const index = nightmareWaiting.indexOf(grant);
        if (index >= 0) nightmareWaiting.splice(index, 1);
        reject(signal?.reason ?? new DOMException('已取消', 'AbortError'));
      };
      nightmareWaiting.push(grant);
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const next = nightmareWaiting.shift();
    if (next) next();
    else nightmareRunning = false;
  };
}

function baseUrl(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

function authHeaders(token: string, json = false): Record<string, string> {
  return {
    ...(json ? { 'Content-Type': 'application/json' } : {}),
    ...(token.trim() ? { Authorization: `Bearer ${token.trim()}` } : {}),
  };
}

async function requestError(response: Response, action: string): Promise<NightmareError> {
  const detail = (await response.text().catch(() => '')).trim();
  return new NightmareError(`${action} (${response.status})${detail ? `: ${detail.slice(0, 400)}` : ''}`, response.status);
}

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function modelList(value: unknown): NightmareModel[] {
  const root = object(value);
  const entries = Array.isArray(value)
    ? value
    : Array.isArray(root?.models)
      ? root.models
      : Array.isArray(root?.checkpoints)
        ? root.checkpoints
        : [];
  return entries.flatMap(entry => {
    if (typeof entry === 'string') return [{ id: entry }];
    const item = object(entry);
    const id = item?.id ?? item?.value ?? item?.name;
    if (typeof id !== 'string' || !id) return [];
    return [{
      id,
      ...(typeof item?.family === 'string' ? { family: item.family } : {}),
      ...(typeof item?.label === 'string'
        ? { name: item.label }
        : typeof item?.name === 'string'
          ? { name: item.name }
          : {}),
      ...(typeof item?.scheduler === 'string' ? { scheduler: item.scheduler } : {}),
    }];
  });
}

export async function fetchNightmareModels(
  settings: Pick<NightmareSettings, 'url' | 'token'>,
  signal?: AbortSignal,
): Promise<NightmareModel[]> {
  if (!settings.url.trim()) throw new NightmareError('请先填写 Nightmare 服务地址');
  const response = await fetch(`${baseUrl(settings.url)}/models`, {
    headers: authHeaders(settings.token),
    signal,
  });
  if (!response.ok) throw await requestError(response, '读取 Nightmare 模型列表失败');
  return modelList(await response.json());
}

/** Read the scheduler choices advertised by Nightmare's text-to-image flow schema. */
export async function fetchNightmareSchedulers(
  settings: Pick<NightmareSettings, 'url' | 'token'>,
  signal?: AbortSignal,
): Promise<string[]> {
  if (!settings.url.trim()) throw new NightmareError('请先填写 Nightmare 服务地址');
  const response = await fetch(`${baseUrl(settings.url)}/flows/txt2img`, {
    headers: authHeaders(settings.token),
    signal,
  });
  if (!response.ok) throw await requestError(response, '读取 Nightmare 调度器列表失败');
  const schema = object(await response.json());
  const nodes = Array.isArray(schema?.nodes) ? schema.nodes : [];
  const values = nodes.flatMap(node => {
    const widgets = object(node)?.widgets;
    if (!Array.isArray(widgets)) return [];
    return widgets.flatMap(widget => {
      const item = object(widget);
      if (item?.name !== 'scheduler' || !Array.isArray(item.options)) return [];
      return item.options.filter((option): option is string => typeof option === 'string' && !!option.trim());
    });
  });
  return [...new Set(values)];
}

export async function testNightmareConnection(
  settings: Pick<NightmareSettings, 'url' | 'token'>,
  signal?: AbortSignal,
): Promise<{ rendering: boolean }> {
  if (!settings.url.trim()) throw new NightmareError('请先填写 Nightmare 服务地址');
  const response = await fetch(`${baseUrl(settings.url)}/info`, {
    headers: authHeaders(settings.token),
    signal,
  });
  if (!response.ok) throw await requestError(response, '连接 Nightmare 失败');
  const info = object(await response.json());
  return { rendering: info?.rendering === true };
}

function imageUrl(base: string, path: string): string {
  try {
    return new URL(path, `${base}/`).toString();
  } catch {
    throw new NightmareError('Nightmare 返回了无效的图片地址');
  }
}

function firstResult(payload: unknown): Record<string, unknown> {
  const root = object(payload);
  const results = root?.results;
  if (!Array.isArray(results) || results.length === 0) {
    const warnings = Array.isArray(root?.warnings) ? root.warnings.join('; ') : '';
    throw new NightmareError(`Nightmare 未返回图片${warnings ? `: ${warnings}` : ''}`);
  }
  const result = object(results[0]);
  if (!result || typeof result.url !== 'string') throw new NightmareError('Nightmare 图片结果格式异常');
  return result;
}

/** 调用 Nightmare Mobile 本地 API 的 txt2img flow，并下载首张 PNG 结果。 */
export async function generateNightmareImage(
  settings: NightmareSettings,
  values: NightmareGenerateValues,
  signal?: AbortSignal,
  onStart?: () => void,
): Promise<ComfyImageResult> {
  if (!settings.url.trim()) throw new NightmareError('请先填写 Nightmare 服务地址');
  if (!settings.token.trim()) throw new NightmareError('请先填写 Nightmare API Token');
  if (settings.mode !== 'current' && !settings.model.trim()) throw new NightmareError('请先选择 Nightmare 模型');
  if (!values.prompt.trim()) throw new NightmareError('正向提示词不能为空');
  if (signal?.aborted) throw signal.reason ?? new DOMException('已取消', 'AbortError');

  const release = await acquireNightmareSlot(signal);
  try {
    onStart?.();
    return await runNightmareImage(settings, values, signal);
  } finally {
    release();
  }
}

async function runNightmareImage(
  settings: NightmareSettings,
  values: NightmareGenerateValues,
  signal?: AbortSignal,
): Promise<ComfyImageResult> {

  const dimensions = parseSize(pickSize(settings, values.size ?? 'portrait'));
  const { prompt, negative } = composeNightmarePrompts(settings, values);
  const body: Record<string, unknown> = {
    flow: settings.mode === 'current' ? 'current' : 'txt2img',
    prompt,
    negative,
  };
  if (settings.mode !== 'current') {
    body.model = settings.model;
    body.seed = values.seed;
    body.width = dimensions?.width;
    body.height = dimensions?.height;
    if (Number.isFinite(settings.steps) && settings.steps > 0) body.steps = Math.min(100, Math.max(1, Math.round(settings.steps)));
    if (Number.isFinite(settings.cfg) && settings.cfg > 0) body.cfg = Math.min(50, settings.cfg);
    if (settings.scheduler.trim()) body.scheduler = settings.scheduler.trim();
  }

  const root = baseUrl(settings.url);
  const cancel = () => {
    void fetch(`${root}/cancel`, { method: 'POST', headers: authHeaders(settings.token) }).catch(() => undefined);
  };
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    const response = await fetch(`${root}/run`, {
      method: 'POST',
      headers: authHeaders(settings.token, true),
      body: JSON.stringify(body),
      signal,
    });
    if (!response.ok) throw await requestError(response, response.status === 409 ? 'Nightmare 正在执行其他任务' : 'Nightmare 生图失败');
    const result = firstResult(await response.json());
    const imageResponse = await fetch(imageUrl(root, result.url as string), {
      headers: authHeaders(settings.token),
      signal,
    });
    if (!imageResponse.ok) throw await requestError(imageResponse, '下载 Nightmare 图片失败');
    const blob = await imageResponse.blob();
    const format = (blob.type.split('/')[1] || 'png').replace('jpeg', 'jpg');
    const url = URL.createObjectURL(blob);
    return {
      url,
      filename: `nightmare-${Date.now()}.${format}`,
      format,
      revoke() { URL.revokeObjectURL(url); },
    };
  } finally {
    signal?.removeEventListener('abort', cancel);
  }
}
