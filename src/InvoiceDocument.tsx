import type { CSSProperties } from 'react';
import { formatDate, formatMoney, totals, type Invoice } from './model';

export default function InvoiceDocument({ invoice, sample = false }: { invoice: Invoice; sample?: boolean }) {
  const { business, template, customer } = invoice;
  const amount = totals(invoice);
  const money = (value: number) => formatMoney(value, business.currency);
  const logo = invoice.assets.find(asset => asset.id === template.logoAssetId);
  const signature = invoice.assets.find(asset => asset.id === template.signatureAssetId);
  return <article className={`invoice-document layout-${template.layout}`} style={{ '--invoice-accent': template.accent } as CSSProperties}>
    <header className="document-header">
      <div className="document-brand">
        {logo && <img className="invoice-logo" src={logo.dataUrl} alt={`${business.name} logo`} />}
        <h2>{business.name}</h2>
        <p className="pre-line">{business.address}</p>
        {(business.email || business.phone) && <p>{[business.email, business.phone].filter(Boolean).join(' · ')}</p>}
        {business.gstin && <p><strong>GSTIN</strong> {business.gstin}</p>}
      </div>
      <div className="document-title"><span>{sample ? 'SAMPLE PREVIEW' : invoice.status === 'draft' ? 'DRAFT' : invoice.status === 'paid' ? 'PAID' : 'ORIGINAL'}</span><h1>{template.title}</h1><strong>{invoice.number}</strong></div>
    </header>
    <div className="document-details">
      <div><h4>BILL TO</h4><h3>{customer.name || 'Customer name'}</h3><p className="pre-line">{customer.address}</p>{customer.email && <p>{customer.email}</p>}{customer.phone && <p>{customer.phone}</p>}{customer.gstin && <p><strong>GSTIN</strong> {customer.gstin}</p>}</div>
      <dl><div><dt>Invoice date</dt><dd>{formatDate(invoice.issueDate)}</dd></div><div><dt>Payment due</dt><dd>{formatDate(invoice.dueDate)}</dd></div>{template.customFields.map(field => invoice.customValues[field.id] && <div key={field.id}><dt>{field.label}</dt><dd>{invoice.customValues[field.id]}</dd></div>)}</dl>
    </div>
    <table className="document-items">
      <thead><tr><th className="description">Description</th>{template.showHSN && <th>HSN/SAC</th>}<th>Qty</th><th>Rate</th>{template.showDiscount && <th>Disc.</th>}{template.taxMode !== 'none' && <th>Tax</th>}<th>Amount</th></tr></thead>
      <tbody>{invoice.items.map((item, index) => <tr key={item.id}><td>{item.description || 'Item description'}</td>{template.showHSN && <td>{item.hsn || '—'}</td>}<td>{item.quantity}</td><td>{money(item.rate)}</td>{template.showDiscount && <td>{item.discount}%</td>}{template.taxMode !== 'none' && <td>{item.taxRate}%</td>}<td>{money(amount.lines[index].total / 100)}</td></tr>)}</tbody>
    </table>
    <div className="document-bottom">
      <div className="document-notes">{invoice.notes && <section><h4>NOTES</h4><p className="pre-line">{invoice.notes}</p></section>}{template.showBank && (business.bankName || business.accountNumber || business.ifsc) && <section><h4>PAYMENT DETAILS</h4>{business.bankName && <p>{business.bankName}</p>}{business.accountNumber && <p>Account: {business.accountNumber}</p>}{business.ifsc && <p>IFSC / routing: {business.ifsc}</p>}</section>}</div>
      <dl className="document-totals"><div><dt>Subtotal</dt><dd>{money(amount.subtotal)}</dd></div>{amount.discount > 0 && <div><dt>Discount</dt><dd>−{money(amount.discount)}</dd></div>}{template.taxMode === 'split' ? <><div><dt>CGST</dt><dd>{money(amount.cgst)}</dd></div><div><dt>SGST</dt><dd>{money(amount.sgst)}</dd></div></> : template.taxMode === 'single' ? <div><dt>Tax / IGST</dt><dd>{money(amount.tax)}</dd></div> : null}<div className="grand-total"><dt>Total</dt><dd>{money(amount.total)}</dd></div>{amount.paid > 0 && <><div><dt>Amount paid</dt><dd>{money(amount.paid)}</dd></div><div className="balance"><dt>Balance due</dt><dd>{money(amount.balance)}</dd></div></>}</dl>
    </div>
    <div className="document-closing">{template.terms && <section><h4>TERMS & CONDITIONS</h4><p className="pre-line">{template.terms}</p></section>}{template.showSignature && <div className="signature">{signature && <img src={signature.dataUrl} alt="Authorized signature" />}<div className="signature-line" /><span>Authorized signatory</span></div>}</div>
    {template.footer && <footer className="document-footer">{template.footer}</footer>}
  </article>;
}
