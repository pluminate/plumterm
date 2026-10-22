import React, { useRef, useEffect } from 'react';

export default function PaneControls({
  onSplitRight,
  onSplitDown,
  onClose,
  onCloseMenu,
  canClose,
  visible = false,
  x = 0,
  y = 0
}) {
  const menuRef = useRef(null);

  useEffect(() => {
    if (!visible) return;

    const handleClickOutside = (e) => {
      // Check if click is outside menu
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        onCloseMenu?.();
      }
    };

    // Delay to avoid closing immediately when menu opens
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
    }, 50);

    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [visible, onCloseMenu]);

  if (!visible) return null;

  const handleButtonClick = (callback) => (e) => {
    e.stopPropagation();
    callback();
    onCloseMenu?.();
  };

  return (
    <div
      ref={menuRef}
      className="context-menu"
      style={{
        position: 'fixed',
        top: `${y}px`,
        left: `${x}px`,
        zIndex: 1000
      }}
    >
      <button
        className="context-menu-item"
        onClick={handleButtonClick(onSplitRight)}
      >
        Split Right
      </button>
      <button
        className="context-menu-item"
        onClick={handleButtonClick(onSplitDown)}
      >
        Split Down
      </button>
      <div className="context-menu-divider" />
      <button
        className="context-menu-item"
        onClick={handleButtonClick(onClose)}
        disabled={!canClose}
      >
        Close
      </button>
    </div>
  );
}
