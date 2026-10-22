import React, { useState, useEffect } from 'react';

const vscodeIcon = window.electron?.ipcRenderer ? null : null; // We'll pass what we need

export default function DiffViewer({ diff, cwd, changedFiles, onClose, onDiscard, onNext, onPrev }) {
  const [split, setSplit] = useState(false);
  const [discardConfirm, setDiscardConfirm] = useState(false);

  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [onClose]);

  const splitRows = (() => {
    const rows = [];
    const lines = diff.lines;
    let i = 0, leftNum = 0, rightNum = 0;
    while (i < lines.length && !lines[i].startsWith('@@')) i++;
    while (i < lines.length) {
      const line = lines[i];
      if (line.startsWith('@@')) {
        const m = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
        if (m) { leftNum = parseInt(m[1]); rightNum = parseInt(m[2]); }
        rows.push({ type: 'hunk', content: line }); i++;
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        const dels = [], adds = [];
        while (i < lines.length && lines[i].startsWith('-') && !lines[i].startsWith('---')) dels.push({ num: leftNum++, content: lines[i++].slice(1) });
        while (i < lines.length && lines[i].startsWith('+') && !lines[i].startsWith('+++')) adds.push({ num: rightNum++, content: lines[i++].slice(1) });
        for (let j = 0; j < Math.max(dels.length, adds.length); j++) rows.push({ type: 'change', left: dels[j] || null, right: adds[j] || null });
      } else if (line.startsWith('+') && !line.startsWith('+++')) {
        rows.push({ type: 'change', left: null, right: { num: rightNum++, content: line.slice(1) } }); i++;
      } else if (!line.startsWith('---') && !line.startsWith('+++') && !line.startsWith('diff') && !line.startsWith('index')) {
        rows.push({ type: 'context', left: { num: leftNum++, content: line.slice(1) }, right: { num: rightNum++, content: line.slice(1) } }); i++;
      } else { i++; }
    }
    return rows;
  })();

  const cellStyle = (bg) => ({ backgroundColor: bg, padding: '0 8px', whiteSpace: 'pre', userSelect: 'text', overflow: 'hidden' });
  const numStyle = (bg) => ({ backgroundColor: bg, color: '#4b5563', padding: '0 4px', userSelect: 'none', textAlign: 'right', width: '36px', minWidth: '36px', fontSize: '11px' });

  const handleMouseDown = (e) => {
    if (e.button === 1) { e.preventDefault(); onClose(); return; }
    if (e.button === 3) { e.preventDefault(); onPrev(); }
    if (e.button === 4) { e.preventDefault(); onNext(); }
  };

  return (
    <div 
      onMouseDown={handleMouseDown}
      style={{ position: 'fixed', top: '60px', left: '40px', right: '40px', bottom: '40px', backgroundColor: '#0d1117', border: '1px solid #334155', borderRadius: '8px', zIndex: 999, display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,0.8)' }}
    >
      <div style={{ padding: '6px 10px', borderBottom: '1px solid #334155', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
        <span style={{ color: '#94a3b8', fontSize: '11px', fontFamily: 'monospace' }}>{diff.file}</span>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <button onClick={() => setSplit(s => !s)} style={{ background: '#1e293b', border: '1px solid #334155', color: '#94a3b8', cursor: 'pointer', fontSize: '11px', padding: '2px 8px', borderRadius: '4px' }}>
            {split ? 'Unified' : 'Split'}
          </button>
          {discardConfirm ? (
            <>
              <span style={{ fontSize: '11px', color: '#f87171' }}>Discard changes?</span>
              <button
                onClick={() => { setDiscardConfirm(false); onDiscard(diff.file); }}
                style={{ background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.4)', color: '#f87171', cursor: 'pointer', fontSize: '11px', padding: '2px 8px', borderRadius: '4px' }}
              >Yes</button>
              <button onClick={() => setDiscardConfirm(false)} style={{ background: '#1e293b', border: '1px solid #334155', color: '#94a3b8', cursor: 'pointer', fontSize: '11px', padding: '2px 8px', borderRadius: '4px' }}>No</button>
            </>
          ) : (
            <button onClick={() => setDiscardConfirm(true)} style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)', color: '#f87171', cursor: 'pointer', fontSize: '11px', padding: '2px 8px', borderRadius: '4px' }}>
              Discard
            </button>
          )}
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: '16px' }}>×</button>
        </div>
      </div>
      <div style={{ flex: 1, overflow: 'auto', fontFamily: 'monospace', fontSize: '12px', lineHeight: '1.6' }}>
        {split ? (
          <table style={{ borderCollapse: 'collapse', width: '100%', tableLayout: 'fixed' }}>
            <colgroup>
              <col style={{ width: '36px' }} />
              <col style={{ width: 'calc(50% - 36px)' }} />
              <col style={{ width: '36px' }} />
              <col style={{ width: 'calc(50% - 36px)' }} />
            </colgroup>
            <tbody>
              {splitRows.map((row, i) => {
                if (row.type === 'hunk') return (
                  <tr key={i}><td colSpan={4} style={{ backgroundColor: '#0d1b2b', color: '#58a6ff', padding: '0 12px', whiteSpace: 'pre', userSelect: 'text' }}>{row.content}</td></tr>
                );
                const leftBg = row.left && row.right === null ? '#3b0d0d' : row.left && !row.right ? '#3b0d0d' : row.left && row.right ? '#2b0d0d' : 'transparent';
                const rightBg = row.right && row.left === null ? '#0d2b1a' : row.right && !row.left ? '#0d2b1a' : row.right && row.left ? '#0d2b1a' : 'transparent';
                return (
                  <tr key={i} style={{ borderBottom: '1px solid #161b22' }}>
                    <td style={numStyle(leftBg ? '#1a0808' : 'transparent')}>{row.left?.num ?? ''}</td>
                    <td style={{ ...cellStyle(leftBg), color: leftBg !== 'transparent' ? '#f85149' : '#e6edf3' }}>{row.left?.content ?? ' '}</td>
                    <td style={numStyle(rightBg ? '#081a10' : 'transparent')}>{row.right?.num ?? ''}</td>
                    <td style={{ ...cellStyle(rightBg), color: rightBg !== 'transparent' ? '#3fb950' : '#e6edf3' }}>{row.right?.content ?? ' '}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          diff.lines.map((line, i) => {
            const bg = line.startsWith('+') && !line.startsWith('+++') ? '#0d2b1a'
              : line.startsWith('-') && !line.startsWith('---') ? '#2b0d0d'
              : line.startsWith('@@') ? '#0d1b2b'
              : 'transparent';
            const color = line.startsWith('+') && !line.startsWith('+++') ? '#3fb950'
              : line.startsWith('-') && !line.startsWith('---') ? '#f85149'
              : line.startsWith('@@') ? '#58a6ff'
              : line.startsWith('diff') || line.startsWith('index') || line.startsWith('+++') || line.startsWith('---') ? '#8b949e'
              : '#e6edf3';
            return <div key={i} style={{ backgroundColor: bg, color, padding: '0 12px', whiteSpace: 'pre', userSelect: 'text' }}>{line || ' '}</div>;
          })
        )}
      </div>
    </div>
  );
}
