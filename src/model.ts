import { z } from 'zod';

const text = z.string().max(10000);
const identifier = z.string().trim().min(1).max(150);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const parsed = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, 'Invalid calendar date');
const money = z.number().finite().min(0).max(1_000_000_000);
const percentage = z.number().finite().min(0).max(100);

export const businessSchema = z.object({
  name: z.string().trim().min(1).max(200), address: text, email: text, phone: text, gstin: text,
  currency: z.enum(['INR', 'USD', 'EUR', 'GBP']),
  bankName: text, accountNumber: text, ifsc: text,
  invoicePrefix: z.string().trim().min(1).max(30), nextNumber: z.number().int().min(1).max(999999999),
  defaultTax: percentage, dueDays: z.number().int().min(0).max(365),
});
export const assetSchema = z.object({
  id: identifier, name: z.string().min(1).max(200), kind: z.enum(['logo', 'signature', 'image']),
  dataUrl: z.string().max(3_000_000).regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/),
  createdAt: z.string(),
});
export const templateSchema = z.object({
  id: identifier, name: z.string().trim().min(1).max(100), title: z.string().trim().min(1).max(100),
  accent: z.string().regex(/^#[0-9a-fA-F]{6}$/), layout: z.enum(['modern', 'classic', 'minimal']),
  logoAssetId: text, signatureAssetId: text,
  showBank: z.boolean(), showHSN: z.boolean(), showDiscount: z.boolean(), showSignature: z.boolean(),
  taxMode: z.enum(['split', 'single', 'none']),
  footer: text, terms: text,
  customFields: z.array(z.object({ id: identifier, label: z.string().trim().min(1).max(100), placeholder: text })).max(20),
}).superRefine((template, ctx) => {
  const ids = template.customFields.map(field => field.id);
  const labels = template.customFields.map(field => field.label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/_$/, ''));
  if (new Set(ids).size !== ids.length || new Set(labels).size !== labels.length) ctx.addIssue({ code: 'custom', path: ['customFields'], message: 'Custom fields need unique IDs and distinct CSV-compatible labels.' });
});
export const itemSchema = z.object({
  id: identifier, description: z.string().trim().min(1).max(2000), hsn: text,
  quantity: z.number().finite().positive().max(1_000_000), rate: money, taxRate: percentage, discount: percentage,
});
export const invoiceSchema = z.object({
  id: identifier, number: z.string().trim().min(1).max(100), issueDate: date, dueDate: date,
  status: z.enum(['draft', 'issued', 'paid']),
  customer: z.object({ name: z.string().trim().min(1).max(200), email: text, phone: text, address: text, gstin: text }),
  items: z.array(itemSchema).min(1).max(200), notes: text, paid: money,
  customValues: z.record(text),
  business: businessSchema, template: templateSchema, assets: z.array(assetSchema).max(2),
  updatedAt: z.string(),
}).refine(value => value.dueDate >= value.issueDate, { message: 'Due date cannot be before the invoice date', path: ['dueDate'] }).superRefine((value, ctx) => {
  let total = 0;
  for (const item of value.items) {
    const gross = Math.round(item.quantity * item.rate * 100);
    const net = gross - Math.round(gross * item.discount / 100);
    total += net + Math.round(net * item.taxRate / 100);
    if (!Number.isSafeInteger(gross) || !Number.isSafeInteger(total)) ctx.addIssue({ code: 'custom', message: 'Amounts exceed supported financial precision', path: ['items'] });
  }
  if (value.template.taxMode === 'none' && value.items.some(item => item.taxRate !== 0)) ctx.addIssue({ code: 'custom', message: 'A tax-free template must have 0% tax on every item', path: ['items'] });
  if (Math.round(value.paid * 100) > total) ctx.addIssue({ code: 'custom', message: 'Amount paid cannot exceed the invoice total', path: ['paid'] });
  if (value.status === 'paid' && Math.round(value.paid * 100) < total) ctx.addIssue({ code: 'custom', message: 'A paid invoice must have its full total recorded as paid', path: ['paid'] });
});
export const workspaceSchema = z.object({
  version: z.literal(1), business: businessSchema,
  templates: z.array(templateSchema).min(1).max(100), assets: z.array(assetSchema).max(100),
  invoices: z.array(invoiceSchema).max(10000),
  importConfig: z.object({
    engine: z.enum(['rules', 'ollama', 'huggingface']).default('huggingface'), endpoint: z.string().max(200).default('http://localhost:11434'),
    model: z.string().min(1).max(100).default('qwen2.5:0.5b'), instructions: text.default(''),
    runnerEndpoint: z.string().max(200).default('http://127.0.0.1:8000'),
    hfModel: z.string().min(3).max(96).default('convaiinnovations/laya'), hfRevision: z.string().min(1).max(100).default('55cf4c4ebb4ebe31b2550e8bdf3bd21b99753851'),
    adapter: z.enum(['laya', 'qa']).default('laya'), device: z.string().regex(/^(cpu|cuda:[0-9]+|mps)$/).default('cpu'),
    confidenceThreshold: z.number().min(0).max(1).default(0.65), maxCandidates: z.number().int().min(2).max(12).default(8),
    cpuThreads: z.number().int().min(1).max(64).default(4), modelTimeout: z.number().int().min(30).max(600).default(120),
    recursive: z.boolean().default(true), extensions: z.string().max(200).default('.csv,.txt,.md,.json,.html,.pdf,.docx'),
    dateSource: z.enum(['field', 'path', 'modified']).default('field'), hierarchy: z.enum(['flat', 'year', 'year-month']).default('year-month'),
    outputName: z.string().min(1).max(100).default('invoices'), delimiter: z.enum([',', ';', '\t']).default(','),
    numberPattern: z.string().min(1).max(100).default('{prefix}{year}{month}-{seq:4}'),
    nextSequence: z.number().int().min(1).max(999999999).default(1), keepSourceNumbers: z.boolean().default(true),
    fields: z.array(z.object({
      id: identifier, column: z.string().min(1).max(100), target: z.string().max(200),
      terms: z.string().max(1000), type: z.enum(['text', 'number', 'date']), fallback: z.string().max(10000), required: z.boolean(),
    })).min(1).max(50),
  }).optional(),
}).superRefine((value, ctx) => {
  for (const key of ['templates', 'assets', 'invoices'] as const) {
    const ids = value[key].map(record => record.id);
    if (new Set(ids).size !== ids.length) ctx.addIssue({ code: 'custom', message: `Duplicate ${key} IDs`, path: [key] });
  }
  const numbers = value.invoices.map(invoice => invoice.number.trim().toLowerCase());
  if (new Set(numbers).size !== numbers.length) ctx.addIssue({ code: 'custom', message: 'Duplicate invoice numbers', path: ['invoices'] });
});

export type Business = z.infer<typeof businessSchema>;
export type Asset = z.infer<typeof assetSchema>;
export type Template = z.infer<typeof templateSchema>;
export type Item = z.infer<typeof itemSchema>;
export type Invoice = z.infer<typeof invoiceSchema>;
export type Workspace = z.infer<typeof workspaceSchema>;
export type ImportConfig = NonNullable<Workspace['importConfig']>;

export const uid = () => crypto.randomUUID();
export const today = () => {
  const value = new Date();
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
};
export function addDays(value: string, days: number) {
  const d = new Date(`${value}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
export const formatMoney = (value: number, currency = 'INR') =>
  new Intl.NumberFormat(currency === 'INR' ? 'en-IN' : 'en-US', { style: 'currency', currency, minimumFractionDigits: 2 }).format(value);
export const formatDate = (value: string) => new Date(`${value}T12:00:00`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

// Round line amounts to minor units before summing, avoiding floating-point drift.
export function totals(invoice: Pick<Invoice, 'items' | 'paid'>) {
  const lines = invoice.items.map(item => {
    const gross = Math.round(item.quantity * item.rate * 100);
    const discount = Math.round(gross * item.discount / 100);
    const net = gross - discount;
    const tax = Math.round(net * item.taxRate / 100);
    return { gross, discount, net, tax, total: net + tax };
  });
  const sum = (key: keyof typeof lines[number]) => lines.reduce((result, line) => result + line[key], 0);
  const tax = sum('tax');
  const total = sum('total');
  const paid = Math.round(invoice.paid * 100);
  return {
    lines, subtotal: sum('gross') / 100, discount: sum('discount') / 100, taxable: sum('net') / 100,
    tax: tax / 100, cgst: Math.floor(tax / 2) / 100, sgst: (tax - Math.floor(tax / 2)) / 100,
    total: total / 100, paid: paid / 100, balance: Math.max(0, total - paid) / 100,
  };
}

export function defaultTemplate(): Template {
  return {
    id: uid(), name: 'Studio / GST', title: 'Tax invoice', accent: '#173f35', layout: 'modern',
    logoAssetId: '', signatureAssetId: '', showBank: true, showHSN: true, showDiscount: true,
    showSignature: true, taxMode: 'split', footer: 'Thank you for your business.',
    terms: 'Payment is due by the date indicated above. Please include the invoice number as the payment reference.',
    customFields: [ { id: uid(), label: 'Reference', placeholder: '' } ],
  };
}
export function initialWorkspace(): Workspace {
  const template = defaultTemplate();
  return {
    version: 1,
    business: {
      name: 'Your business', address: '', email: '', phone: '', gstin: '', currency: 'INR',
      bankName: '', accountNumber: '', ifsc: '', invoicePrefix: 'INV-', nextNumber: 1, defaultTax: 18, dueDays: 7,
    },
    templates: [template, { ...template, id: uid(), name: 'Essential / clean', layout: 'minimal', accent: '#5d6171', showHSN: false, taxMode: 'single', customFields: [] }],
    assets: [], invoices: [],
  };
}
export function nextInvoiceNumber(workspace: Workspace, reserved: string[] = []) {
  let sequence = workspace.business.nextNumber;
  const existing = new Set([...workspace.invoices.map(i => i.number), ...reserved].map(value => value.toLowerCase()));
  while (existing.has(`${workspace.business.invoicePrefix}${String(sequence).padStart(4, '0')}`.toLowerCase())) sequence++;
  return { number: `${workspace.business.invoicePrefix}${String(sequence).padStart(4, '0')}`, next: sequence + 1 };
}
export function snapshotAssets(template: Template, assets: Asset[]) {
  return assets.filter(asset => asset.id === template.logoAssetId || asset.id === template.signatureAssetId).map(asset => ({ ...asset }));
}
export function newInvoice(workspace: Workspace, template = workspace.templates[0]): Invoice {
  return {
    id: uid(), number: nextInvoiceNumber(workspace).number,
    issueDate: today(), dueDate: addDays(today(), workspace.business.dueDays), status: 'draft',
    customer: { name: '', email: '', phone: '', address: '', gstin: '' },
    items: [{ id: uid(), description: '', hsn: '', quantity: 1, rate: 0, taxRate: template.taxMode === 'none' ? 0 : workspace.business.defaultTax, discount: 0 }],
    notes: '', paid: 0, customValues: {}, business: { ...workspace.business },
    template: structuredClone(template), assets: snapshotAssets(template, workspace.assets), updatedAt: new Date().toISOString(),
  };
}
export function invoiceError(invoice: Invoice, existing: Invoice[] = []) {
  const result = invoiceSchema.safeParse(invoice);
  if (!result.success) {
    const issue = result.error.issues[0];
    const path = issue.path.join(' → ');
    return `${path || 'Invoice'}: ${issue.message}`;
  }
  if (existing.some(i => i.id !== invoice.id && i.number.trim().toLowerCase() === invoice.number.trim().toLowerCase())) return 'This invoice number is already in use. Choose a unique number.';
  if (invoice.template.taxMode === 'none' && invoice.items.some(item => item.taxRate !== 0)) return 'A tax-free template must have 0% tax on every item.';
  const amount = totals(invoice);
  if (amount.paid > amount.total) return 'Amount paid cannot exceed the invoice total.';
  if (invoice.status === 'paid' && amount.balance > 0) return 'A paid invoice must have its full total recorded as paid.';
  return '';
}
