import { useEffect, useRef, useState } from 'react';
import { Building2, CreditCard, SlidersHorizontal, Save, Download, Upload, ShieldCheck, AlertTriangle } from 'lucide-react';
import { Button, Field, Input, Select, Textarea, SectionTitle } from './ui';
import { businessSchema, today, type Business, type Workspace } from './model';
import { downloadFile, parseBackup, STORAGE_KEY } from './storage';

export default function Settings({ workspace, onSave, onRestore, onPendingChange, notify, recovery }: {
  workspace: Workspace; onSave: (business: Business) => void; onRestore: (workspace: Workspace) => void;
  notify: (text: string, error?: boolean) => void; recovery: boolean;
  onPendingChange: (warning: string) => void;
}) {
  const [business, setBusiness] = useState(workspace.business);
  useEffect(() => {
    onPendingChange(JSON.stringify(business) !== JSON.stringify(workspace.business) ? 'Business settings have unsaved changes. Leave without saving?' : '');
  }, [business, workspace.business, onPendingChange]);
  const fileInput = useRef<HTMLInputElement>(null);
  const set = <K extends keyof Business>(key: K, value: Business[K]) => setBusiness(current => ({ ...current, [key]: value }));
  const save = () => {
    const result = businessSchema.safeParse(business);
    if (!result.success) { notify(`${result.error.issues[0].path.join(' → ')}: ${result.error.issues[0].message}`, true); return; }
    onSave(result.data);
  };
  const restore = async (file?: File) => {
    if (!file) return;
    try {
      if (file.size > 25_000_000) throw new Error('Backup exceeds the 25 MB limit.');
      const backup = parseBackup(await file.text());
      if (!window.confirm(`Replace your current workspace with this backup? It contains ${backup.invoices.length} invoices, ${backup.templates.length} templates and ${backup.assets.length} assets. Export your current workspace first if you want to keep it.`)) return;
      // Verify durability before replacing the in-memory workspace.
      localStorage.setItem(STORAGE_KEY, JSON.stringify(backup));
      onRestore(backup); setBusiness(backup.business);
    } catch (error) { notify(error instanceof Error ? `Could not restore backup: ${error.message}` : 'Could not restore backup.', true); }
    finally { if (fileInput.current) fileInput.current.value = ''; }
  };
  return <>
    <div className="page-heading"><div><div className="eyebrow">SET UP FOR SUCCESS</div><h1>Business settings</h1><p>The details that make your invoices official.</p></div><Button variant="primary" onClick={save}><Save size={16} />Save settings</Button></div>
    <div className="settings-grid"><div className="settings-main"><section className="card form-section"><SectionTitle title="Business profile"><Building2 size={19} /></SectionTitle><div className="form-grid"><Field label="Business name *" className="span-2"><Input value={business.name} maxLength={200} onChange={e => set('name', e.target.value)} /></Field><Field label="Business address" className="span-2"><Textarea value={business.address} onChange={e => set('address', e.target.value)} /></Field><Field label="Email"><Input type="email" value={business.email} placeholder="contact@example.com" onChange={e => set('email', e.target.value)} /></Field><Field label="Phone"><Input type="tel" value={business.phone} onChange={e => set('phone', e.target.value)} /></Field><Field label="GSTIN / tax ID"><Input value={business.gstin} onChange={e => set('gstin', e.target.value)} /></Field><Field label="Currency"><Select value={business.currency} onChange={e => set('currency', e.target.value as Business['currency'])}><option value="INR">INR · Indian rupee</option><option value="USD">USD · US dollar</option><option value="EUR">EUR · Euro</option><option value="GBP">GBP · British pound</option></Select></Field></div></section>
    <section className="card form-section"><SectionTitle title="Payment details"><CreditCard size={19} /></SectionTitle><div className="form-grid"><Field label="Bank name" className="span-2"><Input value={business.bankName} placeholder="Bank / payment institution" onChange={e => set('bankName', e.target.value)} /></Field><Field label="Account number"><Input value={business.accountNumber} onChange={e => set('accountNumber', e.target.value)} /></Field><Field label="IFSC / routing code"><Input value={business.ifsc} onChange={e => set('ifsc', e.target.value)} /></Field></div></section>
    <section className="card form-section"><SectionTitle title="Invoice defaults"><SlidersHorizontal size={19} /></SectionTitle><div className="form-grid"><Field label="Invoice number prefix"><Input maxLength={30} value={business.invoicePrefix} onChange={e => set('invoicePrefix', e.target.value)} /></Field><Field label="Next sequence number" hint={`Next number: ${business.invoicePrefix}${String(business.nextNumber).padStart(4, '0')}`}><Input type="number" min="1" max="999999999" step="1" value={business.nextNumber} onChange={e => set('nextNumber', e.target.valueAsNumber || 0)} /></Field><Field label="Default tax rate (%)"><Input type="number" min="0" max="100" step="0.01" value={business.defaultTax} onChange={e => set('defaultTax', e.target.valueAsNumber || 0)} /></Field><Field label="Payment due in (days)"><Input type="number" min="0" max="365" step="1" value={business.dueDays} onChange={e => set('dueDays', e.target.valueAsNumber || 0)} /></Field></div><p className="small muted">Defaults apply to new invoices. Existing invoices keep a snapshot of their original business details, assets and template.</p></section></div>
    <aside className="settings-aside"><section className="card backup-card">
      <div className="empty-icon"><ShieldCheck size={23} /></div><h3>Workspace backup</h3><p>Saved in this browser only.</p>
      <div className="backup-stats"><span>{workspace.invoices.length} invoices</span><span>{workspace.templates.length} templates</span><span>{workspace.assets.length} assets</span></div>
      <Button onClick={() => downloadFile(`workspace-${today()}.json`, JSON.stringify(workspace, null, 2))}><Download size={16} />Export workspace</Button>
      <Button onClick={() => fileInput.current?.click()}><Upload size={16} />Restore backup</Button>
      <input ref={fileInput} type="file" accept="application/json,.json" aria-label="Restore workspace backup" className="visually-hidden" onChange={e => void restore(e.target.files?.[0])} />
      <div className="backup-warning"><AlertTriangle size={15} /><span>Export regularly. Clearing browser data removes your workspace.</span></div>
      {recovery && <Button variant="danger" onClick={() => downloadFile(`workspace-recovery-${today()}.txt`, localStorage.getItem(STORAGE_KEY) || '', 'text/plain')}>Download recovery data</Button>}
    </section></aside></div>
  </>;
}
