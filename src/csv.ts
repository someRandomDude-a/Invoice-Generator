import Papa from 'papaparse';
import { addDays, invoiceError, newInvoice, nextInvoiceNumber, today, uid, type Invoice, type Template, type Workspace } from './model';

export const CSV_COLUMNS = ['invoice_number', 'customer_name', 'customer_email', 'customer_phone', 'customer_address', 'customer_gstin', 'issue_date', 'due_date', 'description', 'hsn', 'quantity', 'rate', 'tax_rate', 'discount_percent', 'notes', 'status', 'amount_paid'];
export const SAMPLE_CSV = Papa.unparse([
  CSV_COLUMNS,
  ['BATCH-001', 'Aarav Sharma', 'aarav@example.com', '', 'Bengaluru', '', today(), addDays(today(), 7), 'Consultation', '', '1', '1500', '18', '0', '', 'draft', '0'],
  ['BATCH-001', 'Aarav Sharma', 'aarav@example.com', '', 'Bengaluru', '', today(), addDays(today(), 7), 'Materials', '', '2', '450', '18', '0', '', 'draft', '0'],
  ['BATCH-002', 'Meera Patel', 'meera@example.com', '', 'Mumbai', '', today(), addDays(today(), 7), 'Services', '', '1', '2200', '18', '5', '', 'draft', '0'],
]);

export function parseBatch(text: string, workspace: Workspace, template: Template): { invoices: Invoice[]; errors: string[]; rows: number } {
  if (text.length > 2_000_000) return { invoices: [], errors: ['CSV exceeds the 2 MB limit.'], rows: 0 };
  const parsed = Papa.parse<Record<string, string>>(text.replace(/^\uFEFF/, ''), {
    header: true, skipEmptyLines: 'greedy', transformHeader: h => h.trim().toLowerCase(), transform: v => v.trim(),
  });
  const errors = parsed.errors.map(error => `CSV ${error.row === undefined ? '' : `row ${error.row + 2}`}: ${error.message}`);
  const headers = parsed.meta.fields ?? [];
  for (const required of ['customer_name', 'description', 'rate']) if (!headers.includes(required)) errors.push(`Missing required column: ${required}`);
  if (!parsed.data.length) errors.push('The CSV contains no invoice rows.');
  if (parsed.data.length > 1000) errors.push('A batch can contain at most 1,000 item rows.');
  if (errors.length) return { invoices: [], errors, rows: parsed.data.length };
  const groups = new Map<string, { invoice: Invoice; fingerprint: string }>();
  const reserved: string[] = [];
  parsed.data.forEach((row, index) => {
    const line = index + 2;
    if (!row.rate) { errors.push(`Row ${line}: rate is required. Enter 0 explicitly for a free item.`); return; }
    const customer = { name: row.customer_name || '', email: row.customer_email || '', phone: row.customer_phone || '', address: row.customer_address || '', gstin: row.customer_gstin || '' };
    const issueDate = row.issue_date || today();
    let dueDate = row.due_date || '';
    if (!dueDate) {
      try { dueDate = addDays(issueDate, workspace.business.dueDays); }
      catch { errors.push(`Row ${line}: invalid issue_date.`); return; }
    }
    const values = Object.fromEntries(template.customFields.map(field => [field.id, row[`custom_${field.label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/_$/, '')}`] || '']));
    const fingerprint = JSON.stringify({ customer, issueDate, dueDate, notes: row.notes || '', values, status: row.status || 'draft', paid: row.amount_paid || '0' });
    // Empty invoice numbers intentionally produce separate invoices per row.
    const key = row.invoice_number || `__auto_${index}`;
    let group = groups.get(key.toLowerCase());
    if (group && group.fingerprint !== fingerprint) { errors.push(`Row ${line}: customer, dates, notes or custom values differ within invoice ${key}.`); return; }
    if (!group) {
      const invoice = newInvoice(workspace, template);
      invoice.number = row.invoice_number || nextInvoiceNumber(workspace, reserved).number;
      reserved.push(invoice.number);
      invoice.customer = customer; invoice.issueDate = issueDate; invoice.dueDate = dueDate;
      invoice.notes = row.notes || ''; invoice.customValues = values; invoice.items = [];
      invoice.status = (row.status || 'draft') as Invoice['status'];
      invoice.paid = Number(row.amount_paid || '0');
      group = { invoice, fingerprint }; groups.set(key.toLowerCase(), group);
    }
    const numeric = (column: string, fallback: number) => {
      const raw = row[column];
      if (!raw) return fallback;
      const n = Number(raw);
      if (!Number.isFinite(n)) errors.push(`Row ${line}: ${column} must be a number (no currency signs or thousands separators).`);
      return n;
    };
    group.invoice.items.push({
      id: uid(), description: row.description || '', hsn: row.hsn || '',
      quantity: numeric('quantity', 1), rate: numeric('rate', 0),
      taxRate: numeric('tax_rate', template.taxMode === 'none' ? 0 : workspace.business.defaultTax), discount: numeric('discount_percent', 0),
    });
  });
  const invoices = [...groups.values()].map(group => group.invoice);
  for (const invoice of invoices) {
    const error = invoiceError(invoice, workspace.invoices);
    if (error) errors.push(`${invoice.number}: ${error}`);
  }
  return { invoices: errors.length ? [] : invoices, errors, rows: parsed.data.length };
}

export const customColumn = (label: string) => `custom_${label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/_$/, '')}`;
export const fieldDefinitions = (template?: Template) => [
  { key: 'invoice_number', label: 'Invoice number', required: false, type: 'text' },
  { key: 'customer_name', label: 'Customer name', required: true, type: 'text' },
  { key: 'customer_email', label: 'Customer email', required: false, type: 'text' },
  { key: 'customer_phone', label: 'Customer phone', required: false, type: 'text' },
  { key: 'customer_address', label: 'Customer address', required: false, type: 'text' },
  { key: 'customer_gstin', label: 'Customer GSTIN / tax ID', required: false, type: 'text' },
  { key: 'issue_date', label: 'Invoice date', required: false, type: 'date' },
  { key: 'due_date', label: 'Due date', required: false, type: 'date' },
  { key: 'description', label: 'Item description', required: true, type: 'text' },
  { key: 'hsn', label: 'HSN / SAC', required: false, type: 'text' },
  { key: 'quantity', label: 'Quantity', required: false, type: 'number' },
  { key: 'rate', label: 'Unit rate', required: true, type: 'number' },
  { key: 'tax_rate', label: 'Tax rate (%)', required: false, type: 'number' },
  { key: 'discount_percent', label: 'Discount (%)', required: false, type: 'number' },
  { key: 'notes', label: 'Notes', required: false, type: 'text' },
  { key: 'status', label: 'Status (draft / issued / paid)', required: false, type: 'text' },
  { key: 'amount_paid', label: 'Amount paid', required: false, type: 'number' },
  ...(template?.customFields.map(field => ({ key: customColumn(field.label), label: field.label, required: false, type: 'text' })) || []),
];

export function invoiceInputRows(invoices: Invoice[]) {
  return invoices.flatMap(invoice => invoice.items.map(item => ({
    invoice_number: invoice.number, customer_name: invoice.customer.name, customer_email: invoice.customer.email,
    customer_phone: invoice.customer.phone, customer_address: invoice.customer.address, customer_gstin: invoice.customer.gstin,
    issue_date: invoice.issueDate, due_date: invoice.dueDate, description: item.description, hsn: item.hsn,
    quantity: String(item.quantity), rate: String(item.rate), tax_rate: String(item.taxRate), discount_percent: String(item.discount),
    notes: invoice.notes, status: invoice.status, amount_paid: String(invoice.paid),
    template_name: invoice.template.name, currency: invoice.business.currency,
    business_name: invoice.business.name, business_address: invoice.business.address, business_email: invoice.business.email,
    business_phone: invoice.business.phone, business_gstin: invoice.business.gstin,
    ...Object.fromEntries(invoice.template.customFields.map(field => [customColumn(field.label), invoice.customValues[field.id] || ''])),
  })));
}

export function invoiceInputCSV(invoices: Invoice[]) {
  const rows = invoiceInputRows(invoices);
  const columns = [...new Set([...CSV_COLUMNS, ...rows.flatMap(row => Object.keys(row))])];
  return Papa.unparse({ fields: columns, data: rows.map(row => columns.map(column => (row as Record<string, string>)[column] ?? '')) }, { escapeFormulae: true });
}

export function invoiceSummaryCSV(invoices: Invoice[], total: (invoice: Invoice) => number) {
  return Papa.unparse(invoices.map(invoice => ({
    invoice_number: invoice.number, customer: invoice.customer.name, issue_date: invoice.issueDate,
    due_date: invoice.dueDate, currency: invoice.business.currency, total: total(invoice).toFixed(2),
    amount_paid: invoice.paid.toFixed(2), status: invoice.status,
  })), { escapeFormulae: true });
}
