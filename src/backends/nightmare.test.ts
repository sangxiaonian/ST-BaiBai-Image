import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchNightmareModels, generateNightmareImage, testNightmareConnection } from '@/backends/nightmare';
import type { NightmareSettings } from '@/state/settings';

function nightmare(overrides: Partial<NightmareSettings> = {}): NightmareSettings {
  return {
    url: 'http://127.0.0.1:8820',
    token: 'secret-token',
    model: 'model-a',
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
  it('tests the local API and reads installed model ids with bearer authentication', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ rendering: false }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([{ id: 'moss', family: 'dit' }]), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(testNightmareConnection(nightmare())).resolves.toEqual({ rendering: false });
    await expect(fetchNightmareModels(nightmare())).resolves.toEqual([{ id: 'moss', family: 'dit' }]);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ headers: { Authorization: 'Bearer secret-token' } });
    expect(fetchMock.mock.calls[1][0]).toBe('http://127.0.0.1:8820/models');
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

  it('reports Nightmare API conflicts with an actionable error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('busy', { status: 409 })));
    await expect(generateNightmareImage(nightmare(), { prompt: 'cat', seed: 1 })).rejects.toThrow(
      'Nightmare 正在执行其他任务 (409): busy',
    );
  });
});
