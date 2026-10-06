import { useEffect, useMemo, useRef, useState } from 'react';
import { Upload, Download, Layers3, Check, ArrowRight, AlertCircle, Printer, Save, FileSpreadsheet, X } from 'lucide-react';
import { Button, Field, Input, Select, Textarea, Toggle } from './ui';
import { parseBatch, SAMPLE_CSV, invoiceSummaryCSV, fieldDefinitions } from './csv';
import { defaultImportConfig, guessMapping, mappedCSV, readCSV, renderNumber } from './imports';
import { formatMoney, totals, type ImportConfig, type Invoice, type Workspace } from './model';
import { downloadFile } from './storage';
import InvoiceDocument from './InvoiceDocument';

export default function Batch({ workspace, onSave, onPrint, onNumberingSave, onPendingChange, notify }: {
  workspace: Workspace; onSave: (invoices: Invoice[]) => boolean; onPrint: (invoices: Invoice[]) => void;
  onNumberingSave: (options: Pick<ImportConfig, 'numberPattern' | 'nextSequence' | 'keepSourceNumbers'>) => void;
  onPendingChange: (warning: string) => void;
  notify: (text: string, error?: boolean) => void;
}) {
  const [templateId, setTemplateId] = useState(workspace.templates[0].id);
  const [csv, setCsv] = useState('');
  const [fileName, setFileName] = useState('');
  const [result, setResult] = useState<ReturnType<typeof parseBatch> | null>(null);
  const [savedIds, setSavedIds] = useState<string[]>([]);
  const [preview, setPreview] = useState<Invoice | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [numberPattern, setNumberPattern] = useState(workspace.importConfig?.numberPattern || '{prefix}{year}{month}-{seq:4}');
  const [nextSequence, setNextSequence] = useState(workspace.importConfig?.nextSequence || 1);
  const [keepSourceNumbers, setKeepSourceNumbers] = useState(true);
  const [generatedNext, setGeneratedNext] = useState(nextSequence);
  const raw = useMemo(() => {
    try {
      if (csv.length > 2_000_000) throw new Error('CSV exceeds the 2 MB limit.');
      return { ...readCSV(csv), error: '' };
    } catch (error) { return { headers: [] as string[], rows: [] as Record<string, string>[], error: error instanceof Error ? error.message : 'Invalid CSV.' }; }
  }, [csv]);
  const headerKey = JSON.stringify(raw.headers);
  useEffect(() => {
    const template = workspace.templates.find(t => t.id === templateId);
    if (template) setMapping(guessMapping(JSON.parse(headerKey), template));
  }, [headerKey, templateId, workspace.templates]);
  const numberExample = (() => { try { return renderNumber(numberPattern, workspace.business.invoicePrefix, new Date().toISOString().slice(0, 10), nextSequence); } catch { return 'Check the pattern and sequence'; } })();
  const fileInput = useRef<HTMLInputElement>(null);
  const generated = result && !result.errors.length && result.invoices.length > 0;
  const saved = !!result?.invoices.length && result.invoices.every(i => savedIds.includes(i.id));
  useEffect(() => {
    onPendingChange(csv.trim() && !saved ? 'Your CSV batch has not been saved. Leave and discard the import and mapping?' : '');
  }, [csv, saved, onPendingChange]);
  const invalidate = () => { setResult(null); setSavedIds([]); setPreview(null); };
  const validate = () => {
    const template = workspace.templates.find(t => t.id === templateId);
    if (!template) { notify('Choose a template first.', true); return; }
    if (raw.error) { setResult({ invoices: [], errors: [raw.error], rows: 0 }); return; }
    const missing = fieldDefinitions(template).filter(field => field.required && !mapping[field.key]);
    if (missing.length) { setResult({ invoices: [], errors: missing.map(field => `Map a source column to ${field.label}.`), rows: raw.rows.length }); return; }
    try {
      const converted = mappedCSV(raw.rows, mapping, { ...defaultImportConfig(), numberPattern, nextSequence, keepSourceNumbers }, workspace);
      setGeneratedNext(converted.nextSequence);
      setResult(parseBatch(converted.csv, workspace, template)); setSavedIds([]); setPreview(null);
    } catch (error) { setResult({ invoices: [], errors: [error instanceof Error ? error.message : 'Invalid mapping or numbering pattern.'], rows: raw.rows.length }); }
  };
  const save = () => {
    if (!result || result.errors.length || !result.invoices.length) return false;
    if (saved) return true;
    if (onSave(result.invoices)) {
      setSavedIds(result.invoices.map(i => i.id));
      onNumberingSave({ numberPattern, nextSequence: generatedNext, keepSourceNumbers });
      return true;
    }
    return false;
  };
  return <>
    <div className="page-heading"><div><div className="eyebrow">LESS REPETITION. MORE RIDING.</div><h1>Batch generator</h1><p>One spreadsheet. A whole stack of invoices.</p></div><Button onClick={() => downloadFile('invoice-batch-sample.csv', SAMPLE_CSV, 'text/csv;charset=utf-8')}><Download size={16} />Download sample CSV</Button></div>
    <div className="batch-steps"><div className="active"><span>01</span><div><strong>Choose & import</strong><small>Select a template and upload your CSV</small></div></div><ArrowRight size={18} /><div className={generated ? 'active' : ''}><span>02</span><div><strong>Review invoices</strong><small>Check every detail before generating</small></div></div><ArrowRight size={18} /><div className={saved ? 'active' : ''}><span>03</span><div><strong>Save & print</strong><small>A complete batch, ready to go</small></div></div></div>
    <div className="batch-grid"><section className="card form-section"><h3 className="standalone-title">Set up your batch</h3><Field label="Invoice template"><Select value={templateId} onChange={e => { setTemplateId(e.target.value); invalidate(); }}>{workspace.templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</Select></Field><button className="csv-upload" onClick={() => fileInput.current?.click()}><FileSpreadsheet size={27} /><strong>{fileName || 'Choose a CSV file'}</strong><span>UTF-8 CSV · Up to 2 MB / 1,000 rows</span><Upload size={16} /></button><input ref={fileInput} type="file" accept=".csv,text/csv" aria-label="Import invoice CSV" className="visually-hidden" onChange={async e => {
      const file = e.target.files?.[0];
      if (!file) return;
      if (file.size > 2_000_000) { notify('CSV exceeds the 2 MB limit.', true); e.target.value = ''; return; }
      try { setCsv(await file.text()); setFileName(file.name); invalidate(); }
      catch { notify('Could not read the CSV file.', true); }
      if (fileInput.current) fileInput.current.value = '';
    }} /><Field label="Or paste CSV data"><Textarea className="csv-textarea" rows={8} value={csv} placeholder="customer_name,description,quantity,rate,tax_rate" onChange={e => { setCsv(e.target.value); setFileName(''); invalidate(); }} /></Field><Button className="full-width" variant="primary" disabled={!csv.trim()} onClick={validate}><Layers3 size={16} />Validate & preview batch</Button></section>
    <aside className="batch-guide"><div className="eyebrow">A QUICK FIELD GUIDE</div><h2>A little structure.<br />A lot less work.</h2><p>Download the sample file, replace the example data with your own, and upload it here.</p><ul><li><Check size={15} /><span><strong>Required:</strong> customer name, description, rate. Map any column names to these fields below.</span></li><li><Check size={15} /><span>Repeat <strong>invoice number</strong> for multiple items on the same invoice. Keep customer, dates, notes, payment and status identical.</span></li><li><Check size={15} /><span>Leave invoice number blank to generate one invoice per row using your numbering pattern.</span></li><li><Check size={15} /><span>Dates use <strong>YYYY-MM-DD</strong>. Amounts are numbers without currency symbols.</span></li><li><Check size={15} /><span>The selected template and current business profile are used for all imported invoices. Exported currency and business columns are reference-only.</span></li></ul><p className="small muted">A batch is all-or-nothing. Invalid rows and duplicate invoice numbers must be corrected before anything is saved.</p></aside></div>
    <section className="card form-section csv-mapping-panel"><div className="section-title"><h3>Map columns & invoice numbers</h3><span className="count-tag">{raw.rows.length} source rows</span></div>{raw.headers.length ? <><p className="small muted">Auto-matched columns are suggestions. Choose exactly where your values go. Unmapped optional fields use invoice defaults.</p><div className="mapping-grid">{fieldDefinitions(workspace.templates.find(t => t.id === templateId)).map(field => <Field key={field.key} label={`${field.label}${field.required ? ' *' : ''}`}><Select value={mapping[field.key] || ''} onChange={e => { setMapping(current => ({ ...current, [field.key]: e.target.value })); invalidate(); }}><option value="">{field.required ? 'Choose a source column' : 'Not mapped · use default'}</option>{raw.headers.map(header => <option key={header}>{header}</option>)}</Select></Field>)}</div></> : <p className="small muted">Upload or paste a CSV to configure source-column mappings.</p>}<div className="numbering-config"><div className="form-grid"><Field label="Invoice number pattern" hint="Tokens: {prefix}, {year}, {month}, {day}, {seq:4}"><Input value={numberPattern} onChange={e => { setNumberPattern(e.target.value); invalidate(); }} /></Field><Field label="Starting sequence" hint={`Preview: ${numberExample}`}><Input type="number" min="1" max="999999999" value={nextSequence} onChange={e => { setNextSequence(e.target.valueAsNumber || 1); invalidate(); }} /></Field></div><Toggle label="Keep invoice numbers from the CSV" hint="Disable to regenerate numbers while preserving multi-item groups." checked={keepSourceNumbers} onChange={value => { setKeepSourceNumbers(value); invalidate(); }} /></div><Button variant="primary" disabled={!csv.trim()} onClick={validate}><Layers3 size={16} />Validate mapped batch</Button></section>
    {result && <section className="card batch-results"><div className="section-title"><h3>{result.errors.length ? <><AlertCircle size={18} />Let’s fix a few things</> : <><Check size={18} />{result.invoices.length} invoices ready</>}</h3><span className="muted small">{result.rows} item rows</span></div>{result.errors.length ? <div className="error-list" role="alert"><p>No invoices have been created. Correct the CSV and validate again.</p><ul>{result.errors.slice(0, 30).map((error, i) => <li key={i}>{error}</li>)}</ul>{result.errors.length > 30 && <p>…and {result.errors.length - 30} more errors.</p>}</div> : <><div className="table-scroll"><table className="data-table"><thead><tr><th>Invoice</th><th>Customer</th><th>Items</th><th>Total</th><th /></tr></thead><tbody>{result.invoices.map(invoice => <tr key={invoice.id}><td><strong>{invoice.number}</strong></td><td>{invoice.customer.name}</td><td>{invoice.items.length}</td><td>{formatMoney(totals(invoice).total, invoice.business.currency)}</td><td><button className="text-button" onClick={() => setPreview(invoice)}>Preview</button></td></tr>)}</tbody></table></div><div className="batch-result-actions"><span className="small muted">{saved ? 'Saved to your invoice library.' : 'Invoices will be saved as drafts.'}</span><div><Button onClick={() => downloadFile('invoice-batch-summary.csv', invoiceSummaryCSV(result.invoices, i => totals(i).total), 'text/csv;charset=utf-8')}><Download size={16} />Export summary</Button><Button disabled={saved} onClick={save}><Save size={16} />{saved ? 'Batch saved' : 'Save batch'}</Button><Button variant="primary" onClick={() => { if (save()) onPrint(result.invoices); }}><Printer size={16} />Print / PDF batch</Button></div></div></>}</section>}
    {preview && <div className="modal-backdrop" onClick={() => setPreview(null)}><div className="preview-modal" role="dialog" aria-modal="true" aria-label={`Preview ${preview.number}`} onClick={e => e.stopPropagation()} onKeyDown={e => { if (e.key === 'Escape') setPreview(null); }}><div className="modal-header"><strong>{preview.number}</strong><button className="icon-button" aria-label="Close preview" autoFocus onClick={() => setPreview(null)}><X size={20} /></button></div><InvoiceDocument invoice={preview} /></div></div>}
  </>;
}
