import React, { useRef, useEffect, useState, useCallback } from 'react';
import { PanelGroup, Panel, PanelResizeHandle } from 'react-resizable-panels';
import TerminalPane from './TerminalPane';
import PaneContextMenu from './PaneContextMenu';
import { getOrCreateSession } from '../utils/terminalSessions';
import { canRegroupByColumn } from '../utils/layoutTree';

const { ipcRenderer } = window.electron;

// split node id -> PanelGroup ref, so a pane header can resize any ancestor split
const groupRegistry = new Map();
const MIN_SIZE = 15;
const HEADER_INTERACTIVE = 'button, input, textarea, select, a, .status-folder, .status-git, .run-btn';

// Drag a pane's top edge: resizes the nearest ancestor stacked split that has this pane below it.
// If that split's divider is shared with a neighbouring column, regroup by column first so only this column moves.
function startHeaderResize(e, ancestors, onRegroupByColumn) {
  const k = ancestors.map(a => a.direction === 'horizontal' && a.index === 1).lastIndexOf(true);
  if (k < 0) return;
  const split = ancestors[k];
  e.preventDefault();
  e.stopPropagation();

  let targetId = split.id;
  let staleRef = null;
  if (canRegroupByColumn(split.node) && ancestors[k + 1]?.id === split.node.children[1].id) {
    // The pane's column becomes the left or right stack of the regrouped tree
    targetId = ancestors[k + 1].index === 0 ? split.id : split.id + '-r';
    staleRef = groupRegistry.get(targetId) || null;
    onRegroupByColumn(split.id);
  }

  const startY = e.clientY;
  const prevCursor = document.body.style.cursor;
  document.body.style.cursor = 'row-resize';
  let released = false;
  let move = null;

  const onMove = (ev) => move?.(ev.clientY);
  const onUp = () => {
    released = true;
    document.body.style.cursor = prevCursor;
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
  };
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);

  // After a regroup the new group mounts on a later render, so wait for it
  const attach = () => {
    if (released) return;
    const ref = groupRegistry.get(targetId);
    const group = ref && ref !== staleRef && ref.current;
    const el = group && document.querySelector(`[data-panel-group-id="${group.getId()}"]`);
    if (!el) { requestAnimationFrame(attach); return; }
    const [startTop] = group.getLayout();
    const height = el.getBoundingClientRect().height;
    move = (y) => {
      const top = Math.min(100 - MIN_SIZE, Math.max(MIN_SIZE, startTop + ((y - startY) / height) * 100));
      group.setLayout([top, 100 - top]);
    };
  };
  attach();
}

function LayoutNode({ node, activeId, onSetActive, onSplit, onClose, onLayoutChange, onRegroupByColumn, paneCount, settings, ancestors = [] }) {
  // Elements that provide their own right-click behaviour (or a native text menu)
  const hasOwnContextMenu = (target) =>
    !!target.closest('.status-folder, .status-git, .run-btn, input, textarea:not(.xterm-helper-textarea)');

  const [menu, setMenu] = useState(null); // { x, y, hasSelection }
  const dismissMenu = useCallback(() => setMenu(null), []);

  const handleContextMenu = (e) => {
    e.preventDefault();
    onSetActive(node.id);
    const hasSelection = node.type === 'pane'
      && !!getOrCreateSession(node.sessionId, node.initialCwd).term.getSelection();
    setMenu({ x: e.clientX, y: e.clientY, hasSelection });
  };

  const handleMenuAction = async (action) => {
    setMenu(null);
    const term = getOrCreateSession(node.sessionId, node.initialCwd).term;
    if (action === 'copy') {
      const text = term.getSelection();
      if (text) ipcRenderer.invoke('app.writeClipboard', { text });
    } else if (action === 'paste') {
      const text = await ipcRenderer.invoke('app.readClipboard');
      if (text) term.paste(text);
    } else if (action === 'select-all') {
      term.selectAll();
    } else if (action === 'split-right') {
      onSplit(node.id, 'vertical');
    } else if (action === 'split-down') {
      onSplit(node.id, 'horizontal');
    } else if (action === 'close') {
      onClose(node.id);
    }
  };

  if (node.type === 'pane') {
    const canResizeFromHeader = ancestors.some(a => a.direction === 'horizontal' && a.index === 1);
    return (
      <div
        className={`pane-wrapper${canResizeFromHeader ? ' pane-wrapper--header-resize' : ''}`}
        // Capture phase so xterm never sees the press; buttons and inputs in the header keep working
        onMouseDownCapture={(e) => {
          if (!canResizeFromHeader || e.button !== 0) return;
          if (!e.target.closest('.terminal-status-bar') || e.target.closest(HEADER_INTERACTIVE)) return;
          startHeaderResize(e, ancestors, onRegroupByColumn);
        }}
        onClick={() => onSetActive(node.id)}
        // Capture phase: xterm or a child may swallow the bubbling event (e.g. when a TUI app has mouse tracking on)
        onContextMenuCapture={(e) => {
          if (hasOwnContextMenu(e.target)) return;
          e.stopPropagation();
          handleContextMenu(e);
        }}
      >
        <TerminalPane
          key={`terminal-${node.sessionId}`}
          sessionId={node.sessionId}
          cwd={node.initialCwd}
          initialLastCommand={node.initialLastCommand}
          isActive={activeId === node.id}
          onSetActive={() => onSetActive(node.id)}
          settings={settings}
        />
        {menu && (
          <PaneContextMenu
            x={menu.x}
            y={menu.y}
            hasSelection={menu.hasSelection}
            canClose={paneCount > 1}
            onAction={handleMenuAction}
            onDismiss={dismissMenu}
          />
        )}
      </div>
    );
  }

  if (node.type === 'split') {
    return (
      <SplitPane
        node={node}
        activeId={activeId}
        onSetActive={onSetActive}
        onSplit={onSplit}
        onClose={onClose}
        onLayoutChange={onLayoutChange}
        onRegroupByColumn={onRegroupByColumn}
        paneCount={paneCount}
        settings={settings}
        ancestors={ancestors}
      />
    );
  }

  return null;
}

function SplitPane({ node, activeId, onSetActive, onSplit, onClose, onLayoutChange, onRegroupByColumn, paneCount, settings, ancestors }) {
  const panelDirection = node.direction === 'vertical' ? 'horizontal' : 'vertical';
  const leftSize = node.sizes ? node.sizes[0] : 50;
  const rightSize = node.sizes ? node.sizes[1] : 50;

  const groupRef = useRef(null);
  useEffect(() => {
    groupRegistry.set(node.id, groupRef);
    return () => { groupRegistry.delete(node.id); };
  }, [node.id]);
  // Track what the panel last reported so we don't fight user drags
  const lastReported = useRef([leftSize, rightSize]);

  useEffect(() => {
    if (!groupRef.current) return;
    const [l, r] = lastReported.current;
    // Only push sizes if they differ from what the panel reported (i.e. a programmatic change)
    if (Math.abs(l - leftSize) > 0.5 || Math.abs(r - rightSize) > 0.5) {
      groupRef.current.setLayout([leftSize, rightSize]);
    }
  }, [leftSize, rightSize]);

  return (
    <PanelGroup
      ref={groupRef}
      direction={panelDirection}
      onLayout={(sizes) => {
        lastReported.current = sizes;
        onLayoutChange(node.id, sizes);
      }}
      style={{ height: '100%', width: '100%' }}
    >
      <Panel defaultSize={leftSize} minSize={15}>
        <LayoutNode
          key={node.children[0].id}
          node={node.children[0]}
          activeId={activeId}
          onSetActive={onSetActive}
          onSplit={onSplit}
          onClose={onClose}
          onLayoutChange={onLayoutChange}
          onRegroupByColumn={onRegroupByColumn}
          paneCount={paneCount}
          settings={settings}
          ancestors={[...ancestors, { id: node.id, direction: node.direction, index: 0, node }]}
        />
      </Panel>
      <PanelResizeHandle className="resize-handle" />
      <Panel defaultSize={rightSize} minSize={15}>
        <LayoutNode
          key={node.children[1].id}
          node={node.children[1]}
          activeId={activeId}
          onSetActive={onSetActive}
          onSplit={onSplit}
          onClose={onClose}
          onLayoutChange={onLayoutChange}
          onRegroupByColumn={onRegroupByColumn}
          paneCount={paneCount}
          settings={settings}
          ancestors={[...ancestors, { id: node.id, direction: node.direction, index: 1, node }]}
        />
      </Panel>
    </PanelGroup>
  );
}

export default LayoutNode;
