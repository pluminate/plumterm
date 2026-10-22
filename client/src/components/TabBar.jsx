import React, { useState, useRef, useEffect } from 'react';

export default function TabBar({ tabs, activeTabIndex, onSelectTab, onCloseTab, onMiddleClickTab, onNewTab, onRenameTab, onMoveTab, onToggleSettings, showSettings }) {
  const [editingIndex, setEditingIndex] = useState(null);
  const [draggedIndex, setDraggedIndex] = useState(null);
  const [editValue, setEditValue] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    if (editingIndex !== null && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingIndex]);

  const handleDoubleClick = (index, title) => {
    setEditingIndex(index);
    setEditValue(title);
  };

  const handleKeyDown = (e, index) => {
    if (e.key === 'Enter') {
      onRenameTab(index, editValue);
      setEditingIndex(null);
    } else if (e.key === 'Escape') {
      setEditingIndex(null);
    }
  };

  const handleBlur = (index) => {
    if (editingIndex !== null) {
      onRenameTab(index, editValue);
      setEditingIndex(null);
    }
  };

  const handleDragStart = (e, index) => {
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = 'move';
    // Required for Firefox
    e.dataTransfer.setData('text/plain', index);
  };

  const handleDragOver = (e, index) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (e, index) => {
    e.preventDefault();
    if (draggedIndex !== null && draggedIndex !== index) {
      onMoveTab(draggedIndex, index);
    }
    setDraggedIndex(null);
  };

  return (
    <div className="tab-bar">
      {tabs.map((tab, index) => (
        <div
          key={tab.id}
          className={`tab ${index === activeTabIndex && !showSettings ? 'active' : ''} ${draggedIndex === index ? 'dragging' : ''}`}
          onClick={() => {
            if (showSettings) onToggleSettings();
            onSelectTab(index);
          }}
          onMouseDown={(e) => { if (e.button === 1) e.preventDefault(); }}
          onAuxClick={(e) => {
            if (e.button !== 1) return;
            e.preventDefault();
            onMiddleClickTab?.(index);
          }}
          onDoubleClick={() => handleDoubleClick(index, tab.title)}
          draggable={editingIndex === null}
          onDragStart={(e) => handleDragStart(e, index)}
          onDragOver={(e) => handleDragOver(e, index)}
          onDrop={(e) => handleDrop(e, index)}
        >
          {editingIndex === index ? (
            <input
              ref={inputRef}
              className="tab-rename-input"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onKeyDown={(e) => handleKeyDown(e, index)}
              onBlur={() => handleBlur(index)}
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <span className="tab-label">{tab.title}</span>
          )}
          <button
            className="tab-close-btn"
            onClick={(e) => {
              e.stopPropagation();
              onCloseTab(index);
            }}
            disabled={tabs.length <= 1}
            title="Close tab (Cmd+W)"
          >
            ×
          </button>
        </div>
      ))}
      <button
        className="tab-add-btn"
        onClick={onNewTab}
        title="New tab (Cmd+T)"
      >
        +
      </button>
      <button
        className={`tab-add-btn tab-settings-btn ${showSettings ? 'active' : ''}`}
        onClick={onToggleSettings}
        title="Settings"
        aria-label="Settings"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </button>
    </div>
  );
}
