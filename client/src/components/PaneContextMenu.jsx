import React, { useEffect, useRef } from 'react';

const isMac = window.navigator.platform.includes('Mac');
const cmd = isMac ? '⌘' : 'Ctrl+';
const shift = isMac ? '⇧' : 'Shift+';

// Right-click menu drawn in the page (a native popup menu does not show up reliably inside the snap)
export default function PaneContextMenu({ x, y, hasSelection, canClose, onAction, onDismiss }) {
  const ref = useRef(null);

  useEffect(() => {
    const dismiss = (e) => {
      if (e.type === 'keydown' && e.key !== 'Escape') return;
      if (e.type === 'mousedown' && ref.current?.contains(e.target)) return;
      onDismiss();
    };
    window.addEventListener('mousedown', dismiss, true);
    window.addEventListener('keydown', dismiss, true);
    window.addEventListener('blur', onDismiss);
    window.addEventListener('resize', onDismiss);
    return () => {
      window.removeEventListener('mousedown', dismiss, true);
      window.removeEventListener('keydown', dismiss, true);
      window.removeEventListener('blur', onDismiss);
      window.removeEventListener('resize', onDismiss);
    };
  }, [onDismiss]);

  // Keep the menu inside the window
  const width = 230;
  const height = 190;
  const left = Math.min(x, window.innerWidth - width - 4);
  const top = Math.min(y, window.innerHeight - height - 4);

  const items = [
    { id: 'copy', label: 'Copy', disabled: !hasSelection },
    { id: 'paste', label: 'Paste' },
    { id: 'select-all', label: 'Select All', hint: isMac ? '⌘A' : `${cmd}${shift}A` },
    { separator: true },
    { id: 'split-right', label: 'Split Right', hint: `${cmd}${shift}R` },
    { id: 'split-down', label: 'Split Down', hint: `${cmd}${shift}D` },
    { separator: true },
    { id: 'close', label: 'Close', hint: `${cmd}W`, disabled: !canClose },
  ];

  return (
    <div
      ref={ref}
      className="pane-context-menu"
      style={{
        position: 'fixed', left, top, width, zIndex: 10000, padding: '4px 0',
        background: '#1f2430', color: '#e5e7eb', border: '1px solid #3b4252',
        borderRadius: 6, boxShadow: '0 8px 24px rgba(0,0,0,0.5)', fontSize: 13, userSelect: 'none',
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((item, i) => item.separator ? (
        <div key={`sep-${i}`} style={{ height: 1, margin: '4px 0', background: '#3b4252' }} />
      ) : (
        <div
          key={item.id}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={() => { if (!item.disabled) onAction(item.id); }}
          onMouseEnter={(e) => { if (!item.disabled) e.currentTarget.style.background = '#2f3747'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
          style={{
            display: 'flex', justifyContent: 'space-between', padding: '5px 12px',
            cursor: item.disabled ? 'default' : 'pointer', opacity: item.disabled ? 0.4 : 1,
          }}
        >
          <span>{item.label}</span>
          {item.hint && <span style={{ opacity: 0.6, marginLeft: 16 }}>{item.hint}</span>}
        </div>
      ))}
    </div>
  );
}
