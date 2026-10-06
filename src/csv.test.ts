import { describe, expect, it } from 'vitest';
import Papa from 'papaparse';
import { initialWorkspace, totals } from './model';
import { invoiceInputCSV, parseBatch, SAMPLE_CSV, invoiceSummaryCSV } from './csv';

describe('CSV batches', () => {
  it('groups repeated invoice numbers into multiple line items', () => {
    const workspace = initialWorkspace(); const result = parseBatch(SAMPLE_CSV, workspace, workspace.templates[0]);
    expect(result.errors).toEqual([]); expect(result.invoices).toHaveLength(2); expect(result.invoices[0].items).toHaveLength(2);
    expect(totals(result.invoices[0]).total).toBe(2832);
  });
  it('creates separate unique invoices for rows without invoice numbers', () => {
    const workspace = initialWorkspace(); const result = parseBatch('customer_name,description,rate\nAlice,Service,10\nBob,Helmet,20', workspace, workspace.templates[0]);
    expect(result.errors).toEqual([]); expect(result.invoices.map(i => i.number)).toEqual(['INV-0001', 'INV-0002']);
  });
  it('handles quoted commas and newlines', () => {
    const workspace = initialWorkspace(); const result = parseBatch('customer_name,description,rate,customer_address\n"Alice, Inc.",Service,10,"One street\nTwo city"', workspace, workspace.templates[0]);
    expect(result.errors).toEqual([]); expect(result.invoices[0].customer.address).toContain('\n');
  });
  it('rejects conflicting group metadata without partial output', () => {
    const workspace = initialWorkspace(); const result = parseBatch('invoice_number,customer_name,description,rate\nA,Alice,Service,10\nA,Bob,Part,20', workspace, workspace.templates[0]);
    expect(result.invoices).toEqual([]); expect(result.errors[0]).toContain('differ');
  });
  it('rejects duplicates against the saved workspace', () => {
    const workspace = initialWorkspace(); workspace.invoices = parseBatch(SAMPLE_CSV, workspace, workspace.templates[0]).invoices;
    expect(parseBatch(SAMPLE_CSV, workspace, workspace.templates[0]).errors[0]).toContain('already in use');
  });
  it('reports missing columns and blank rates', () => {
    const workspace = initialWorkspace(); expect(parseBatch('customer_name,description\nAlice,Service', workspace, workspace.templates[0]).errors).toContain('Missing required column: rate');
    expect(parseBatch('customer_name,description,rate\nAlice,Service,', workspace, workspace.templates[0]).errors[0]).toContain('rate is required');
  });
  it('rejects invalid numeric values and excess tax in tax-free templates', () => {
    const workspace = initialWorkspace(); expect(parseBatch('customer_name,description,rate\nAlice,Service,nope', workspace, workspace.templates[0]).errors.length).toBeGreaterThan(0);
    const template = { ...workspace.templates[0], taxMode: 'none' as const };
    expect(parseBatch('customer_name,description,rate,tax_rate\nAlice,Service,10,18', workspace, template).errors[0]).toContain('0%');
  });
  it('exports all input fields and reimports custom fields and payments', () => {
    const workspace = initialWorkspace(); const invoice = parseBatch(SAMPLE_CSV, workspace, workspace.templates[0]).invoices[0];
    invoice.customValues[invoice.template.customFields[0].id] = 'KA 01 AB 1234'; invoice.paid = 500; invoice.status = 'issued';
    const csv = invoiceInputCSV([invoice]);
    const result = parseBatch(csv, workspace, workspace.templates[0]);
    expect(result.errors).toEqual([]); expect(result.invoices[0].items).toEqual(invoice.items.map((item, index) => ({ ...item, id: result.invoices[0].items[index].id })));
    expect(result.invoices[0].customValues).toEqual(invoice.customValues); expect(result.invoices[0].paid).toBe(500); expect(result.invoices[0].status).toBe('issued');
  });
  it('escapes spreadsheet formula injection in summary and input exports', () => {
    const workspace = initialWorkspace(); const invoice = parseBatch(SAMPLE_CSV, workspace, workspace.templates[0]).invoices[0]; invoice.customer.name = '=HYPERLINK("https://example.com")';
    for (const csv of [invoiceInputCSV([invoice]), invoiceSummaryCSV([invoice], i => totals(i).total)]) {
      const rows = Papa.parse<Record<string, string>>(csv, { header: true }).data;
      expect(rows[0].customer_name || rows[0].customer).toMatch(/^'=/);
    }
  });
});
