import { describe, expect, it } from 'vitest';
import { initialWorkspace, newInvoice, invoiceError, totals, nextInvoiceNumber, workspaceSchema, templateSchema } from './model';
import { parseBackup } from './storage';

function validInvoice() {
  const invoice = newInvoice(initialWorkspace());
  invoice.customer.name = 'Aarav Sharma';
  invoice.items[0] = { ...invoice.items[0], description: 'Bike service', quantity: 2, rate: 100, discount: 10, taxRate: 18 };
  return invoice;
}
describe('invoice calculations', () => {
  it('applies line discounts before GST', () => {
    const amount = totals(validInvoice());
    expect(amount).toMatchObject({ subtotal: 200, discount: 20, taxable: 180, tax: 32.4, total: 212.4, balance: 212.4 });
  });
  it('rounds individual amounts to minor units before summing', () => {
    const invoice = validInvoice();
    invoice.items = [1, 2, 3].map(i => ({ ...invoice.items[0], id: String(i), rate: 0.1, quantity: 1, taxRate: 0, discount: 0 }));
    expect(totals(invoice).total).toBe(0.3);
  });
  it('preserves the odd cent when splitting GST', () => {
    const invoice = validInvoice(); invoice.items[0] = { ...invoice.items[0], quantity: 1, rate: 1, discount: 0, taxRate: 1 };
    const amount = totals(invoice);
    expect(amount.cgst + amount.sgst).toBe(amount.tax);
    expect(amount.sgst).toBe(0.01);
  });
  it('subtracts payments from the balance', () => { const invoice = validInvoice(); invoice.paid = 200; expect(totals(invoice).balance).toBe(12.4); });
});
describe('invoice validation and snapshots', () => {
  it('requires customer names and descriptions', () => { expect(invoiceError(newInvoice(initialWorkspace()))).toContain('customer'); });
  it('rejects negative rates, zero quantities and excessive percentages', () => {
    for (const patch of [{ rate: -1 }, { quantity: 0 }, { discount: 101 }, { taxRate: 101 }]) {
      const invoice = validInvoice(); Object.assign(invoice.items[0], patch); expect(invoiceError(invoice)).not.toBe('');
    }
  });
  it('rejects nonexistent dates and due dates before issue dates', () => {
    const invoice = validInvoice(); invoice.issueDate = '2026-02-30'; expect(invoiceError(invoice)).toContain('date');
    invoice.issueDate = '2026-03-02'; invoice.dueDate = '2026-03-01'; expect(invoiceError(invoice)).toContain('Due date');
  });
  it('rejects duplicate invoice numbers without blocking edits to the same invoice', () => {
    const invoice = validInvoice(); expect(invoiceError(invoice, [invoice])).toBe('');
    expect(invoiceError({ ...invoice, id: 'new-id', number: invoice.number.toLowerCase() }, [invoice])).toContain('already in use');
  });
  it('validates paid status, overpayments and tax-free templates', () => {
    const invoice = validInvoice(); invoice.status = 'paid'; expect(invoiceError(invoice)).toContain('full total');
    invoice.paid = 300; expect(invoiceError(invoice)).toContain('exceed');
    invoice.status = 'draft'; invoice.paid = 0; invoice.template.taxMode = 'none'; expect(invoiceError(invoice)).toContain('0%');
  });
  it('does not mutate original business data or templates', () => {
    const workspace = initialWorkspace(); const invoice = newInvoice(workspace);
    invoice.business.name = 'Other'; invoice.template.customFields[0].label = 'Changed';
    expect(workspace.business.name).toBe('Your business'); expect(workspace.templates[0].customFields[0].label).toBe('Reference');
  });
  it('skips existing numbers and reserved batch numbers', () => {
    const workspace = initialWorkspace(); workspace.invoices = [validInvoice()];
    expect(nextInvoiceNumber(workspace, ['INV-0002']).number).toBe('INV-0003');
  });
  it('rejects conflicting custom field labels', () => {
    const template = initialWorkspace().templates[0]; template.customFields.push({ id: 'another', label: 'REFERENCE', placeholder: '' });
    expect(templateSchema.safeParse(template).success).toBe(false);
  });
  it('rejects whitespace-only required values and unsafe financial precision', () => {
    const invoice = validInvoice(); invoice.number = '   '; expect(invoiceError(invoice)).not.toBe('');
    invoice.number = 'IB-0001'; invoice.items[0].quantity = 1000000; invoice.items[0].rate = 1000000000;
    expect(invoiceError(invoice)).toContain('precision');
  });
});
describe('backups', () => {
  it('roundtrips workspace data', () => { const workspace = initialWorkspace(); expect(parseBackup(JSON.stringify(workspace))).toEqual(workspace); });
  it('rejects unknown versions and duplicate IDs', () => {
    const workspace = initialWorkspace(); expect(() => parseBackup(JSON.stringify({ ...workspace, version: 2 }))).toThrow();
    workspace.templates.push(workspace.templates[0]); expect(workspaceSchema.safeParse(workspace).success).toBe(false);
  });
  it('rejects SVG and non-image asset URLs', () => {
    const workspace = initialWorkspace(); workspace.assets.push({ id: 'unsafe', name: 'Unsafe', kind: 'logo', dataUrl: 'data:image/svg+xml;base64,PHN2Zz4=', createdAt: '' });
    expect(workspaceSchema.safeParse(workspace).success).toBe(false);
  });
});
