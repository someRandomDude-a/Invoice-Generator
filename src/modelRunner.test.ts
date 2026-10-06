import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultImportConfig } from './imports';
import { downloadModel, extractHFDocument } from './modelRunner';

afterEach(() => vi.unstubAllGlobals());
describe('Hugging Face local runtime', () => {
  it('defaults to Laya on CPU', () => {
    const config = defaultImportConfig();
    expect(config.engine).toBe('huggingface'); expect(config.hfModel).toBe('convaiinnovations/laya'); expect(config.device).toBe('cpu');
  });
  it('explicit downloads include model metadata, never documents', async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'job', status: 'queued' }) }); vi.stubGlobal('fetch', fetch);
    await downloadModel(defaultImportConfig());
    expect(fetch.mock.calls[0][0]).toBe('http://127.0.0.1:8000/models/download');
    const payload = JSON.parse(fetch.mock.calls[0][1].body);
    expect(payload.repo_id).toBe('convaiinnovations/laya'); expect(payload.text).toBeUndefined();
  });
  it('passes CPU/GPU device selection and extraction confidence to the local runner', async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ values: { customer_name: 'Alice' }, confidence: { customer_name: 0.9 }, warnings: [], device: 'cuda:0', model: 'convaiinnovations/laya' }) }); vi.stubGlobal('fetch', fetch);
    const config = { ...defaultImportConfig(), device: 'cuda:0' };
    const result = await extractHFDocument('Customer: Alice', config, new AbortController().signal);
    expect(result.values.customer_name).toBe('Alice');
    const payload = JSON.parse(fetch.mock.calls[0][1].body);
    expect(payload.device).toBe('cuda:0'); expect(payload.confidence_threshold).toBe(0.65); expect(payload.cpu_threads).toBe(4);
  });
  it('rejects a silent hardware fallback or remote runner', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ values: {}, confidence: {}, warnings: [], device: 'cpu', model: '' }) }));
    await expect(extractHFDocument('Source', { ...defaultImportConfig(), device: 'cuda:0' }, new AbortController().signal)).rejects.toThrow('runner used cpu');
    await expect(extractHFDocument('Source', { ...defaultImportConfig(), runnerEndpoint: 'https://example.com' }, new AbortController().signal)).rejects.toThrow('Remote');
  });
});
