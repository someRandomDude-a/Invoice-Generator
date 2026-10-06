import { useRef, useState } from 'react';
import { Upload, ImagePlus, Trash2, Image, Pencil, FolderOpen } from 'lucide-react';
import { Button, EmptyState, Input, Select } from './ui';
import { uid, type Asset, type Workspace } from './model';

export default function Assets({ workspace, onAdd, onUpdate, onDelete, notify }: {
  workspace: Workspace; onAdd: (assets: Asset[]) => void; onUpdate: (asset: Asset) => void;
  onDelete: (id: string) => void; notify: (text: string, error?: boolean) => void;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [filter, setFilter] = useState('all');
  const [renameId, setRenameId] = useState('');
  const [newName, setNewName] = useState('');
  const upload = async (files: FileList | null) => {
    if (!files?.length || uploading) return;
    if (workspace.assets.length + files.length > 100) { notify('The asset library can hold up to 100 images.', true); return; }
    setUploading(true);
    const imported: Asset[] = [];
    for (const file of Array.from(files)) {
      try {
        if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('Use a PNG, JPG or WebP image. SVG and other formats are not supported.');
        if (file.size > 2 * 1024 * 1024) throw new Error('Images must be smaller than 2 MB.');
        const bitmap = await createImageBitmap(file);
        if (bitmap.width > 10000 || bitmap.height > 10000) { bitmap.close(); throw new Error('Image dimensions must be at most 10,000 × 10,000 pixels.'); }
        // Normalize and resize raster assets, retaining transparency and limiting storage use.
        const scale = Math.min(1, 1200 / Math.max(bitmap.width, bitmap.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Could not process this image.');
        ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height); bitmap.close();
        const dataUrl = canvas.toDataURL('image/webp', 0.88);
        if (dataUrl.length > 500000) throw new Error('This image is too detailed for local storage. Try a smaller image.');
        imported.push({ id: uid(), name: file.name.replace(/\.[^.]+$/, '').slice(0, 200) || 'Untitled image', kind: /sign/i.test(file.name) ? 'signature' : /logo/i.test(file.name) ? 'logo' : 'image', dataUrl, createdAt: new Date().toISOString() });
      } catch (error) { notify(`${file.name}: ${error instanceof Error ? error.message : 'Could not read image.'}`, true); }
    }
    if (imported.length) { onAdd(imported); notify(`${imported.length} ${imported.length === 1 ? 'asset added' : 'assets added'} to your library.`); }
    setUploading(false);
    if (fileInput.current) fileInput.current.value = '';
  };
  const assets = workspace.assets.filter(asset => filter === 'all' || asset.kind === filter);
  return <>
    <div className="page-heading"><div><div className="eyebrow">YOUR BRAND TOOLKIT</div><h1>Asset library</h1><p>Give every invoice a familiar face.</p></div><Button variant="primary" disabled={uploading} onClick={() => fileInput.current?.click()}><Upload size={17} />{uploading ? 'Processing…' : 'Upload assets'}</Button></div>
    <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" multiple className="visually-hidden" aria-label="Upload brand images" onChange={e => void upload(e.target.files)} />
    <div className={`upload-zone ${dragging ? 'dragging' : ''}`} onDragOver={e => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={e => { e.preventDefault(); setDragging(false); void upload(e.dataTransfer.files); }}><div className="upload-icon"><ImagePlus size={28} strokeWidth={1.5} /></div><h3>Your brand belongs here.</h3><p>Drop your logos, signatures and images here, or <button className="text-button" disabled={uploading} onClick={() => fileInput.current?.click()}>browse files</button>.</p><span className="small muted">PNG, JPG or WebP · Up to 2 MB each · Optimized automatically</span></div>
    <div className="list-toolbar"><div className="filter-tabs">{[['all', 'All assets'], ['logo', 'Logos'], ['signature', 'Signatures'], ['image', 'Images']].map(([value, label]) => <button key={value} className={filter === value ? 'active' : ''} onClick={() => setFilter(value)}>{label}</button>)}</div><span className="muted small">{assets.length} assets</span></div>
    {assets.length ? <div className="assets-grid">{assets.map(asset => <article className="card asset-card" key={asset.id}><div className="asset-image"><img src={asset.dataUrl} alt={asset.name} /></div><div className="asset-content">{renameId === asset.id ? <form className="rename-form" onSubmit={e => { e.preventDefault(); if (newName.trim()) { onUpdate({ ...asset, name: newName.trim() }); setRenameId(''); } }}><Input aria-label="Asset name" value={newName} maxLength={200} onChange={e => setNewName(e.target.value)} autoFocus /><Button type="submit">Save</Button></form> : <div className="asset-name"><h3>{asset.name}</h3><button className="icon-button" aria-label={`Rename ${asset.name}`} onClick={() => { setRenameId(asset.id); setNewName(asset.name); }}><Pencil size={14} /></button></div>}<div className="asset-meta"><Select aria-label={`Type of ${asset.name}`} value={asset.kind} onChange={e => onUpdate({ ...asset, kind: e.target.value as Asset['kind'] })}><option value="logo">Logo</option><option value="signature">Signature</option><option value="image">Image</option></Select><button className="icon-button danger-text" aria-label={`Delete ${asset.name}`} onClick={() => {
      const inUse = workspace.templates.some(t => t.logoAssetId === asset.id || t.signatureAssetId === asset.id);
      if (window.confirm(`Delete “${asset.name}”? ${inUse ? 'It will be removed from templates. ' : ''}Saved invoices will keep their copies.`)) onDelete(asset.id);
    }}><Trash2 size={16} /></button></div></div></article>)}</div> : <EmptyState icon={filter === 'all' ? <FolderOpen size={26} /> : <Image size={26} />} title={filter === 'all' ? 'A home for your brand' : 'No assets in this category'} description="Upload an image, categorize it, then add it to your invoice templates." />}
    <div className="bottom-tip"><span>GOOD TO KNOW</span><p>Assets are stored on this browser. Use transparent images for the cleanest result, and keep backups of your workspace.</p></div>
  </>;
}
