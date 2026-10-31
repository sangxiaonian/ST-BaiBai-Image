import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  fetchNightmareModels,
  fetchNightmareSchedulers,
  generateNightmareImage,
  testNightmareConnection,
} from '@/backends/nightmare';
import type { NightmareSettings } from '@/state/settings';

function nightmare(overrides: Partial<NightmareSettings> = {}): NightmareSettings {
  return {
    mode: 'txt2img',
    url: 'http://127.0.0.1:8820',
    token: 'secret-token',
    model: 'model-a',
    promptPresets: [{ id: 'preset-1', name: '默认', prefix: 'high quality', suffix: '' }],
    activePromptPresetId: 'preset-1',
    qualityTags: 'high quality',
    negativePrompt: 'watermark',
    resolution: '',
    portraitSize: '832×1216',
    landscapeSize: '1216×832',
    steps: 24,
    cfg: 5,
    scheduler: 'euler',
    seed: 0,
    naturalLanguage: true,
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Nightmare API', () => {
  it('runs the current canvas with only prompts and without a selected model or sampling overrides', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ results: [{ url: '/out.png' }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(new Blob(['png'], { type: 'image/png' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await generateNightmareImage(nightmare({ mode: 'current', model: '' }), {
      prompt: 'a quiet garden', negative: 'people', seed: 42, size: 'landscape',
    });
    expect(JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))).toEqual({
      flow: 'current',
      prompt: 'high quality, a quiet garden',
      negative: 'watermark, people',
    });
    result.revoke();
  });

  it('tests the local API and reads installed model ids with bearer authentication', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ rendering: false }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        models: [{ id: 'moss', label: 'MOSS Image', family: 'dit', scheduler: 'euler' }],
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        nodes: [{ widgets: [{ name: 'scheduler', options: ['euler', 'euler_a', 'euler'] }] }],
      }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(testNightmareConnection(nightmare())).resolves.toEqual({ rendering: false });
    await expect(fetchNightmareModels(nightmare())).resolves.toEqual([{
      id: 'moss', name: 'MOSS Image', family: 'dit', scheduler: 'euler',
    }]);
    await expect(fetchNightmareSchedulers(nightmare())).resolves.toEqual(['euler', 'euler_a']);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ headers: { Authorization: 'Bearer secret-token' } });
    expect(fetchMock.mock.calls[1][0]).toBe('http://127.0.0.1:8820/models');
    expect(fetchMock.mock.calls[2][0]).toBe('http://127.0.0.1:8820/flows/txt2img');
  });

  it('sends fixed and dynamic prompts, downloads the first generated image, and supports revoke', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ results: [{ url: '/results/run/output.png' }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(new Blob(['png-bytes'], { type: 'image/png' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const result = await generateNightmareImage(nightmare(), {
      prompt: '1girl, moonlight',
      negative: 'extra people',
      seed: 42,
      size: 'portrait',
    });

    const request = fetchMock.mock.calls[0][1] as RequestInit;
    const payload = JSON.parse(String(request.body));
    expect(payload).toMatchObject({
      flow: 'txt2img',
      model: 'model-a',
      prompt: 'high quality, 1girl, moonlight',
      negative: 'watermark, extra people',
      seed: 42,
      width: 832,
      height: 1216,
      steps: 24,
      cfg: 5,
      scheduler: 'euler',
    });
    expect(fetchMock.mock.calls[1][0]).toBe('http://127.0.0.1:8820/results/run/output.png');
    expect((fetchMock.mock.calls[1][1] as RequestInit).headers).toMatchObject({
      Authorization: 'Bearer secret-token',
    });
    expect(result.format).toBe('png');
    expect(result.url).toMatch(/^blob:/);
    result.revoke();
    expect(revoke).toHaveBeenCalledWith(result.url);
  });

  it('prefers the LLM natural-language description for Anima and falls back to tags', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ results: [{ url: '/out.png' }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(new Blob(['png'], { type: 'image/png' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await generateNightmareImage(nightmare(), {
      prompt: '1girl, moonlight', nl: 'A girl stands beneath the moon', seed: 1,
    });
    expect(JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body)).prompt)
      .toBe('high quality, A girl stands beneath the moon');

    fetchMock.mockReset()
      .mockResolvedValueOnce(new Response(JSON.stringify({ results: [{ url: '/out.png' }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(new Blob(['png'], { type: 'image/png' }), { status: 200 }));
    await generateNightmareImage(nightmare(), { prompt: '1girl, moonlight', seed: 2 });
    expect(JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body)).prompt)
      .toBe('high quality, 1girl, moonlight');
  });

  it('sends character appearance prompts between the scene and fixed suffix', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ results: [{ url: '/out.png' }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(new Blob(['png'], { type: 'image/png' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await generateNightmareImage(nightmare({
      promptPresets: [{ id: 'preset-2', name: 'cinematic', prefix: 'masterpiece', suffix: 'dramatic lighting' }],
      activePromptPresetId: 'preset-2',
    }), {
      prompt: '2girls, cafe',
      characters: [
        { name: 'A', tag: '1girl, silver hair', nl: 'The first girl is on the left.' },
        { name: 'B', tag: '1girl, black hair', nl: '' },
      ],
      seed: 1,
    });
    expect(JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body)).prompt)
      .toBe('masterpiece, 2girls, cafe, 1girl, silver hair, The first girl is on the left., 1girl, black hair, dramatic lighting');
  });

  it('reports Nightmare API conflicts with an actionable error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('busy', { status: 409 })));
    await expect(generateNightmareImage(nightmare(), { prompt: 'cat', seed: 1 })).rejects.toThrow(
      'Nightmare 正在执行其他任务 (409): busy',
    );
  });
});
