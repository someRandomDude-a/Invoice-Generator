import { useEffect, useRef, useState, type InputHTMLAttributes } from 'react';
import { FolderOpen, Cpu, SlidersHorizontal, Table2, Plus, Trash2, Save, Download, Upload, Square, Check, AlertTriangle, FileText, Pencil, X } from 'lucide-react';
import Papa from 'papaparse';
import { Button, Field, Input, Select, Toggle, EmptyState, SectionTitle } from './ui';
import { uid, workspaceSchema, type ImportConfig, type Invoice, type Workspace } from './model';
import { fieldDefinitions, parseBatch } from './csv';
import { consolidateRows, defaultImportConfig, documentText, extractRecord, extractTerms, extractWithModel, groupedCSV, importConfigError, listLocalModels, normalizeField, numberedSourceRows, sourceDate, sourceRowsToCSV, withCustomFields, zipCSV, type SourceRow } from './imports';
import { downloadBytes, downloadFile } from './storage';
import ModelSettings from './ModelSettings';
import { extractHFDocument, runnerHealth, type ExtractionResult } from './modelRunner';
import { desktopRunnerEndpoint } from './runtime';

const directoryProps = { webkitdirectory: '', directory: '' } as InputHTMLAttributes<HTMLInputElement>;
function rowIssues(row: SourceRow, config: ImportConfig) {
  const issues: string[] = [];
  for (const field of config.fields) {
    const value = row.values[field.column] || '';
    if (field.required && !value.trim()) issues.push(`${field.column} is required`);
    if (value && field.type === 'number' && !Number.isFinite(Number(value))) issues.push(`${field.column} is not a number`);
    if (value && field.type === 'date') {
      const date = new Date(`${value}T12:00:00Z`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) issues.push(`${field.column} must be a valid YYYY-MM-DD date`);
    }
  }
  return issues;
}

export default function DirectoryImport({ workspace, onConfigSave, onSaveInvoices, onPendingChange, notify }: {
  workspace: Workspace; onConfigSave: (config: ImportConfig) => void; onSaveInvoices: (invoices: Invoice[]) => boolean;
  onPendingChange: (warning: string) => void;
  notify: (text: string, error?: boolean) => void;
}) {
  const [initialConfig] = useState<ImportConfig>(() => {
    const config = workspace.importConfig || defaultImportConfig();
    return { ...config, runnerEndpoint: desktopRunnerEndpoint(config.runnerEndpoint) };
  });
  const [config, setConfig] = useState<ImportConfig>(initialConfig);
  const [tab, setTab] = useState<'sources' | 'fields' | 'review'>('sources');
  const [files, setFiles] = useState<File[]>([]);
  const [rows, setRows] = useState<SourceRow[]>([]);
  const [errors, setErrors] = useState<{ path: string; message: string }[]>([]);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0, path: '' });
  const [templateId, setTemplateId] = useState(workspace.templates[0].id);
  const [folder, setFolder] = useState('all');
  const [editing, setEditing] = useState<SourceRow | null>(null);
  const [stale, setStale] = useState(false);
  const [saved, setSaved] = useState(false);
  const [finalizedRows, setFinalizedRows] = useState<SourceRow[]>([]);
  const folderInput = useRef<HTMLInputElement>(null);
  const filesInput = useRef<HTMLInputElement>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    const configDirty = JSON.stringify(config) !== JSON.stringify(workspace.importConfig || initialConfig);
    onPendingChange(running ? 'A scan is running. Leaving will stop it and discard its review data. Continue?' : rows.length ? 'Review rows are kept in memory. Export them before leaving. Leave and discard the review data?' : configDirty ? 'Import configuration has unsaved changes. Leave without saving?' : '');
  }, [config, initialConfig, workspace.importConfig, rows.length, running, onPendingChange]);
  const change = (patch: Partial<ImportConfig>, affectsExtraction = true) => {
    setConfig(current => ({ ...current, ...patch }));
    if (Object.keys(patch).some(key => !['hierarchy', 'outputName', 'delimiter'].includes(key))) setSaved(false);
    if (affectsExtraction && rows.length) setStale(true);
  };
  const selectFiles = (list: FileList | null) => {
    if (!list?.length) return;
    if (list.length > 500) { notify('Select a directory with at most 500 files, or use a smaller subfolder.', true); return; }
    const allFiles = Array.from(list);
    if (allFiles.reduce((sum, file) => sum + file.size, 0) > 100 * 1024 * 1024) { notify('Selected files exceed the 100 MB total limit. Choose a smaller folder.', true); return; }
    setFiles(allFiles); setRows([]); setErrors([]); setSaved(false); setStale(false); setFolder('all');
  };
  const eligible = files.filter(file => {
    const path = file.webkitRelativePath || file.name;
    const extension = `.${file.name.split('.').at(-1)?.toLowerCase()}`;
    return config.extensions.toLowerCase().split(',').map(s => s.trim()).includes(extension) && (config.recursive || path.split('/').length <= 2);
  });
  const scan = async () => {
    const error = importConfigError(config);
    if (error) { notify(error, true); return; }
    if (!eligible.length) { notify('No selected files match your extension and recursion settings.', true); return; }
    if (rows.length && !window.confirm('Run extraction again? This will replace the current review rows and manual corrections.')) return;
    const abort = new AbortController(); controller.current = abort;
    setRunning(true); setRows([]); setErrors([]); setStale(false); setSaved(false); setProgress({ done: 0, total: eligible.length, path: '' });
    let count = 0;
    const collected: SourceRow[] = [];
    try {
      if (config.engine === 'ollama' && eligible.some(file => !/\.(csv|json)$/i.test(file.name))) {
        const installed = await listLocalModels(config.endpoint, AbortSignal.any([abort.signal, AbortSignal.timeout(10000)]));
        if (!installed.includes(config.model) && !installed.includes(`${config.model}:latest`)) throw new Error(`Model “${config.model}” is not installed. Install it locally in Ollama before scanning.`);
      }
      if (config.engine === 'huggingface' && eligible.some(file => !/\.(csv|json)$/i.test(file.name))) {
        const health = await runnerHealth(config.runnerEndpoint, AbortSignal.any([abort.signal, AbortSignal.timeout(10000)]));
        if (!health.devices.includes(config.device)) throw new Error(`Device ${config.device} is unavailable. Select CPU or configure your GPU runtime.`);
      }
      for (const file of [...eligible].sort((a, b) => (a.webkitRelativePath || a.name).localeCompare(b.webkitRelativePath || b.name))) {
        if (abort.signal.aborted) break;
        const path = file.webkitRelativePath || file.name;
        setProgress(current => ({ ...current, path }));
        try {
          const document = await documentText(file);
          if (abort.signal.aborted) break;
          let modelResult: ExtractionResult | undefined;
          if (!document.records && config.engine === 'huggingface') modelResult = await extractHFDocument(document.text, config, AbortSignal.any([abort.signal, AbortSignal.timeout(config.modelTimeout * 1000)]));
          const extracted = document.records ? document.records.map(record => extractRecord(record, config)) : [modelResult ? modelResult.values : config.engine === 'ollama' ? await extractWithModel(document.text, config, AbortSignal.any([abort.signal, AbortSignal.timeout(config.modelTimeout * 1000)])) : extractTerms(document.text, config)];
          if (abort.signal.aborted) break;
          if (collected.length + extracted.length > 1000) throw new Error('The consolidated import would exceed 1,000 rows. Split the source directory into smaller batches.');
          for (const [index, values] of extracted.entries()) {
            const row: SourceRow = { id: uid(), path: extracted.length > 1 ? `${path}#row=${index + 1}` : path, modified: new Date(file.lastModified).toISOString().slice(0, 10),
              values: Object.fromEntries(config.fields.map(field => [field.column, normalizeField(values[field.column] || field.fallback, field.type)])),
              warnings: [...document.warnings, ...(modelResult?.warnings || []), ...(config.engine === 'ollama' && !document.records ? ['Review model values.', ...(document.text.length > 24000 ? ['Model input truncated to 24,000 characters.'] : [])] : [])],
              confidence: modelResult?.confidence, device: modelResult?.device, model: modelResult?.model,
            };
            const date = sourceDate(row, config);
            if (!date) row.warnings.push('No grouping date found; exported under undated.');
            collected.push(row);
          }
          setRows([...collected]);
        } catch (error) {
          if (abort.signal.aborted) break;
          setErrors(current => [...current, { path, message: error instanceof Error ? error.message : 'Extraction failed.' }]);
        }
        count++; setProgress(current => ({ ...current, done: count }));
      }
      if (!abort.signal.aborted) notify(`Scan complete. ${collected.length} rows extracted. Review them before exporting or creating invoices.`);
      else notify('Scan stopped. Completed rows are available for review.');
      setTab('review');
    } catch (error) { notify(error instanceof Error ? error.message : 'Could not start the scan.', true); }
    finally { setRunning(false); controller.current = null; }
  };
  const saveConfig = () => {
    const error = importConfigError(config);
    if (error) { notify(error, true); return; }
    const result = workspaceSchema.safeParse({ ...workspace, importConfig: config });
    if (!result.success) { notify(`Invalid configuration: ${result.error.issues[0].message}`, true); return; }
    onConfigSave(config);
  };
  const exportRows = () => {
    if (stale || running || !rows.length) return;
    const error = importConfigError(config);
    if (error) { notify(error, true); return; }
    let exportData: SourceRow[];
    try { exportData = saved ? finalizedRows : numberedSourceRows(rows, config, workspace); }
    catch (error) { notify(error instanceof Error ? error.message : 'Invalid numbering configuration.', true); return; }
    const groups = groupedCSV(exportData.map(row => ({ ...row, warnings: [...row.warnings, ...rowIssues(row, config)] })), config);
    const name = config.outputName.replace(/[^a-z0-9_-]/gi, '_') || 'invoices';
    if (config.hierarchy === 'flat') downloadFile(`${name}.csv`, groups.values().next().value || '', 'text/csv;charset=utf-8');
    else downloadBytes(`${name}-by-date.zip`, zipCSV(groups), 'application/zip');
    notify('Export downloaded. Missing grouping dates are placed in undated/.');
  };
  const exportSingleCSV = () => {
    const error = importConfigError(config);
    if (error) { notify(error, true); return; }
    try {
      const data = saved ? finalizedRows : numberedSourceRows(rows, config, workspace);
      const records = consolidateRows(data.map(row => ({ ...row, warnings: [...row.warnings, ...rowIssues(row, config)] })), config);
      downloadFile('consolidated-data.csv', Papa.unparse(records, { delimiter: config.delimiter, escapeFormulae: true }), 'text/csv;charset=utf-8');
    } catch (error) { notify(error instanceof Error ? error.message : 'Could not export CSV.', true); }
  };
  const createInvoices = () => {
    const template = workspace.templates.find(t => t.id === templateId);
    if (!template || stale || !rows.length || saved) return;
    for (const field of fieldDefinitions(template).filter(f => f.required)) if (!config.fields.some(f => f.target === field.key)) { notify(`Map an output field to “${field.label}” first.`, true); return; }
    const invalid = rows.find(row => rowIssues(row, config).length);
    if (invalid) { notify(`Review ${invalid.path}: ${rowIssues(invalid, config).join('; ')}`, true); return; }
    try {
      const converted = sourceRowsToCSV(rows, config, workspace);
      const parsed = parseBatch(converted.csv, workspace, template);
      if (parsed.errors.length) { notify(`No invoices created. ${parsed.errors.slice(0, 3).join(' · ')}`, true); return; }
      if (!window.confirm(`Create ${parsed.invoices.length} invoices from the reviewed data? These will use the selected template and your current business settings. Skipped and failed files are not included.`)) return;
      if (onSaveInvoices(parsed.invoices)) {
        setFinalizedRows(numberedSourceRows(rows, config, workspace));
        setSaved(true);
        const updated = { ...config, nextSequence: converted.nextSequence };
        setConfig(updated); onConfigSave(updated);
      }
    } catch (error) { notify(error instanceof Error ? error.message : 'Could not create invoices.', true); }
  };
  const folders = [...new Set(rows.map(row => row.path.split('/').slice(0, -1).join('/') || '(root)'))].sort();
  const visibleRows = rows.filter(row => folder === 'all' || (row.path.split('/').slice(0, -1).join('/') || '(root)') === folder);
  const needsReview = rows.filter(row => rowIssues(row, config).length).length;
  return <>
    <div className="page-heading"><div><div className="eyebrow">FROM FOLDERS TO FINISHED RECORDS</div><h1>Data import studio</h1><p>Read locally. Map thoughtfully. Export in your own format.</p></div><Button disabled={running} onClick={saveConfig}><Save size={16} />Save configuration</Button></div>
    <div className="import-privacy"><Cpu size={16} /><strong>Local extraction</strong><span>{config.engine === 'rules' ? 'Rules' : config.device === 'cpu' ? 'CPU' : 'GPU'}</span></div>
    <div className="import-tabs">{([{ id: 'sources' as const, title: 'Sources & model', icon: FolderOpen }, { id: 'fields' as const, title: 'Fields & format', icon: SlidersHorizontal }, { id: 'review' as const, title: `Review & export${rows.length ? ` (${rows.length})` : ''}`, icon: Table2 }]).map(({ id, title, icon: Icon }) => <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}><Icon size={16} />{title}</button>)}</div>
    {tab === 'sources' && <div className="import-source-grid"><section className="card form-section"><SectionTitle title="Choose your source" /><div className="source-buttons"><Button disabled={running} onClick={() => folderInput.current?.click()}><FolderOpen size={18} />Choose entire folder</Button><Button disabled={running} onClick={() => filesInput.current?.click()}><Upload size={16} />Choose files</Button></div><input {...directoryProps} ref={folderInput} type="file" multiple className="visually-hidden" aria-label="Import an entire directory" onChange={e => selectFiles(e.target.files)} /><input ref={filesInput} type="file" multiple accept=".csv,.txt,.md,.json,.html,.htm,.pdf,.docx" className="visually-hidden" aria-label="Import source documents" onChange={e => selectFiles(e.target.files)} /><div className="selected-source"><FolderOpen size={25} /><strong>{files.length ? (files[0].webkitRelativePath.split('/')[0] || `${files.length} selected files`) : 'No folder selected'}</strong><span>{files.length ? `${eligible.length} matching files · ${files.length - eligible.length} excluded by your filters` : 'Select a folder to include its subfolders and files.'}</span></div><fieldset disabled={running} className="plain-fieldset"><Toggle label="Scan subfolders recursively" checked={config.recursive} onChange={value => change({ recursive: value })} /><Field label="Included extensions" hint="Comma-separated extensions. Unsupported files are reported, never silently converted."><Input value={config.extensions} onChange={e => change({ extensions: e.target.value })} /></Field></fieldset><div className="scan-limits"><strong>Supported documents</strong><p>Text-based PDF, DOCX, TXT, Markdown, HTML, JSON and CSV. Scanned PDFs and image OCR are not supported. Each unstructured document produces one review row; CSV / JSON may produce multiple rows.</p><small>Up to 500 files / 100 MB total · 10 MB per file · 1,000 output rows</small></div><Button className="full-width" variant="primary" disabled={running || !eligible.length} onClick={() => void scan()}><Cpu size={16} />Scan & extract</Button></section>
    <ModelSettings config={config} onChange={change} disabled={running} notify={notify} /></div>}
    {tab === 'fields' && <><fieldset disabled={running} className="plain-fieldset"><div className="card output-settings form-section"><SectionTitle title="Output organization" /><div className="form-grid columns-3"><Field label="Folder structure"><Select value={config.hierarchy} onChange={e => change({ hierarchy: e.target.value as ImportConfig['hierarchy'] }, false)}><option value="year-month">Year / month / file.csv (ZIP)</option><option value="year">Year / file.csv (ZIP)</option><option value="flat">Single CSV file</option></Select></Field><Field label="Grouping date comes from"><Select value={config.dateSource} onChange={e => change({ dateSource: e.target.value as ImportConfig['dateSource'] }, false)}><option value="field">Mapped invoice date</option><option value="path">Source path · YYYY/MM or YYYY-MM</option><option value="modified">File’s last-modified date</option></Select></Field><Field label="CSV filename"><Input value={config.outputName} maxLength={100} onChange={e => change({ outputName: e.target.value }, false)} /></Field><Field label="CSV delimiter"><Select value={config.delimiter} onChange={e => change({ delimiter: e.target.value as ImportConfig['delimiter'] }, false)}><option value=",">Comma</option><option value=";">Semicolon</option><option value={'\t'}>Tab</option></Select></Field><Field label="Invoice number pattern" hint="Tokens: {prefix}, {year}, {month}, {day}, {seq:4}"><Input value={config.numberPattern} onChange={e => change({ numberPattern: e.target.value }, false)} /></Field><Field label="Starting sequence"><Input type="number" min="1" max="999999999" value={config.nextSequence} onChange={e => change({ nextSequence: e.target.valueAsNumber || 1 }, false)} /></Field></div><Toggle label="Keep invoice numbers found in source files" hint="When disabled, numbers are generated from your pattern. Repeated source numbers still group multiple items." checked={config.keepSourceNumbers} onChange={value => change({ keepSourceNumbers: value }, false)} /><p className="small muted">Unknown dates go into undated/. Grouping is for CSV organization; it never changes a populated invoice date.</p></div>
    <section className="card schema-card"><div className="library-header"><div><h2>Extraction & output schema</h2><p>Choose the terms to look for, CSV column names, invoice destinations and defaults.</p></div><Button disabled={config.fields.length >= 50} onClick={() => change({ fields: [...config.fields, { id: uid(), column: `extra_field_${config.fields.length + 1}`, target: '', terms: '', type: 'text', fallback: '', required: false }] })}><Plus size={15} />Add field</Button></div><div className="schema-template"><Field label="Invoice template for field destinations"><Select value={templateId} onChange={e => { setTemplateId(e.target.value); setSaved(false); }}>{workspace.templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</Select></Field><Button onClick={() => { const template = workspace.templates.find(t => t.id === templateId); if (template) change(withCustomFields(config, template)); }}><Plus size={14} />Add template’s custom fields</Button></div><div className="table-scroll"><table className="data-table schema-table"><thead><tr><th>CSV column</th><th>Terms / aliases (comma-separated)</th><th>Fill invoice field</th><th>Type</th><th>Fallback</th><th>Required</th><th /></tr></thead><tbody>{config.fields.map(field => {
      const update = (patch: Partial<typeof field>) => change({ fields: config.fields.map(f => f.id === field.id ? { ...f, ...patch } : f) });
      return <tr key={field.id}><td><Input aria-label={`CSV column for ${field.column}`} value={field.column} maxLength={100} onChange={e => update({ column: e.target.value })} /></td><td><Input aria-label={`Search terms for ${field.column}`} value={field.terms} placeholder="label, another label" onChange={e => update({ terms: e.target.value })} /></td><td><Select aria-label={`Invoice destination for ${field.column}`} value={field.target} onChange={e => update({ target: e.target.value })}><option value="">CSV only · no invoice field</option>{!fieldDefinitions(workspace.templates.find(t => t.id === templateId)).some(f => f.key === field.target) && field.target && <option value={field.target}>{field.target} (another template)</option>}{fieldDefinitions(workspace.templates.find(t => t.id === templateId)).map(def => <option key={def.key} value={def.key}>{def.label}</option>)}</Select></td><td><Select aria-label={`Type for ${field.column}`} value={field.type} onChange={e => update({ type: e.target.value as typeof field.type })}><option value="text">Text</option><option value="number">Number</option><option value="date">Date</option></Select></td><td><Input aria-label={`Fallback for ${field.column}`} value={field.fallback} onChange={e => update({ fallback: e.target.value })} /></td><td><input type="checkbox" aria-label={`${field.column} required`} checked={field.required} onChange={e => update({ required: e.target.checked })} /></td><td><button className="icon-button danger-text" disabled={config.fields.length <= 1} aria-label={`Remove ${field.column}`} onClick={() => change({ fields: config.fields.filter(f => f.id !== field.id) })}><Trash2 size={15} /></button></td></tr>;
    })}</tbody></table></div><div className="schema-footer"><span>Metadata columns source_file, source_folder, year, month and scan_warnings are appended automatically.</span><Button onClick={() => { if (window.confirm('Reset all extraction fields to their defaults?')) change({ fields: defaultImportConfig().fields }); }}>Reset fields</Button></div></section></fieldset></>}
    {running && <div className="scan-progress card" role="status"><Cpu size={21} /><div><strong>Scanning {progress.done} / {progress.total} files</strong><span>{progress.path || 'Checking the local model…'}</span><progress value={progress.done} max={progress.total || 1} /></div><Button variant="danger" onClick={() => controller.current?.abort()}><Square size={13} />Stop scan</Button></div>}
    {tab === 'review' && <>
      {stale && <div className="storage-error"><AlertTriangle size={20} /><p>Extraction settings changed. Re-scan the source files before exporting or creating invoices.</p><Button disabled={running} onClick={() => void scan()}>Re-scan</Button></div>}
      {errors.length > 0 && <details className="card scan-errors" open><summary>{errors.length} files could not be extracted</summary>{errors.map((error, index) => <p key={index}><strong>{error.path}</strong><span>{error.message}</span></p>)}</details>}
      {rows.length ? <>
        <div className="scan-summary"><div><strong>{rows.length}</strong><span>consolidated rows</span></div><div><strong>{folders.length}</strong><span>source folders</span></div><div><strong>{needsReview}</strong><span>rows need corrections</span></div><div><strong>{files.length - eligible.length}</strong><span>filtered-out files</span></div></div>
        <section className="card review-card">
          <div className="library-header"><h2>Review extracted data</h2><Select aria-label="Filter by source folder" value={folder} onChange={e => setFolder(e.target.value)}><option value="all">All source folders</option>{folders.map(folder => <option key={folder}>{folder}</option>)}</Select></div>
          <div className="table-scroll"><table className="data-table review-table">
            <thead><tr><th>Source / state</th>{config.fields.filter(f => f.required || ['invoice_number', 'issue_date', 'quantity'].includes(f.target)).map(field => <th key={field.id}>{field.column}</th>)}<th /></tr></thead>
            <tbody>{visibleRows.map(row => <tr key={row.id}>
              <td><strong>{row.path}</strong><span className={`table-subtext ${rowIssues(row, config).length ? 'danger-text' : ''}`}>{rowIssues(row, config).length ? rowIssues(row, config).join(' · ') : 'Ready to review'}</span>{row.warnings.length > 0 && <details className="row-warnings"><summary>{row.warnings.length} notices</summary>{row.warnings.map((warning, index) => <p key={index}>{warning}</p>)}</details>}</td>
              {config.fields.filter(f => f.required || ['invoice_number', 'issue_date', 'quantity'].includes(f.target)).map(field => <td key={field.id}>{row.values[field.column] || '—'}</td>)}
              <td><div className="row-actions"><button className="icon-button" disabled={running} aria-label={`Edit ${row.path}`} onClick={() => setEditing(structuredClone(row))}><Pencil size={15} /></button><button className="icon-button danger-text" disabled={running} aria-label={`Remove ${row.path}`} onClick={() => { setRows(current => current.filter(r => r.id !== row.id)); setSaved(false); }}><Trash2 size={15} /></button></div></td>
            </tr>)}</tbody>
          </table></div>
          <div className="review-actions"><div><Field label="Template for generated invoices"><Select disabled={running} value={templateId} onChange={e => { setTemplateId(e.target.value); setSaved(false); }}>{workspace.templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</Select></Field><Button disabled={running || stale || needsReview > 0 || saved} onClick={createInvoices}><FileText size={16} />{saved ? 'Invoices created' : 'Create invoices'}</Button></div><div><Button disabled={running || stale} onClick={exportSingleCSV}><Download size={16} />Single CSV</Button><Button variant="primary" disabled={running || stale} onClick={exportRows}><Download size={16} />{config.hierarchy === 'flat' ? 'Export CSV' : 'Export organized ZIP'}</Button></div></div>
        </section>
      </> : <EmptyState icon={<Table2 size={27} />} title="No imported data" description="Select files or a folder, then scan." action="Choose sources" onAction={() => setTab('sources')} />}
    </>}
    {editing && <div className="modal-backdrop" onClick={() => setEditing(null)}>
      <div className="card row-editor-modal" role="dialog" aria-modal="true" aria-label={`Edit ${editing.path}`} onClick={e => e.stopPropagation()} onKeyDown={e => { if (e.key === 'Escape') setEditing(null); }}>
        <div className="modal-header"><div><h2>Review values</h2><p>{editing.path}{editing.device ? ` · ${editing.device}` : ''}</p></div><button className="icon-button" autoFocus aria-label="Close row editor" onClick={() => setEditing(null)}><X size={20} /></button></div>
        <div className="form-grid">{config.fields.map(field => <Field key={field.id} label={`${field.column}${field.required ? ' *' : ''}`} hint={editing.confidence?.[field.column] !== undefined ? `Model confidence: ${Math.round(editing.confidence[field.column] * 100)}%` : field.target || 'CSV only'}>
          <Input value={editing.values[field.column] || ''} onChange={e => {
            const confidence = { ...editing.confidence }; delete confidence[field.column];
            setEditing({ ...editing, confidence, values: { ...editing.values, [field.column]: e.target.value } });
          }} />
        </Field>)}</div>
        {rowIssues(editing, config).length > 0 && <p className="row-issues">{rowIssues(editing, config).join(' · ')}</p>}
        <div className="row-editor-actions"><Button onClick={() => setEditing(null)}>Cancel</Button><Button variant="primary" onClick={() => { setRows(current => current.map(row => row.id === editing.id ? { ...editing, values: Object.fromEntries(config.fields.map(field => [field.column, normalizeField(editing.values[field.column] || '', field.type)])) } : row)); setEditing(null); setSaved(false); }}><Check size={16} />Apply corrections</Button></div>
      </div>
    </div>}
  </>;
}
