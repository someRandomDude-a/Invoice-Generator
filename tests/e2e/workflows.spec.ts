import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Invoices', exact: true })).toBeVisible();
});

async function fillInvoice(page: Page, customer = 'Aarav Sharma') {
  await page.getByLabel('Customer / company name *', { exact: true }).fill(customer);
  await page.getByLabel('Description *', { exact: true }).fill('Bike service');
  await page.getByLabel('Rate (INR) *', { exact: true }).fill('1500');
}
async function storedWorkspace(page: Page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem('indiabikes-invoice-studio-v1') || '{}'));
}

test('creates, exports, prints and persists an invoice', async ({ page }, testInfo) => {
  await page.getByRole('button', { name: 'Create invoice', exact: true }).click();
  await fillInvoice(page);
  await page.getByLabel('Reference', { exact: true }).fill('PO-1234');
  await page.getByRole('button', { name: 'Save invoice', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Invoice saved');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export input', exact: true }).click();
  const download = await downloadPromise;
  const text = await readFile((await download.path())!, 'utf8');
  expect(text).toContain('custom_reference');
  expect(text).toContain('PO-1234');
  expect(text).toContain('1500');

  await page.evaluate(() => { window.print = () => { document.body.dataset.printCalled = 'true'; }; });
  await page.getByRole('button', { name: 'Print / PDF', exact: true }).click();
  await expect(page.locator('body')).toHaveAttribute('data-print-called', 'true');
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('.app-shell')).toBeHidden();
  await expect(page.locator('.print-root .invoice-document')).toBeVisible();
  await expect(page.locator('.print-root .grand-total')).toContainText('1,770.00');
  const pdf = await page.pdf({ path: testInfo.outputPath('invoice.pdf'), preferCSSPageSize: true, printBackground: true });
  expect(pdf.byteLength).toBeGreaterThan(1000);
  await page.emulateMedia({ media: 'screen' });
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
  await page.getByRole('button', { name: 'All invoices', exact: true }).click();
  await expect(page.getByRole('button', { name: 'INV-0001', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: 'INV-0001', exact: true })).toBeVisible();
});

test('creates a custom template and preserves invoice snapshots', async ({ page }) => {
  await page.getByRole('button', { name: 'Templates', exact: true }).click();
  await page.getByRole('button', { name: 'Create template', exact: true }).click();
  await page.getByLabel('Template name *', { exact: true }).fill('Rental invoice');
  await page.getByRole('button', { name: 'Content & fields', exact: true }).click();
  await page.getByLabel('Document title *', { exact: true }).fill('Rental invoice');
  await page.getByRole('button', { name: 'Add custom field', exact: true }).click();
  await page.getByLabel('Label *', { exact: true }).last().fill('Rental period');
  await page.getByRole('button', { name: 'Save template', exact: true }).click();
  await page.locator('.template-card').filter({ has: page.getByRole('heading', { name: 'Rental invoice', exact: true }) }).getByRole('button', { name: 'Use template' }).click();
  await fillInvoice(page);
  await page.getByLabel('Rental period', { exact: true }).fill('6–8 October');
  await page.getByRole('button', { name: 'Save invoice', exact: true }).click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByLabel('Business name *', { exact: true }).fill('Updated IndiaBikes');
  await page.getByRole('button', { name: 'Save settings', exact: true }).click();
  const workspace = await storedWorkspace(page);
  expect(workspace.business.name).toBe('Updated IndiaBikes');
  expect(workspace.invoices[0].business.name).toBe('Your business');
  expect(workspace.invoices[0].template.title).toBe('Rental invoice');
});

test('imports arbitrary CSV columns with a numbering pattern', async ({ page }) => {
  await page.getByRole('button', { name: /^Batch generator/ }).click();
  await page.getByLabel('Or paste CSV data', { exact: true }).fill('Ref,Buyer,Thing,Cost,Date\nA,Alice,Service,100,2026-10-06\nA,Alice,Part,50,2026-10-06\nB,Bob,Helmet,200,2026-10-06');
  await page.getByLabel('Invoice number', { exact: true }).selectOption('Ref');
  await page.getByLabel('Customer name *', { exact: true }).selectOption('Buyer');
  await page.getByLabel('Item description *', { exact: true }).selectOption('Thing');
  await page.getByLabel('Unit rate *', { exact: true }).selectOption('Cost');
  await page.getByLabel('Invoice date', { exact: true }).selectOption('Date');
  await page.getByLabel('Invoice number pattern', { exact: false }).fill('{prefix}{year}-{seq:4}');
  await page.getByLabel('Keep invoice numbers from the CSV', { exact: false }).uncheck();
  await page.getByRole('button', { name: 'Validate mapped batch', exact: true }).click();
  await expect(page.getByRole('heading', { name: '2 invoices ready' })).toBeVisible();
  await page.getByRole('button', { name: 'Save batch', exact: true }).click();
  const workspace = await storedWorkspace(page);
  expect(workspace.invoices.map((invoice: { number: string }) => invoice.number)).toEqual(['INV-2026-0001', 'INV-2026-0002']);
  expect(workspace.invoices[0].items).toHaveLength(2);
});

test('recursively scans a directory, reviews rows and exports organized ZIP', async ({ page }) => {
  await page.getByRole('button', { name: 'Data import studio', exact: true }).click();
  await page.getByLabel('Engine', { exact: true }).selectOption('rules');
  await page.getByLabel('Import an entire directory', { exact: true }).setInputFiles('examples/source-folder');
  await expect(page.locator('.selected-source')).toContainText('2 matching files');
  await page.getByRole('button', { name: 'Scan & extract', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Review extracted data', exact: true })).toBeVisible();
  await expect(page.locator('.review-table tbody tr')).toHaveCount(2);
  await expect(page.locator('.scan-summary')).toContainText('0rows need corrections', { useInnerText: false });
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export organized ZIP', exact: true }).click();
  expect((await downloadPromise).suggestedFilename()).toBe('invoices-by-date.zip');
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Create invoices', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Invoices created', exact: true })).toBeDisabled();
  const workspace = await storedWorkspace(page);
  expect(workspace.invoices).toHaveLength(2);
  const singleDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Single CSV', exact: true }).click();
  const csv = await readFile((await (await singleDownload).path())!, 'utf8');
  expect(csv).toContain('source_file'); expect(csv).toContain('scan_confidence');
  for (const invoice of workspace.invoices) expect(csv).toContain(invoice.number);
});

test('uses CPU mode for local Ollama extraction', async ({ page }) => {
  let modelRequest: Record<string, unknown> | undefined;
  await page.route('http://localhost:11434/api/tags', route => route.fulfill({ json: { models: [{ name: 'qwen2.5:0.5b' }] } }));
  await page.route('http://localhost:11434/api/generate', async route => {
    modelRequest = route.request().postDataJSON();
    await route.fulfill({ json: { response: JSON.stringify({ customer_name: 'Alice', description: 'Service', rate: '100', issue_date: '2026-10-06' }) } });
  });
  await page.getByRole('button', { name: 'Data import studio', exact: true }).click();
  await page.getByLabel('Import source documents', { exact: true }).setInputFiles({ name: 'source.txt', mimeType: 'text/plain', buffer: Buffer.from('Customer: Alice\nService: Bike repair\nPrice: 100') });
  await page.getByLabel('Engine', { exact: true }).selectOption('ollama');
  await page.getByRole('button', { name: 'Scan & extract', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Review extracted data', exact: true })).toBeVisible();
  expect(modelRequest?.options).toMatchObject({ num_gpu: 0, num_thread: 4 });
  await expect(page.locator('.review-table')).toContainText('Alice');
});

test('has a usable mobile invoice form without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Create invoice', exact: true }).click();
  await fillInvoice(page);
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(page.locator('.preview-panel')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Edit details', exact: true }).click();
  await expect(page.getByLabel('Customer / company name *', { exact: true })).toBeVisible();
});

test('uploads raster branding and preserves it after deleting the library asset', async ({ page }) => {
  const dataUrl = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 100; canvas.height = 50;
    const context = canvas.getContext('2d')!; context.fillStyle = '#173f35'; context.fillRect(0, 0, 100, 50);
    return canvas.toDataURL('image/png');
  });
  await page.getByRole('button', { name: 'Asset library', exact: true }).click();
  await page.getByLabel('Upload brand images', { exact: true }).setInputFiles({ name: 'brand-logo.png', mimeType: 'image/png', buffer: Buffer.from(dataUrl.split(',')[1], 'base64') });
  await expect(page.getByRole('heading', { name: 'brand-logo', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Templates', exact: true }).click();
  await page.getByRole('button', { name: 'Edit Studio / GST', exact: true }).click();
  const workspace = await storedWorkspace(page);
  await page.getByLabel('Logo', { exact: true }).selectOption(workspace.assets[0].id);
  await page.getByRole('button', { name: 'Save template', exact: true }).click();
  await page.getByRole('button', { name: 'Use template', exact: true }).first().click();
  await fillInvoice(page);
  await page.getByRole('button', { name: 'Save invoice', exact: true }).click();
  await page.getByRole('button', { name: 'Asset library', exact: true }).click();
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Delete brand-logo', exact: true }).click();
  const updated = await storedWorkspace(page);
  expect(updated.assets).toHaveLength(0); expect(updated.invoices[0].assets).toHaveLength(1);
  expect(updated.invoices[0].assets[0].dataUrl).toMatch(/^data:image\/webp/);
});

test('restores valid backups and rejects malformed backups', async ({ page }) => {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export workspace', exact: true }).click();
  const data = JSON.parse(await readFile((await (await downloadPromise).path())!, 'utf8'));
  data.business.name = 'Restored Bikes';
  page.once('dialog', dialog => dialog.accept());
  await page.getByLabel('Restore workspace backup', { exact: true }).setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)) });
  await expect(page.getByLabel('Business name *', { exact: true })).toHaveValue('Restored Bikes');
  await page.getByLabel('Restore workspace backup', { exact: true }).setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{"version":999}') });
  await expect(page.getByRole('alert')).toContainText('Could not restore backup');
  expect((await storedWorkspace(page)).business.name).toBe('Restored Bikes');
});

test('extracts DOCX bodies and text-based PDFs without a model', async ({ page }) => {
  const docxText = await page.evaluate(async () => {
    const modulePath = '/src/imports.ts'; const engine = await import(modulePath);
    const xml = '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Customer name: Alice</w:t></w:r></w:p><w:p><w:r><w:t>Rate: 100</w:t></w:r></w:p></w:body></w:document>';
    const bytes = engine.zipCSV(new Map([['word/document.xml', xml]]));
    return (await engine.documentText(new File([bytes], 'source.docx'))).text;
  });
  expect(docxText).toContain('Customer name: Alice'); expect(docxText).toContain('Rate: 100');
  await page.setContent('<div>Customer name: Alice</div><div>Description: Bike service</div><div>Rate: 100</div>');
  const pdf = await page.pdf();
  const pdfText = await page.evaluate(async base64 => {
    const modulePath = '/src/imports.ts'; const engine = await import(modulePath);
    const bytes = Uint8Array.from(atob(base64), value => value.charCodeAt(0));
    return (await engine.documentText(new File([bytes], 'source.pdf'))).text;
  }, pdf.toString('base64'));
  expect(pdfText).toContain('Customer name: Alice'); expect(pdfText).toContain('Bike service');
});

test('persists light/dark mode and shows the default Laya model with GPU controls', async ({ page }, testInfo) => {
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.screenshot({ path: testInfo.outputPath('studio-dark.png'), fullPage: true });
  await page.getByRole('button', { name: 'Switch to light mode' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.getByRole('button', { name: 'Switch to dark mode' }).click();
  await page.route('http://127.0.0.1:8000/health', route => route.fulfill({ json: { status: 'ok', devices: ['cpu', 'cuda:0'], default_model: 'convaiinnovations/laya', laya_installed: true } }));
  await page.route('http://127.0.0.1:8000/models', route => route.fulfill({ json: { presets: [], downloaded: [] } }));
  await page.getByRole('button', { name: 'Data import studio', exact: true }).click();
  await expect(page.getByLabel('Hugging Face repository', { exact: true })).toHaveValue('convaiinnovations/laya');
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Download weights', exact: true })).toBeEnabled();
  await page.getByLabel('Device', { exact: true }).selectOption('cuda:0');
  await expect(page.locator('.cpu-badge')).toContainText('GPU');
  await page.screenshot({ path: testInfo.outputPath('extraction-dark.png'), fullPage: true });
});

test('extracts on the selected GPU through the local Laya runner and displays confidence', async ({ page }) => {
  let request: Record<string, unknown> | undefined;
  await page.route('http://127.0.0.1:8000/health', route => route.fulfill({ json: { status: 'ok', devices: ['cpu', 'cuda:0'], default_model: 'convaiinnovations/laya', laya_installed: true } }));
  await page.route('http://127.0.0.1:8000/extract', async route => {
    request = route.request().postDataJSON();
    await route.fulfill({ json: { values: { customer_name: 'Alice', description: 'Service', rate: '100', issue_date: '2026-10-06' }, confidence: { customer_name: 0.9 }, warnings: [], device: 'cuda:0', model: 'convaiinnovations/laya' } });
  });
  await page.getByRole('button', { name: 'Data import studio', exact: true }).click();
  await page.getByLabel('Device', { exact: true }).selectOption('cuda:0');
  await page.getByLabel('Import source documents', { exact: true }).setInputFiles({ name: 'invoice.txt', mimeType: 'text/plain', buffer: Buffer.from('Customer: Alice\nRate: 100') });
  await page.getByRole('button', { name: 'Scan & extract', exact: true }).click();
  await expect(page.locator('.review-table')).toContainText('Alice');
  expect(request?.repo_id).toBe('convaiinnovations/laya'); expect(request?.device).toBe('cuda:0');
  await page.getByRole('button', { name: 'Edit invoice.txt', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Model confidence: 90%');
});
