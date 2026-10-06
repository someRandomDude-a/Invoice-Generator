import { cloneElement, isValidElement, useId, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { Plus } from 'lucide-react';

export function Button({ children, variant = 'secondary', className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; children: ReactNode }) {
  return <button className={`button ${variant} ${className}`} type="button" {...props}>{children}</button>;
}
export function Field({ label, hint, children, className = '' }: { label: string; hint?: string; children: ReactNode; className?: string }) {
  const id = useId();
  const control = isValidElement<{ id?: string; 'aria-describedby'?: string }>(children)
    ? cloneElement(children, { id, 'aria-describedby': hint ? `${id}-hint` : undefined }) : children;
  return <div className={`field ${className}`}><label className="field-label" htmlFor={id}>{label}</label>{control}{hint && <small id={`${id}-hint`}>{hint}</small>}</div>;
}
export function Input(props: InputHTMLAttributes<HTMLInputElement>) { return <input {...props} />; }
export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) { return <textarea rows={3} {...props} />; }
export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) { return <select {...props} />; }
export function Toggle({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <label className="toggle-row"><span><strong>{label}</strong>{hint && <small>{hint}</small>}</span><input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} /><span className="toggle-track" aria-hidden="true" /></label>;
}
export function EmptyState({ icon, title, description, action, onAction }: { icon: ReactNode; title: string; description: string; action?: string; onAction?: () => void }) {
  const minimalCopy: Record<string, [string, string]> = {
    'Your next chapter starts here': ['No invoices', 'Create an invoice to get started.'],
    'A home for your brand': ['No assets', 'Upload a logo, signature or image.'],
    'A fresh view of your files': ['No imported data', 'Select files or a folder, then scan.'],
  };
  if (minimalCopy[title]) [title, description] = minimalCopy[title];
  if (title === 'No invoices') action = undefined;
  return <div className="empty-state"><div className="empty-icon">{icon}</div><h3>{title}</h3><p>{description}</p>{action && <Button variant="primary" onClick={onAction}><Plus size={16} />{action}</Button>}</div>;
}
export function SectionTitle({ number, title, children }: { number?: string; title: string; children?: ReactNode }) {
  return <div className="section-title"><h3>{number && <span>{number}</span>}{title}</h3>{children}</div>;
}
