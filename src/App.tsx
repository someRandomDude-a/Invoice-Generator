import { useCallback, useEffect, useState } from 'react';
import { FileText, LayoutTemplate, Images, Layers3, Settings2, Plus, Check, X, AlertTriangle, Menu, HardDrive, CircleHelp, FolderSearch, Sun, Moon } from 'lucide-react';
import InvoiceList from './InvoiceList';
import InvoiceEditor from './InvoiceEditor';
import InvoiceDocument from './InvoiceDocument';
import Templates from './Templates';
import Assets from './Assets';
import Settings from './Settings';
import Batch from './Batch';
import DirectoryImport from './DirectoryImport';
import { Button } from './ui';
import { addDays, invoiceError, newInvoice, nextInvoiceNumber, today, uid, type Asset, type Invoice, type Template, type Workspace } from './model';
import { loadWorkspace, STORAGE_KEY } from './storage';
import { defaultImportConfig } from './imports';

type Page = 'invoices' | 'templates' | 'assets' | 'batch' | 'imports' | 'settings';
const navItems = [
  { id: 'invoices' as const, label: 'Invoices', icon: FileText },
  { id: 'templates' as const, label: 'Templates', icon: LayoutTemplate },
  { id: 'assets' as const, label: 'Asset library', icon: Images },
  { id: 'batch' as const, label: 'Batch generator', icon: Layers3 },
  { id: 'imports' as const, label: 'Data import studio', icon: FolderSearch },
  { id: 'settings' as const, label: 'Settings', icon: Settings2 },
];

export default function App() {
  const [initial] = useState(loadWorkspace);
  const [workspace, setWorkspace] = useState(initial.workspace);
  const [recovery, setRecovery] = useState(!!initial.error);
  const [saveError, setSaveError] = useState(initial.error);
  const [page, setPage] = useState<Page>('invoices');
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [dirty, setDirty] = useState(false);
  const [pageWarning, setPageWarning] = useState('');
  const [printInvoices, setPrintInvoices] = useState<Invoice[]>([]);
  const [toast, setToast] = useState<{ message: string; error: boolean } | null>(null);
  const [mobileNav, setMobileNav] = useState(false);
  const [help, setHelp] = useState(false);
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    try { return localStorage.getItem('invoice-studio-theme') === 'light' ? 'light' : 'dark'; }
    catch { return 'dark'; }
  });
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem('invoice-studio-theme', theme); } catch { /* Preference is optional. */ }
  }, [theme]);
  const notify = useCallback((message: string, error = false) => setToast({ message, error }), []);

  useEffect(() => {
    if (recovery) return;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(workspace)); setSaveError(''); }
    catch { setSaveError('Your browser could not save this workspace, usually because storage is full or disabled. Changes are only in memory. Export a backup in Settings before closing this tab.'); }
  }, [workspace, recovery]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), toast.error ? 10000 : 4500);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (dirty || pageWarning || saveError) { event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [dirty, pageWarning, saveError]);
  useEffect(() => {
    if (!printInvoices.length) return;
    let cancelled = false;
    const originalTitle = document.title;
    document.title = printInvoices.length === 1 ? printInvoices[0].number : `${printInvoices.length}-invoices`;
    const afterPrint = () => setPrintInvoices([]);
    window.addEventListener('afterprint', afterPrint);
    const prepare = async () => {
      const images = Array.from(document.querySelectorAll<HTMLImageElement>('.print-root img'));
      await Promise.all([document.fonts.ready, ...images.map(image => image.decode().catch(() => {}))]);
      requestAnimationFrame(() => { if (!cancelled) window.print(); });
    };
    void prepare();
    return () => { cancelled = true; document.title = originalTitle; window.removeEventListener('afterprint', afterPrint); };
  }, [printInvoices]);

  const canLeave = () => {
    const warning = dirty ? 'You have unsaved invoice changes. Leave without saving?' : pageWarning;
    return !warning || window.confirm(warning);
  };
  const navigate = (target: Page) => {
    if (!canLeave()) return;
    setPage(target); setInvoice(null); setDirty(false); setPageWarning(''); setMobileNav(false); window.scrollTo(0, 0);
  };
  const create = (template?: Template) => {
    if (!canLeave()) return;
    setInvoice(newInvoice(workspace, template)); setPage('invoices'); setDirty(true); setPageWarning(''); setMobileNav(false); window.scrollTo(0, 0);
  };
  const edit = (value: Invoice) => {
    setInvoice(structuredClone(value)); setDirty(false); window.scrollTo(0, 0);
  };
  const duplicate = (value: Invoice) => {
    setInvoice({ ...structuredClone(value), id: uid(), number: nextInvoiceNumber(workspace).number, status: 'draft', paid: 0, issueDate: today(), dueDate: addDays(today(), workspace.business.dueDays), updatedAt: new Date().toISOString() });
    setDirty(true); window.scrollTo(0, 0);
  };
  const saveInvoices = (values: Invoice[], silent = false) => {
    if (recovery) { notify('Restore a valid backup in Settings before saving. Your recovery data has been preserved.', true); return false; }
    if (values.length + workspace.invoices.filter(i => !values.some(v => v.id === i.id)).length > 10000) { notify('The workspace limit is 10,000 invoices. Export a backup and archive some invoices first.', true); return false; }
    const numbers = values.map(value => value.number.trim().toLowerCase());
    if (new Set(numbers).size !== numbers.length) { notify('This batch contains duplicate invoice numbers.', true); return false; }
    for (const value of values) {
      const error = invoiceError(value, workspace.invoices);
      if (error) { notify(error, true); return false; }
    }
    const updated = values.map(value => ({ ...value, number: value.number.trim(), updatedAt: new Date().toISOString() }));
    setWorkspace(current => {
      const result: Workspace = { ...current, invoices: [...current.invoices.filter(i => !updated.some(v => v.id === i.id)), ...updated] };
      return { ...result, business: { ...current.business, nextNumber: Math.max(current.business.nextNumber, nextInvoiceNumber(result).next - 1) } };
    });
    if (!silent) notify(values.length === 1 ? 'Invoice saved to your workspace.' : `${values.length} invoices saved to your workspace.`);
    return true;
  };
  const saveCurrent = () => {
    if (!invoice || !saveInvoices([invoice])) return false;
    setDirty(false); return true;
  };
  const print = (values: Invoice[]) => {
    if (!values.length) return;
    for (const value of values) {
      const error = invoiceError(value);
      if (error) { notify(`Cannot print ${value.number}: ${error}`, true); return; }
    }
    setPrintInvoices(structuredClone(values));
  };
  const saveTemplate = (template: Template) => {
    if (!workspace.templates.some(t => t.id === template.id) && workspace.templates.length >= 100) { notify('You can save up to 100 templates.', true); return; }
    setWorkspace(current => ({ ...current, templates: current.templates.some(t => t.id === template.id) ? current.templates.map(t => t.id === template.id ? template : t) : [...current.templates, template] }));
    notify('Template saved. Ready for your next invoice.');
  };
  const updateAsset = (asset: Asset) => setWorkspace(current => ({ ...current, assets: current.assets.map(a => a.id === asset.id ? asset : a) }));
  return <>
    <button className="theme-switch icon-button" aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'} title={theme === 'dark' ? 'Light mode' : 'Dark mode'} onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}</button>
    <div className="app-shell">
      <aside className={`sidebar ${mobileNav ? 'is-open' : ''}`}>
        <button className="brand" onClick={() => navigate('invoices')}><div className="brand-mark"><FileText size={20} strokeWidth={1.5} /></div><div>Invoice Studio</div></button>
        <div className="workspace-switch"><div className="workspace-avatar">WS</div><div><strong>{workspace.business.name}</strong><span>Local workspace</span></div><HardDrive size={15} /></div>
        <nav>{navItems.map(({ id, label, icon: Icon }) => <button key={id} className={page === id ? 'active' : ''} onClick={() => navigate(id)}><Icon size={18} strokeWidth={1.6} /><span>{label}</span>{id === 'invoices' && <small>{workspace.invoices.length}</small>}</button>)}</nav>
        <div className="sidebar-bottom"><button className="help-button" onClick={() => setHelp(true)}><CircleHelp size={16} />Help</button><div className="sidebar-version"><span className={`live-dot ${saveError ? 'error-dot' : ''}`} />{saveError ? 'Storage warning' : 'Saved locally'}<span>v1.0</span></div></div>
      </aside>
      {mobileNav && <button className="sidebar-scrim" aria-label="Close navigation" onClick={() => setMobileNav(false)} />}
      <div className="main-shell"><header className="topbar"><div className="topbar-breadcrumb"><button className="icon-button mobile-menu" aria-label="Open navigation" onClick={() => setMobileNav(!mobileNav)}><Menu size={20} /></button><span>Workspace</span><span>/</span><strong>{navItems.find(item => item.id === page)?.label}</strong></div><div className="topbar-right"><button className="user-avatar" aria-label="Open business settings" onClick={() => navigate('settings')}>WS</button></div></header>
        <main className="main-content">{saveError && <div className="storage-error" role="alert"><AlertTriangle size={20} /><p>{saveError}</p><Button onClick={() => navigate('settings')}>Open Settings</Button></div>}
          {page === 'invoices' && (invoice ? <InvoiceEditor workspace={workspace} invoice={invoice} isSaved={workspace.invoices.some(i => i.id === invoice.id)} dirty={dirty} onChange={value => { setInvoice(value); setDirty(true); }} onSave={saveCurrent} onPrint={() => { if (saveCurrent()) print([invoice]); }} onBack={() => navigate('invoices')} /> : <InvoiceList workspace={workspace} onNew={() => create()} onEdit={edit} onDuplicate={duplicate} onPrint={print} onDelete={ids => { setWorkspace(current => ({ ...current, invoices: current.invoices.filter(i => !ids.includes(i.id)) })); notify('Invoices deleted.'); }} onNavigate={navigate} />)}
          {page === 'templates' && <Templates workspace={workspace} onSave={saveTemplate} onDelete={id => { setWorkspace(current => ({ ...current, templates: current.templates.filter(t => t.id !== id) })); notify('Template deleted.'); }} onCreateInvoice={create} onPendingChange={setPageWarning} notify={notify} />}
          {page === 'assets' && <Assets workspace={workspace} onAdd={assets => setWorkspace(current => ({ ...current, assets: [...current.assets, ...assets] }))} onUpdate={updateAsset} onDelete={id => setWorkspace(current => ({ ...current, assets: current.assets.filter(a => a.id !== id), templates: current.templates.map(t => ({ ...t, logoAssetId: t.logoAssetId === id ? '' : t.logoAssetId, signatureAssetId: t.signatureAssetId === id ? '' : t.signatureAssetId })) }))} notify={notify} />}
          {page === 'batch' && <Batch workspace={workspace} onSave={saveInvoices} onPrint={print} onNumberingSave={options => setWorkspace(current => ({ ...current, importConfig: { ...(current.importConfig || defaultImportConfig()), ...options } }))} onPendingChange={setPageWarning} notify={notify} />}
          {page === 'imports' && <DirectoryImport workspace={workspace} onConfigSave={importConfig => { setWorkspace(current => ({ ...current, importConfig })); notify('Import configuration saved.'); }} onSaveInvoices={saveInvoices} onPendingChange={setPageWarning} notify={notify} />}
          {page === 'settings' && <Settings key={recovery ? 'recovery' : 'normal'} workspace={workspace} onSave={business => { setWorkspace(current => ({ ...current, business })); notify('Business settings saved.'); }} onRestore={value => { setWorkspace(value); setRecovery(false); setSaveError(''); notify('Workspace restored successfully.'); }} onPendingChange={setPageWarning} notify={notify} recovery={recovery} />}
        </main>
      </div>
    </div>
    {toast && <div className={`toast ${toast.error ? 'error' : ''}`} role={toast.error ? 'alert' : 'status'}>{toast.error ? <AlertTriangle size={18} /> : <Check size={18} />}<span>{toast.message}</span><button aria-label="Dismiss notification" onClick={() => setToast(null)}><X size={16} /></button></div>}
    {help && <div className="modal-backdrop" onClick={() => setHelp(false)}><div className="help-modal card" role="dialog" aria-modal="true" aria-label="Invoice Studio help" onClick={e => e.stopPropagation()} onKeyDown={e => { if (e.key === 'Escape') setHelp(false); }}><div className="modal-header"><h2>A little help</h2><button className="icon-button" aria-label="Close help" autoFocus onClick={() => setHelp(false)}><X size={20} /></button></div><ol><li><strong>Set up your business.</strong> Add your address, GSTIN, bank details and defaults in Settings.</li><li><strong>Make it your own.</strong> Upload logos and signatures in Asset library, then choose them in the template creator.</li><li><strong>Create an invoice.</strong> Add customer details and items. Tax and discounts are calculated automatically.</li><li><strong>Print or save a PDF.</strong> Choose A4, portrait, 100% scale, and disable browser headers and footers. Enable background graphics for your accent color.</li><li><strong>Work in batches.</strong> Download the sample CSV, fill it in, and validate it in Batch generator.</li><li><strong>Keep a backup.</strong> Export your workspace from Settings regularly. This app uses only this browser’s local storage and does not sync across devices or tabs.</li></ol><Button variant="primary" onClick={() => setHelp(false)}><Plus size={16} />Ready to create</Button></div></div>}
    <div className="print-root" aria-hidden={!printInvoices.length}>{printInvoices.map(value => <div className="print-page" key={value.id}><InvoiceDocument invoice={value} /></div>)}</div>
  </>;
}
