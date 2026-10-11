import { useCallback, useEffect, useRef, useState } from 'react';
import { Copy, Download, ImagePlus, ScanLine, Trash2 } from 'lucide-react';
import { ImageReader } from '../lib/ocr';
import { download, safeName } from '../lib/exporter';

export default function ImageText() {
  const [image, setImage] = useState<{ url: string; name: string }>();
  const [text, setText] = useState(''), [busy, setBusy] = useState(false), [progress, setProgress] = useState(0), [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null), reader = useRef<ImageReader | undefined>(undefined), current = useRef(0), url = useRef<string | undefined>(undefined);
  const clear = useCallback(() => {
    current.current++; reader.current?.dispose(); reader.current = undefined;
    if (url.current) URL.revokeObjectURL(url.current); url.current = undefined;
    setImage(undefined); setText(''); setBusy(false); setProgress(0); setError('');
  }, []);
  useEffect(() => () => { current.current++; reader.current?.dispose(); if (url.current) URL.revokeObjectURL(url.current); }, []);
  const load = useCallback(async (file: File) => {
    clear(); const token = current.current; setBusy(true);
    try {
      if (!['image/png', 'image/jpeg', 'image/webp', 'image/bmp'].includes(file.type)) throw new Error('PNG, JPG, WebP 또는 BMP 이미지를 넣어 주세요.');
      if (file.size > 25 * 1048576) throw new Error('이미지는 25MB 이하로 넣어 주세요. 필요한 글자 부분을 잘라 넣으면 더 빠릅니다.');
      let bitmap: ImageBitmap;
      try { bitmap = await createImageBitmap(file); } catch { throw new Error('이미지를 열 수 없습니다. 손상되지 않은 이미지 파일을 넣어 주세요.'); }
      const pixels = bitmap.width * bitmap.height; bitmap.close();
      if (pixels > 24_000_000) throw new Error('이미지는 2,400만 화소 이하로 넣어 주세요. 필요한 영역을 잘라 다시 넣어 주세요.');
      if (token !== current.current) return;
      const preview = URL.createObjectURL(file); url.current = preview;
      setImage({ url: preview, name: file.name || '스크린샷' });
      const client = new ImageReader(); reader.current = client;
      const result = await client.read(file, n => { if (token === current.current) setProgress(n); });
      if (token === current.current) {
        setText(result); if (!result) setError('읽을 수 있는 글자를 찾지 못했습니다. 선명한 원본이나 글자 부분을 잘라 넣어 주세요.');
      }
    } catch (e) { if (token === current.current) setError(e instanceof Error ? e.message : String(e)); }
    finally { if (token === current.current) { setBusy(false); reader.current?.dispose(); reader.current = undefined; } }
  }, [clear]);
  useEffect(() => {
    const paste = (event: ClipboardEvent) => {
      const file = [...(event.clipboardData?.files || [])].find(f => f.type.startsWith('image/'));
      if (file) { event.preventDefault(); void load(file); }
    };
    window.addEventListener('paste', paste);
    return () => window.removeEventListener('paste', paste);
  }, [load]);
  return <div className="page narrow image-text-page">
    <div className="page-title"><div className="eyebrow">FROM IMAGE TO TEXT</div><h1>이미지 → TXT</h1><p>직접 캡처한 선명한 화면을 넣으면 한국어와 영어를 함께 읽어요.</p></div>
    <section className="panel settings-section">
      <div className="image-drop" tabIndex={0} role="button" aria-label="이미지 넣기 · 붙여넣기 가능"
        onClick={() => input.current?.click()} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.current?.click(); } }}
        onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); const file = e.dataTransfer.files[0]; if (file) void load(file); }}>
        <ImagePlus size={32} /><strong>이미지를 끌어 넣거나 클릭하세요</strong><span>Ctrl+V로 스크린샷 붙여넣기 · PNG / JPG / WebP / BMP · 최대 25MB</span>
      </div>
      <input ref={input} className="sr-only" type="file" accept="image/png,image/jpeg,image/webp,image/bmp" aria-label="글자 읽을 이미지 선택" onChange={e => { const file = e.target.files?.[0]; if (file) void load(file); e.target.value = ''; }} />
      <p className="small">이미지와 읽은 글자는 저장하거나 서버로 보내지 않습니다. 이 화면을 떠나거나 새로고침하면 사라집니다. 첫 사용 시 글자 인식 모델만 다운로드·캐시합니다.</p>
      {busy && <div className="progress-block" role="status"><span><ScanLine size={16} /> 원본 이미지에서 글자를 읽고 있어요 · {Math.round(progress)}%</span><progress max={100} value={progress} /></div>}
      {error && <p className="notice warning" role="alert">{error}</p>}
      {image && <><div className="section-heading"><h2>{image.name}</h2><button className="text-link" onClick={clear}><Trash2 size={15} /> 이미지·결과 지우기</button></div><img className="input-preview" src={image.url} alt="이번에 넣은 원본 이미지" /></>}
    </section>
    <section className="panel settings-section"><div className="section-heading"><h2>읽은 글자</h2><span className="tag">시간 표시 없이 TXT</span></div>
      <textarea aria-label="읽은 글자 수정" rows={12} value={text} onChange={e => setText(e.target.value)} placeholder="글자를 읽으면 여기에 표시됩니다. 내려받기 전에 직접 수정할 수 있어요." disabled={busy} />
      <div className="actions"><button className="button secondary" disabled={busy || !text.trim()} onClick={() => void navigator.clipboard.writeText(text).catch(() => setError('복사 권한이 없습니다. TXT 다운로드를 이용하세요.'))}><Copy size={17} /> 복사</button><button className="button primary" disabled={busy || !text.trim()} onClick={() => download(new Blob([text], { type: 'text/plain;charset=utf-8' }), `${safeName(image?.name.replace(/\.[^.]+$/, '') || '이미지-글자')}.txt`)}><Download size={17} /> TXT 다운로드</button></div>
      <p className="small">작은 글자·표·수식·복잡한 배치는 틀릴 수 있습니다. 필요한 글자 영역을 선명하게 넣고 결과를 확인해 주세요.</p>
    </section>
  </div>;
}
