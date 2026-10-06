import { localEndpoint, type DataRow } from './imports';
import type { ImportConfig } from './model';
import manifest from '../backend/models.json';
import { desktopRunnerEndpoint } from './runtime';

export const MODEL_PRESETS = manifest.presets;
export type ModelInfo = { repo_id: string; revision: string; adapter: string; resolved_revision?: string };
export type RunnerStatus = { status: string; devices: string[]; default_model: string; laya_installed: boolean };
export type DownloadJob = { id: string; status: 'queued' | 'downloading' | 'complete' | 'failed'; message: string; repo_id: string };
export type ExtractionResult = { values: DataRow; confidence: Record<string, number>; warnings: string[]; device: string; model: string };

async function runnerRequest<T>(endpoint: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`${localEndpoint(desktopRunnerEndpoint(endpoint))}${path}`, {
    method: body ? 'POST' : 'GET', headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined, signal: signal || AbortSignal.timeout(15000),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(typeof payload.detail === 'string' ? payload.detail : `Local runner: HTTP ${response.status}`);
  return payload as T;
}
export const modelSpec = (config: ImportConfig) => ({ repo_id: config.hfModel, revision: config.hfRevision, adapter: config.adapter });
export const runnerHealth = (endpoint: string, signal?: AbortSignal) => runnerRequest<RunnerStatus>(endpoint, '/health', undefined, signal);
export const runnerModels = (endpoint: string) => runnerRequest<{ presets: ModelInfo[]; downloaded: ModelInfo[] }>(endpoint, '/models');
export const downloadModel = (config: ImportConfig) => runnerRequest<DownloadJob>(config.runnerEndpoint, '/models/download', modelSpec(config));
export const downloadStatus = (endpoint: string, jobId: string) => runnerRequest<DownloadJob>(endpoint, `/models/jobs/${encodeURIComponent(jobId)}`);
export async function extractHFDocument(text: string, config: ImportConfig, signal: AbortSignal): Promise<ExtractionResult> {
  const result = await runnerRequest<ExtractionResult>(config.runnerEndpoint, '/extract', {
    ...modelSpec(config), text, device: config.device, cpu_threads: config.cpuThreads,
    confidence_threshold: config.confidenceThreshold, max_candidates: config.maxCandidates,
    instructions: config.instructions, fields: config.fields.map(field => ({ column: field.column, target: field.target, terms: field.terms, type: field.type })),
  }, signal);
  if (!result.values || typeof result.values !== 'object' || Array.isArray(result.values)) throw new Error('The model runner returned invalid extraction values.');
  const values = Object.fromEntries(config.fields.map(field => {
    const value = result.values[field.column] ?? '';
    if (typeof value !== 'string' && typeof value !== 'number') throw new Error(`Invalid model value for ${field.column}.`);
    return [field.column, String(value).slice(0, 10000)];
  }));
  if (result.device !== config.device) throw new Error(`Requested ${config.device}, but the runner used ${result.device}.`);
  const confidence = Object.fromEntries(Object.entries(result.confidence || {}).filter(([, value]) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1));
  const warnings = Array.isArray(result.warnings) ? result.warnings.filter(value => typeof value === 'string').map(value => value.slice(0, 1000)) : [];
  return { ...result, values, confidence, warnings, model: typeof result.model === 'string' ? result.model : config.hfModel };
}
