import { useEffect, useState } from 'react';
import { Cpu, Download, RefreshCw } from 'lucide-react';
import { Button, Field, Input, Select, Textarea, SectionTitle } from './ui';
import type { ImportConfig } from './model';
import { listLocalModels } from './imports';
import { downloadModel, downloadStatus, MODEL_PRESETS, runnerHealth, runnerModels, type DownloadJob, type ModelInfo, type RunnerStatus } from './modelRunner';

export default function ModelSettings({ config, onChange, disabled, notify }: {
  config: ImportConfig; onChange: (patch: Partial<ImportConfig>) => void; disabled: boolean; notify: (message: string, error?: boolean) => void;
}) {
  const [status, setStatus] = useState<RunnerStatus | null>(null);
  const [downloaded, setDownloaded] = useState<ModelInfo[]>([]);
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);
  const [connecting, setConnecting] = useState(false);
  const [job, setJob] = useState<DownloadJob | null>(null);
  const [error, setError] = useState('');
  const downloading = job?.status === 'queued' || job?.status === 'downloading';
  useEffect(() => { setStatus(null); setDownloaded([]); setError(''); }, [config.runnerEndpoint]);
  useEffect(() => {
    if (!job || !['queued', 'downloading'].includes(job.status)) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const next = await downloadStatus(config.runnerEndpoint, job.id);
        if (cancelled) return;
        setJob(next);
        if (next.status === 'complete') { setDownloaded((await runnerModels(config.runnerEndpoint)).downloaded); notify('Model downloaded.'); }
        if (next.status === 'failed') notify(next.message, true);
      } catch (error) { if (!cancelled) { setJob({ ...job, status: 'failed', message: 'Connection lost. Reconnect to check the model cache.' }); notify(error instanceof Error ? error.message : 'Download status unavailable.', true); } }
    }, 1200);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [job, config.runnerEndpoint, notify]);
  const connect = async () => {
    setConnecting(true); setError('');
    try {
      if (config.engine === 'huggingface') {
        const [health, models] = await Promise.all([runnerHealth(config.runnerEndpoint), runnerModels(config.runnerEndpoint)]);
        setStatus(health); setDownloaded(models.downloaded);
      } else setOllamaModels(await listLocalModels(config.endpoint));
    } catch (error) { setError(error instanceof Error ? error.message : 'Connection failed.'); setStatus(null); }
    finally { setConnecting(false); }
  };
  const startDownload = async () => {
    if (!window.confirm(`Download ${config.hfModel} from Hugging Face? Model weights can be hundreds of MB or larger. Documents will not be uploaded. Review the model license before downloading.`)) return;
    try { setJob(await downloadModel(config)); }
    catch (error) { notify(error instanceof Error ? error.message : 'Could not start download.', true); }
  };
  const ready = downloaded.some(model => model.repo_id === config.hfModel && model.revision === config.hfRevision && model.adapter === config.adapter);
  const preset = MODEL_PRESETS.find(model => model.repo_id === config.hfModel && model.adapter === config.adapter);
  return <section className="card form-section model-settings"><SectionTitle title="Extraction"><span className="cpu-badge"><Cpu size={12} />{config.engine === 'rules' ? 'Rules' : config.device === 'cpu' ? 'CPU' : 'GPU'}</span></SectionTitle>
    <fieldset disabled={disabled || downloading} className="plain-fieldset"><Field label="Engine"><Select value={config.engine} onChange={e => onChange({ engine: e.target.value as ImportConfig['engine'] })}><option value="huggingface">Hugging Face · local</option><option value="ollama">Ollama · local</option><option value="rules">Keyword rules</option></Select></Field>
    {config.engine !== 'rules' && <>
      <Field label="Local endpoint"><Input value={config.engine === 'huggingface' ? config.runnerEndpoint : config.endpoint} onChange={e => onChange(config.engine === 'huggingface' ? { runnerEndpoint: e.target.value } : { endpoint: e.target.value })} /></Field><div className="model-connection"><Button disabled={connecting} onClick={() => void connect()}><RefreshCw size={14} />{connecting ? 'Connecting…' : 'Connect'}</Button><span>{config.engine === 'huggingface' ? status ? 'Connected' : 'Disconnected' : ollamaModels.length ? 'Connected' : ''}</span></div>{error && <p className="small danger-text">{error}</p>}
      {config.engine === 'huggingface' ? <><Field label="Model"><Select value={preset ? preset.repo_id : 'custom'} onChange={e => { const model = MODEL_PRESETS.find(m => m.repo_id === e.target.value); if (model) onChange({ hfModel: model.repo_id, hfRevision: model.revision, adapter: model.adapter as ImportConfig['adapter'] }); else onChange({ hfModel: 'owner/model', hfRevision: 'main' }); }}>{MODEL_PRESETS.map(model => <option key={model.repo_id} value={model.repo_id}>{model.name}</option>)}<option value="custom">Custom repository</option></Select></Field><Field label="Hugging Face repository"><Input value={config.hfModel} placeholder="owner/model" onChange={e => onChange({ hfModel: e.target.value })} /></Field><div className="form-grid"><Field label="Revision"><Input value={config.hfRevision} onChange={e => onChange({ hfRevision: e.target.value })} /></Field><Field label="Adapter"><Select value={config.adapter} onChange={e => onChange({ adapter: e.target.value as ImportConfig['adapter'] })}><option value="laya">Laya decisions</option><option value="qa">Extractive QA</option></Select></Field></div><div className="model-download-row"><span className={`model-cache-status ${ready ? 'ready' : ''}`}>{ready ? 'Downloaded' : 'Not downloaded'}</span><Button onClick={() => void startDownload()} disabled={!status || ready}><Download size={14} />Download weights</Button></div></> : <Field label="Installed model">{ollamaModels.length ? <Select value={config.model} onChange={e => onChange({ model: e.target.value })}>{!ollamaModels.includes(config.model) && <option>{config.model}</option>}{ollamaModels.map(model => <option key={model}>{model}</option>)}</Select> : <Input value={config.model} onChange={e => onChange({ model: e.target.value })} />}</Field>}
      <div className="form-grid"><Field label="Device"><Select value={config.device} onChange={e => onChange({ device: e.target.value })}><option value="cpu">CPU</option>{(status?.devices.filter(device => device !== 'cpu') || ['cuda:0', 'mps']).map(device => <option key={device} value={device}>{device === 'mps' ? 'GPU · Apple Metal' : `GPU · CUDA ${device.split(':')[1]}`}</option>)}{status && !status.devices.includes(config.device) && config.device !== 'cpu' && <option value={config.device}>{config.device} · unavailable</option>}</Select></Field><Field label="CPU threads"><Input type="number" min="1" max="64" value={config.cpuThreads} onChange={e => onChange({ cpuThreads: e.target.valueAsNumber || 1 })} /></Field><Field label="Timeout (seconds)"><Input type="number" min="30" max="600" value={config.modelTimeout} onChange={e => onChange({ modelTimeout: e.target.valueAsNumber || 120 })} /></Field>{config.engine === 'huggingface' && <Field label="Confidence threshold"><Input type="number" min="0" max="1" step="0.05" value={config.confidenceThreshold} onChange={e => onChange({ confidenceThreshold: e.target.valueAsNumber || 0 })} /></Field>}</div>{config.engine === 'huggingface' && config.adapter === 'laya' && <Field label="Candidates per field"><Input type="number" min="2" max="12" value={config.maxCandidates} onChange={e => onChange({ maxCandidates: e.target.valueAsNumber || 2 })} /></Field>}<details className="model-advanced"><summary>Instructions</summary><Field label="Extraction instructions"><Textarea value={config.instructions} onChange={e => onChange({ instructions: e.target.value })} /></Field></details>
      {config.engine === 'huggingface' && <details className="model-advanced"><summary>Setup & limits</summary><code>python -m backend.server</code><p>Install backend requirements first. Laya selects source candidates; it does not generate text. CPU is the default. GPU needs a compatible PyTorch runtime. Weights download from Hugging Face; extraction stays local.</p></details>}
    </>}
    {config.engine === 'rules' && <p className="small muted">Match labels and aliases configured under Fields & format.</p>}
    </fieldset>{status && config.engine === 'huggingface' && config.adapter === 'laya' && !status.laya_installed && <p className="small danger-text">Install model runtime: <code>pip install -r backend/requirements-models.txt</code></p>}{job && <div className={`model-job ${job.status === 'failed' ? 'danger-text' : ''}`} role="status">{job.message}</div>}
  </section>;
}
