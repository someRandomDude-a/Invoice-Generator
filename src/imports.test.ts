import { afterEach, describe, expect, it, vi } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { initialWorkspace } from './model';
import { defaultImportConfig, extractRecord, extractTerms, extractWithModel, groupedCSV, guessMapping, importConfigError, localEndpoint, mappedCSV, normalizeField, numberedSourceRows, readCSV, renderNumber, sourceRowsToCSV, zipCSV, type SourceRow } from './imports';
import { parseBatch } from './csv';

afterEach(() => { vi.unstubAllGlobals(); });
const row = (date: string, path = 'folder/file.txt'): SourceRow => ({ id: path, path, modified: '2026-01-01', warnings: [], values: { customer_name: 'Alice', description: 'Service', rate: '100', issue_date: date } });
describe('mapping and numbering', () => {
  it('maps arbitrary columns using aliases', () => {
    const workspace = initialWorkspace(); const headers = ['Client name', 'Unit price', 'Product'];
    const mapping = guessMapping(headers, workspace.templates[0]); expect(mapping.customer_name).toBe('Client name'); expect(mapping.rate).toBe('Unit price');
    const converted = mappedCSV([{ 'Client name': 'Alice', 'Unit price': '100', Product: 'Service' }], mapping, defaultImportConfig(), workspace);
    expect(parseBatch(converted.csv, workspace, workspace.templates[0]).invoices).toHaveLength(1);
  });
  it('formats tokens and rejects unknown or missing unique tokens', () => {
    expect(renderNumber('{prefix}{year}/{month}/{day}-{seq:4}', 'IB-', '2026-10-06', 12)).toBe('IB-2026/10/06-0012');
    expect(() => renderNumber('{unknown}', '', '2026-10-06', 1)).toThrow('Unknown');
    expect(importConfigError({ ...defaultImportConfig(), numberPattern: '{year}' })).toContain('must include');
    expect(() => mappedCSV([{ name: 'Alice' }], { customer_name: 'name' }, { ...defaultImportConfig(), numberPattern: '{year}' }, initialWorkspace())).toThrow('must include');
  });
  it('regenerates grouped invoice numbers without losing group identity', () => {
    const workspace = initialWorkspace(); const config = { ...defaultImportConfig(), keepSourceNumbers: false, numberPattern: '{prefix}{seq:4}' };
    const rows = [{ invoice_number: 'A', customer_name: 'Alice', description: 'Service', rate: '10' }, { invoice_number: 'A', customer_name: 'Alice', description: 'Part', rate: '20' }];
    const converted = mappedCSV(rows, Object.fromEntries(Object.keys(rows[0]).map(k => [k, k])), config, workspace);
    const invoices = parseBatch(converted.csv, workspace, workspace.templates[0]).invoices;
    expect(invoices).toHaveLength(1); expect(invoices[0].number).toBe('INV-0001'); expect(invoices[0].items).toHaveLength(2);
  });
  it('does not collide with kept source numbers when numbering blank rows', () => {
    const workspace = initialWorkspace(); const config = { ...defaultImportConfig(), numberPattern: '{prefix}{seq:4}' };
    const converted = mappedCSV([{ invoice_number: '' }, { invoice_number: 'INV-0001' }], { invoice_number: 'invoice_number' }, config, workspace);
    expect(readCSV(converted.csv).rows.map(row => row.invoice_number)).toEqual(['INV-0002', 'INV-0001']);
  });
  it('supports semicolon-delimited files and rejects malformed input', () => {
    expect(readCSV('name;price\nAlice;10').headers).toEqual(['name', 'price']);
    expect(() => readCSV('name,price\nAlice,10,20')).toThrow();
  });
});
describe('extraction and consolidation', () => {
  it('extracts user-specified terms and labels on following lines', () => {
    const config = defaultImportConfig(); const values = extractTerms('Bill to: Alice\nDescription\nBike service\nUnit price = 100\nInvoice date: 2026-10-06', config);
    expect(values).toMatchObject({ customer_name: 'Alice', description: 'Bike service', rate: '100', issue_date: '2026-10-06' });
  });
  it('matches CSV and nested JSON field aliases', () => {
    expect(extractRecord({ 'buyer.customer_name': 'Alice', 'Unit price': '100' }, defaultImportConfig())).toMatchObject({ customer_name: 'Alice', rate: '100' });
  });
  it('normalizes explicit amounts, percentages and year-first dates', () => {
    expect(normalizeField('₹ 1,500.50', 'number')).toBe('1500.5'); expect(normalizeField('18%', 'number')).toBe('18'); expect(normalizeField('2026/1/2', 'date')).toBe('2026-01-02');
    expect(normalizeField('01/02/2026', 'date')).toBe('01/02/2026');
  });
  it('groups by year and month and preserves undated records', () => {
    const config = defaultImportConfig(); const groups = groupedCSV([row('2026-10-06', 'a'), row('2026-09-01', 'b'), row('', 'c')], config);
    expect([...groups.keys()]).toEqual(['2026/10/invoices.csv', '2026/09/invoices.csv', 'undated/invoices.csv']);
    expect(groups.get('2026/10/invoices.csv')).toContain('source_file');
    const contents = unzipSync(zipCSV(groups)); expect(strFromU8(contents['2026/10/invoices.csv'])).toContain('Alice');
  });
  it('can group by source directory or file modification date', () => {
    const config = { ...defaultImportConfig(), dateSource: 'path' as const };
    expect([...groupedCSV([row('', 'root/2025/9/item.txt')], config).keys()]).toEqual(['2025/09/invoices.csv']);
    config.dateSource = 'modified' as 'path'; expect([...groupedCSV([row('')], config).keys()]).toEqual(['2026/01/invoices.csv']);
  });
  it('creates invoices only from mapped output fields', () => {
    const config = defaultImportConfig(); const workspace = initialWorkspace(); const converted = sourceRowsToCSV([row('2026-10-06')], config, workspace);
    expect(parseBatch(converted.csv, workspace, workspace.templates[0]).errors).toEqual([]);
  });
  it('applies the invoice pattern to exported output-schema columns', () => {
    const config = defaultImportConfig(); config.numberPattern = '{prefix}{year}{month}-{seq:4}';
    const field = config.fields.find(f => f.target === 'invoice_number')!; field.column = 'bill_reference';
    const numbered = numberedSourceRows([row('2026-10-06')], config, initialWorkspace());
    expect(numbered[0].values.bill_reference).toBe('INV-202610-0001');
    expect(groupedCSV(numbered, config).get('2026/10/invoices.csv')).toContain('INV-202610-0001');
  });
  it('rejects duplicate output columns and invoice destinations', () => {
    const config = defaultImportConfig(); config.fields[1].column = config.fields[0].column; expect(importConfigError(config)).toContain('unique');
    config.fields[1].column = 'unique'; config.fields[1].target = config.fields[0].target; expect(importConfigError(config)).toContain('only once');
  });
});
describe('local CPU-only model', () => {
  it('only permits loopback URLs and no credentials', () => {
    expect(localEndpoint('http://localhost:11434')).toBe('http://localhost:11434'); expect(localEndpoint('http://127.0.0.1:11434/')).toBe('http://127.0.0.1:11434');
    for (const endpoint of ['https://example.com', 'http://user:password@localhost:11434', 'file:///etc/passwd', 'http://localhost:11434/proxy', 'http://localhost.evil.com']) expect(() => localEndpoint(endpoint)).toThrow();
  });
  it('disables GPU offload on every inference request and requests structured output', async () => {
    const mock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ response: JSON.stringify({ customer_name: 'Alice', rate: '100' }) }) }); vi.stubGlobal('fetch', mock);
    const config = defaultImportConfig(); const values = await extractWithModel('Customer: Alice\nRate: 100', config, new AbortController().signal);
    const request = JSON.parse(mock.mock.calls[0][1].body);
    expect(mock.mock.calls[0][0]).toBe('http://localhost:11434/api/generate'); expect(request.options.num_gpu).toBe(0); expect(request.options.num_thread).toBe(4); expect(request.stream).toBe(false);
    expect(request.format.properties.customer_name.type).toBe('string'); expect(values.customer_name).toBe('Alice');
  });
  it('rejects invalid model output rather than fabricating invoice values', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ response: '{"rate":{"unexpected":true}}' }) }));
    await expect(extractWithModel('source', defaultImportConfig(), new AbortController().signal)).rejects.toThrow('Invalid model value');
  });
  it('checks Ollama GPU placement instead of silently accepting a CPU fallback', async () => {
    const fetch = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ response: '{}' }) }).mockResolvedValueOnce({ ok: true, json: async () => ({ models: [{ name: 'qwen2.5:0.5b', size_vram: 0 }] }) });
    vi.stubGlobal('fetch', fetch);
    await expect(extractWithModel('source', { ...defaultImportConfig(), device: 'cuda:0' }, new AbortController().signal)).rejects.toThrow('GPU was requested');
    expect(JSON.parse(fetch.mock.calls[0][1].body).options.num_gpu).toBe(-1);
  });
});
