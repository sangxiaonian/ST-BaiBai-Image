import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ context: null as Record<string, any> | null }));
vi.mock('@/st/context', () => ({ getContext: () => mocks.context }));

async function hydrate(config: Record<string, unknown>) {
  mocks.context = {
    extensionSettings: { baibai_image: config },
    saveSettingsDebounced: vi.fn(),
  };
  const { hydrateSettings, settings } = await import('@/state/settings');
  await hydrateSettings();
  return settings;
}

describe('Nightmare settings migration', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal('toastr', { info: vi.fn(), success: vi.fn(), error: vi.fn() });
    vi.stubGlobal('window', { addEventListener: vi.fn(), dispatchEvent: vi.fn() });
  });

  it('preserves Nightmare selection and normalizes its local generation settings', async () => {
    const settings = await hydrate({
      defaultBackend: 'nightmare',
      nightmare: {
        url: 'http://127.0.0.1:8820/',
        token: 'local-token',
        model: 'moss-image',
        qualityTags: 'sharp',
        negativePrompt: 'watermark',
        portraitSize: '1024×1024',
        landscapeSize: '1216×832',
        steps: 120,
        cfg: -1,
        scheduler: 'euler',
        seed: 56,
        naturalLanguage: false,
      },
    });

    expect(settings.defaultBackend).toBe('nightmare');
    expect(settings.nightmare).toMatchObject({
      url: 'http://127.0.0.1:8820/',
      token: 'local-token',
      model: 'moss-image',
      qualityTags: 'sharp',
      negativePrompt: 'watermark',
      portraitSize: '1024×1024',
      steps: 100,
      cfg: 0,
      scheduler: 'euler',
      seed: 56,
      naturalLanguage: false,
    });
  }, 15_000);

  it('keeps legacy WebUI disabled and migrates it to the default backend', async () => {
    const settings = await hydrate({ defaultBackend: 'webui' });
    expect(settings.defaultBackend).toBe('comfyui');
  });
});
