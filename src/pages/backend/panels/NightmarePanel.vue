<script setup lang="ts">
import { fetchNightmareModels, testNightmareConnection, type NightmareModel } from '@/backends/nightmare';
import Collapsible from '@/components/Collapsible.vue';
import Icon from '@/components/Icon.vue';
import { activeComfyPreset, settings } from '@/state/settings';
import { computed, onMounted, ref, watch } from 'vue';

const testing = ref(false);
const loadingModels = ref(false);
const error = ref('');
const models = ref<NightmareModel[]>([]);
const inUse = computed(() => settings.defaultBackend === 'nightmare');
const comfyAnimaPreset = computed(() => {
  const preset = activeComfyPreset();
  return preset.mode === 'simple' && preset.simple.template === 'anima' ? preset : null;
});

function copyComfyAnimaPrompts(): void {
  const preset = comfyAnimaPreset.value;
  if (!preset) return;
  settings.nightmare.qualityTags = preset.simple.positive;
  settings.nightmare.negativePrompt = preset.simple.negative;
  toastr.success('已复制 ComfyUI Anima 固定正负面提示词', '柏宝绘');
}

function errorText(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}

async function refreshModels(showSuccess = true): Promise<void> {
  if (loadingModels.value) return;
  loadingModels.value = true;
  error.value = '';
  try {
    models.value = await fetchNightmareModels(settings.nightmare);
    if (!settings.nightmare.model && models.value.length) settings.nightmare.model = models.value[0].id;
    if (showSuccess) toastr.success(`已读取 ${models.value.length} 个 Nightmare 模型`, '柏宝绘');
  } catch (reason) {
    error.value = errorText(reason);
    if (showSuccess) toastr.error(error.value, '读取模型失败');
  } finally {
    loadingModels.value = false;
  }
}

async function testConnection(): Promise<void> {
  if (testing.value) return;
  testing.value = true;
  try {
    const result = await testNightmareConnection(settings.nightmare);
    models.value = await fetchNightmareModels(settings.nightmare);
    if (!settings.nightmare.model && models.value.length) settings.nightmare.model = models.value[0].id;
    toastr.success(result.rendering ? 'Nightmare 已连接（当前正在生成）' : 'Nightmare 连接正常', '柏宝绘');
  } catch (reason) {
    toastr.error(errorText(reason), 'Nightmare 连接失败');
  } finally {
    testing.value = false;
  }
}

onMounted(() => {
  if (settings.nightmare.url.trim() && settings.nightmare.token.trim()) void refreshModels(false);
});
watch(() => [settings.nightmare.url, settings.nightmare.token] as const, ([url, token]) => {
  if (url.trim() && token.trim() && !models.value.length) void refreshModels(false);
});
</script>

<template>
  <div class="panel">
    <p class="bbi-page-intro">
      Nightmare Mobile 本机文生图。请在 Nightmare 的设置中开启「Listen on the local network」和「Allow browser pages」，并填写 Nightmare 显示的 API 地址与 Token。
    </p>

    <div class="bbi-sections">
      <Collapsible title="Nightmare 服务" :open="true">
        <div class="bbi-field">
          <div class="bbi-field-head"><span class="bbi-field-label">服务地址</span></div>
          <input v-model="settings.nightmare.url" class="bbi-input" type="url" placeholder="http://手机局域网地址:8820" spellcheck="false" />
        </div>
        <div class="bbi-field">
          <div class="bbi-field-head"><span class="bbi-field-label">API Token</span></div>
          <input v-model="settings.nightmare.token" class="bbi-input" type="password" placeholder="从 Nightmare API 设置中复制" autocomplete="off" />
          <p class="bbi-field-hint">Token 保存在柏宝绘设置中，仅随本地 API 请求发送。</p>
        </div>
        <div class="conn-actions">
          <span v-if="inUse" class="conn-inuse"><Icon name="check" :size="13" /> 当前已作为出图渠道</span>
          <button v-else class="bbi-btn conn-use" type="button" @click="settings.defaultBackend = 'nightmare'">使用此渠道出图</button>
          <button class="bbi-btn" type="button" :disabled="testing || loadingModels" @click="testConnection">
            <Icon name="plug" /> {{ testing ? '连接中…' : '测试连接并读取模型' }}
          </button>
        </div>
      </Collapsible>

      <Collapsible title="模型与固定参数" :open="true">
        <div v-if="comfyAnimaPreset" class="prompt-copy-row">
          <span class="bbi-field-hint">可复用当前 ComfyUI Anima 预设的固定正负面词；复制后 Nightmare 保留独立副本。</span>
          <button class="bbi-btn bbi-btn-sm" type="button" @click="copyComfyAnimaPrompts">
            复制 ComfyUI 固定词
          </button>
        </div>
        <div class="bbi-field">
          <div class="bbi-field-head">
            <span class="bbi-field-label">模型</span>
            <button class="bbi-btn bbi-btn-sm" type="button" :disabled="loadingModels" @click="refreshModels()">
              <Icon name="refresh" :size="12" /> {{ loadingModels ? '读取中…' : '刷新模型' }}
            </button>
          </div>
          <select v-model="settings.nightmare.model" class="bbi-input bbi-select">
            <option value="">请选择已安装模型</option>
            <option v-for="model in models" :key="model.id" :value="model.id">
              {{ model.name && model.name !== model.id ? `${model.name} · ${model.id}` : model.id }}{{ model.family ? ` (${model.family})` : '' }}
            </option>
          </select>
          <p v-if="error" class="bbi-field-hint">{{ error }}</p>
          <p v-else class="bbi-field-hint">先在 Nightmare 下载模型，再点「刷新模型」读取已安装模型。</p>
        </div>

        <div class="bbi-field">
          <div class="bbi-field-head"><span class="bbi-field-label">固定正面提示词</span></div>
          <textarea v-model="settings.nightmare.qualityTags" class="bbi-input bbi-textarea" rows="3" placeholder="每次生成时拼到正向提示词前面" />
        </div>
        <div class="bbi-field">
          <div class="bbi-field-head"><span class="bbi-field-label">固定负面提示词</span></div>
          <textarea v-model="settings.nightmare.negativePrompt" class="bbi-input bbi-textarea" rows="3" placeholder="每次生成时与画面动态负面词合并" />
        </div>
        <div class="be-grid">
          <label class="bbi-field"><span class="bbi-field-label">竖屏尺寸</span><input v-model="settings.nightmare.portraitSize" class="bbi-input" placeholder="832×1216" /></label>
          <label class="bbi-field"><span class="bbi-field-label">横屏尺寸</span><input v-model="settings.nightmare.landscapeSize" class="bbi-input" placeholder="1216×832" /></label>
          <label class="bbi-field"><span class="bbi-field-label">步数（0 使用模型默认）</span><input v-model.number="settings.nightmare.steps" class="bbi-input" type="number" min="0" max="100" /></label>
          <label class="bbi-field"><span class="bbi-field-label">CFG（0 使用模型默认）</span><input v-model.number="settings.nightmare.cfg" class="bbi-input" type="number" min="0" max="50" step="0.1" /></label>
          <label class="bbi-field"><span class="bbi-field-label">调度器（可留空）</span><input v-model="settings.nightmare.scheduler" class="bbi-input" placeholder="模型默认" /></label>
          <label class="bbi-field"><span class="bbi-field-label">固定种子（0 = 随机）</span><input v-model.number="settings.nightmare.seed" class="bbi-input" type="number" min="0" max="4294967295" /></label>
        </div>
        <label class="bbi-switch-row">
          <span class="bbi-field-label">LLM 生成自然语言描述</span>
          <input v-model="settings.nightmare.naturalLanguage" type="checkbox" class="bbi-checkbox" />
        </label>
        <p class="bbi-field-hint">启用后要求自动 tag 的 LLM 同时生成 nl；Anima 出图时有 nl 优先使用，否则回退 tag。正文已有 nl 时仍会照常使用。</p>
      </Collapsible>
    </div>
  </div>
</template>

<style scoped>
.be-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 0 12px; }
.conn-actions { display: flex; justify-content: flex-end; gap: 8px; flex-wrap: wrap; }
.prompt-copy-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 12px; }
.bbi-textarea { resize: vertical; }
@media (max-width: 640px) {
  .be-grid { grid-template-columns: 1fr; }
  .prompt-copy-row { align-items: flex-start; flex-direction: column; }
}
</style>
