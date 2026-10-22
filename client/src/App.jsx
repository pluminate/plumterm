import React, { useState, useEffect, useCallback } from 'react';
import LayoutNode from './components/LayoutNode';
import TabBar from './components/TabBar';
import Settings from './components/Settings';
import { splitNode, closeNode, countPanes, findFirstPaneId, generateSessionId, getAllPaneIds, redistributeSizes, regroupByColumn } from './utils/layoutTree';
import { getOrCreateSession, getSession, destroySession, getSessionCwd, getLastCommand, scheduleRerun } from './utils/terminalSessions';
import './App.css';

const ipcRenderer = window.electron?.ipcRenderer;

export default function App() {
  const [tabs, setTabs] = useState(() => {
    try {
      const initialCwd = ipcRenderer.sendSync('app.getInitialCwdSync');
      const currentSettings = ipcRenderer.sendSync('settings.get');
      const savedSession = (currentSettings?.restoreSession ?? true) ? ipcRenderer.sendSync('app.getSessionSync') : null;

      if (savedSession?.length > 0) {
        const remapLayout = (node) => {
          if (node.type === 'pane') {
            const newId = generateSessionId();
            return { type: 'pane', id: newId, sessionId: newId, initialCwd: node.savedCwd || null, initialLastCommand: node.savedLastCommand || null };
          }
          return { ...node, id: 'split-' + crypto.randomUUID(), children: node.children.map(remapLayout) };
        };
        return savedSession.map((saved, idx) => {
          const layout = remapLayout(saved.layout);
          const firstPaneId = findFirstPaneId(layout);
          return {
            id: `tab-${generateSessionId()}`,
            title: saved.title || `Tab ${idx + 1}`,
            layout,
            activeId: firstPaneId
          };
        });
      }

      const paneId = generateSessionId();
      const validCwd = (typeof initialCwd === 'string' && initialCwd.trim()) ? initialCwd : null;
      return [{
        id: `tab-${paneId}`,
        title: validCwd ? validCwd.split(/[\\/]/).pop() : 'Tab 1',
        layout: { type: 'pane', id: paneId, sessionId: paneId, initialCwd: validCwd },
        activeId: paneId
      }];
    } catch (e) {
      console.error('[App] Sync init failed:', e);
      const paneId = generateSessionId();
      return [{
        id: `tab-${paneId}`,
        title: 'Tab 1',
        layout: { type: 'pane', id: paneId, sessionId: paneId },
        activeId: paneId
      }];
    }
  });
  const [activeTabIndex, setActiveTabIndex] = useState(0);
  const [showSettings, setShowSettings] = useState(false);
  const [settings, setSettings] = useState(() => ipcRenderer.sendSync('settings.get'));

  useEffect(() => {
    const unsub = ipcRenderer.on('settings.updated', (event, newSettings) => {
      setSettings(newSettings);
    });
    return unsub;
  }, []);

  const activeTabIndexSafe = Math.min(Math.max(0, activeTabIndex), Math.max(0, tabs.length - 1));
  const activeTab = tabs[activeTabIndexSafe] || tabs[0];
  const paneCount = activeTab ? countPanes(activeTab.layout) : 0;

  const updateActiveTab = useCallback((updater) => {
    setTabs(tabs => tabs.map((tab, idx) => idx === activeTabIndexSafe ? updater(tab) : tab));
  }, [activeTabIndexSafe]);

  const handleRenameTab = useCallback((index, newTitle) => {
    setTabs(tabs => tabs.map((tab, idx) => idx === index ? { ...tab, title: newTitle } : tab));
  }, []);

  const handleMoveTab = useCallback((dragIndex, hoverIndex) => {
    setTabs(prevTabs => {
      const newTabs = [...prevTabs];
      const draggedTab = newTabs[dragIndex];
      newTabs.splice(dragIndex, 1);
      newTabs.splice(hoverIndex, 0, draggedTab);
      
      // Update active tab index if it was moved
      if (activeTabIndex === dragIndex) {
        setActiveTabIndex(hoverIndex);
      } else if (activeTabIndex > dragIndex && activeTabIndex <= hoverIndex) {
        setActiveTabIndex(prev => prev - 1);
      } else if (activeTabIndex < dragIndex && activeTabIndex >= hoverIndex) {
        setActiveTabIndex(prev => prev + 1);
      }
      
      return newTabs;
    });
  }, [activeTabIndex]);

  const handleLayoutChange = useCallback((splitId, sizes) => {
    updateActiveTab((tab) => {
      const updateLayoutSizes = (node) => {
        if (node.id === splitId) {
          return { ...node, sizes };
        }
        if (node.type === 'split') {
          return {
            ...node,
            children: [
              updateLayoutSizes(node.children[0]),
              updateLayoutSizes(node.children[1])
            ]
          };
        }
        return node;
      };
      return { ...tab, layout: updateLayoutSizes(tab.layout) };
    });
  }, [updateActiveTab]);

  const handleRegroupByColumn = useCallback((splitId) => {
    updateActiveTab((tab) => ({ ...tab, layout: regroupByColumn(tab.layout, splitId) }));
  }, [updateActiveTab]);

  const handleSplit = useCallback((targetId, direction) => {
    (async () => {
      await ipcRenderer?.invoke('app.forceCwdUpdate', { sessionId: targetId });
      updateActiveTab((tab) => {
        const originCwd = getSessionCwd(targetId);
        const { newNode, newPaneId } = splitNode(tab.layout, targetId, direction, originCwd);
        return {
          ...tab,
          layout: newNode,
          activeId: newPaneId || tab.activeId
        };
      });
    })();
  }, [updateActiveTab]);

  const handleCloseTab = useCallback((tabIndex) => {
    setTabs(tabs => {
      if (tabs.length <= 1) return tabs;
      
      // Destroy sessions in the tab being removed
      const tabToRemove = tabs[tabIndex];
      const paneIds = getAllPaneIds(tabToRemove.layout);
      paneIds.forEach(id => destroySession(id));

      const newTabs = tabs.filter((_, idx) => idx !== tabIndex);
      setActiveTabIndex(idx => idx >= newTabs.length ? newTabs.length - 1 : idx);
      return newTabs;
    });
  }, []);

  // Middle-click closes a tab only if it is a single pane with nothing running in it
  const handleMiddleClickTab = useCallback(async (tabIndex) => {
    const tab = tabs[tabIndex];
    if (!tab || tabs.length <= 1 || countPanes(tab.layout) !== 1) return;
    const sessionId = getAllPaneIds(tab.layout)[0];
    try {
      if (await window.electron.ipcRenderer.invoke('terminal.hasForegroundJob', { sessionId })) return;
    } catch (e) { return; }
    handleCloseTab(tabIndex);
  }, [tabs, handleCloseTab]);

  const handleClose = useCallback((targetId) => {
    setTabs(tabs => {
      const tab = tabs[activeTabIndexSafe];
      if (!tab) return tabs;
      const paneCount = countPanes(tab.layout);

      if (paneCount > 1) {
        // Close the pane
        const newLayout = closeNode(tab.layout, targetId);
        destroySession(targetId);
        
        return tabs.map((t, idx) =>
          idx === activeTabIndexSafe
            ? {
                ...t,
                layout: newLayout,
                activeId: t.activeId === targetId ? findFirstPaneId(newLayout) : t.activeId
              }
            : t
        );
      } else if (tabs.length > 1) {
        // Close the entire tab
        const tabToRemove = tabs[activeTabIndexSafe];
        if (!tabToRemove) return tabs;
        const paneIds = getAllPaneIds(tabToRemove.layout);
        paneIds.forEach(id => destroySession(id));

        const newTabs = tabs.filter((_, idx) => idx !== activeTabIndexSafe);
        setActiveTabIndex(idx => idx >= newTabs.length ? newTabs.length - 1 : idx);
        return newTabs;
      }
      return tabs;
    });
  }, [activeTabIndexSafe]);

  const handleNewTab = useCallback(() => {
    setTabs(prevTabs => {
      const paneId = generateSessionId();
      const newTab = {
        id: `tab-${paneId}`,
        title: `Tab ${prevTabs.length + 1}`,
        layout: { type: 'pane', id: paneId, sessionId: paneId },
        activeId: paneId
      };
      const newTabs = [...prevTabs, newTab];
      setActiveTabIndex(newTabs.length - 1);
      return newTabs;
    });
  }, []);

  const handleSelectTab = useCallback((tabIndex) => {
    setActiveTabIndex(tabIndex);
    const tab = tabs[tabIndex];
    if (tab?.activeId) {
      ipcRenderer?.invoke('app.forceCwdUpdate', { sessionId: tab.activeId });
    }
  }, [tabs]);

  const handleSetActivePane = useCallback((tabIndex, paneId) => {
    setTabs(tabs => tabs.map((t, idx) => idx === tabIndex ? { ...t, activeId: paneId } : t));
    ipcRenderer?.invoke('app.forceCwdUpdate', { sessionId: paneId });
  }, []);

  const handleRerunLastCommand = useCallback(() => {
    if (!activeTab?.activeId) return;
    scheduleRerun(activeTab.activeId);
  }, [activeTab?.activeId]);

  const noOpHandler = useCallback(() => {}, []);

  const buildSessionData = useCallback(() => {
    const cwds = ipcRenderer?.sendSync('app.getCwdsSync') || {};
    const enrichLayout = (node) => {
      if (node.type === 'pane') return { ...node, savedCwd: cwds[node.sessionId] || getSessionCwd(node.sessionId) || null, savedLastCommand: getLastCommand(node.sessionId) || null };
      return { ...node, children: node.children.map(enrichLayout) };
    };
    return tabs.map(tab => ({
      title: tab.title,
      activeId: tab.activeId,
      layout: enrichLayout(tab.layout)
    }));
  }, [tabs]);

  // Autosave on tab changes (debounced 1s)
  useEffect(() => {
    const currentSettings = ipcRenderer.sendSync('settings.get');
    if (!(currentSettings?.restoreSession ?? true)) return;
    const timer = setTimeout(() => {
      ipcRenderer.send('app.saveSession', buildSessionData());
    }, 1000);
    return () => clearTimeout(timer);
  }, [tabs]);

  // Autosave every 30s to capture CWD changes from cd
  useEffect(() => {
    const interval = setInterval(() => {
      const currentSettings = ipcRenderer.sendSync('settings.get');
      if (currentSettings?.restoreSession ?? true) {
        ipcRenderer.send('app.saveSession', buildSessionData());
      }
    }, 30000);
    return () => clearInterval(interval);
  }, [buildSessionData]);

  // Save session when main requests it (clean quit flow)
  useEffect(() => {
    const unsub = ipcRenderer.on('app.captureSession', () => {
      ipcRenderer.send('app.sessionData', buildSessionData());
    });
    return unsub;
  }, [buildSessionData]);

  // Save when a command is tracked — debounced so rapid Enter presses don't flood disk writes
  useEffect(() => {
    let timer = null;
    const handler = () => {
      clearTimeout(timer);
      timer = setTimeout(() => ipcRenderer.send('app.saveSession', buildSessionData()), 5000);
    };
    window.addEventListener('session:commandTracked', handler);
    return () => {
      window.removeEventListener('session:commandTracked', handler);
      clearTimeout(timer);
    };
  }, [buildSessionData]);

  // Handle context menu actions
  useEffect(() => {
    const unsubscribe = ipcRenderer.on('context-menu.action', (event, { action, text, sessionId }) => {
      if (action === 'paste') {
        if (sessionId && text) getOrCreateSession(sessionId).term.paste(text);
        return;
      }
      if (action === 'select-all') {
        if (sessionId) getSession(sessionId)?.term.selectAll();
        return;
      }
      if (!activeTab) return;
      if (action === 'split-right') handleSplit(activeTab.activeId, 'vertical');
      else if (action === 'split-down') handleSplit(activeTab.activeId, 'horizontal');
      else if (action === 'close') handleClose(activeTab.activeId);
    });

    const unsubscribeSettings = ipcRenderer.on('menu.settings', () => {
      setShowSettings(prev => !prev);
    });

    // Select All: text fields keep their normal behaviour, otherwise select the active terminal's buffer
    const unsubscribeSelectAll = ipcRenderer.on('menu.selectAll', () => {
      const el = document.activeElement;
      const isTextField = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') && !el.classList.contains('xterm-helper-textarea');
      if (isTextField) {
        el.select();
        return;
      }
      getSession(activeTab?.activeId)?.term.selectAll();
    });

    return () => {
      unsubscribe();
      unsubscribeSettings();
      unsubscribeSelectAll();
    };
  }, [activeTab?.activeId, activeTabIndexSafe, handleSplit, handleClose]);

  // Keyboard shortcuts
  useEffect(() => {
    const isMatch = (e, hotkey) => {
      if (!hotkey) return false;
      const parts = hotkey.split('+');
      const targetKey = parts.pop().toUpperCase();
      
      const cmdOrCtrl = parts.includes('CommandOrControl') || parts.includes('CmdOrCtrl');
      const meta = parts.includes('Command') || parts.includes('Meta') || (cmdOrCtrl && window.navigator.platform.includes('Mac'));
      const ctrl = parts.includes('Control') || (cmdOrCtrl && !window.navigator.platform.includes('Mac'));
      const shift = parts.includes('Shift');
      const alt = parts.includes('Alt');

      // Use e.code as fallback for physical keys (e.g. KeyC) if e.key is a modified char (e.g. ç)
      const currentKey = e.key === ' ' ? 'SPACE' : e.key.toUpperCase();
      const currentCode = e.code.replace('Key', '').toUpperCase();

      const keyMatch = (currentKey === targetKey) || (currentCode === targetKey);

      return (
        keyMatch &&
        e.metaKey === meta &&
        e.ctrlKey === ctrl &&
        e.shiftKey === shift &&
        e.altKey === alt
      );
    };

    const handler = (e) => {
      // Handle Escape to dismiss settings - Move to top for priority
      if (e.key === 'Escape' && e.type === 'keydown') {
        const isRecording = document.body.hasAttribute('data-recording');
        if (showSettings && !isRecording) {
          e.preventDefault();
          setShowSettings(false);
          return;
        }
      }

      // Handle Ctrl+Tab and Ctrl+Shift+Tab
      if (e.ctrlKey && e.key === 'Tab' && e.type === 'keydown') {
        e.preventDefault();
        setActiveTabIndex(prev => {
          if (e.shiftKey) return (prev - 1 + tabs.length) % tabs.length;
          return (prev + 1) % tabs.length;
        });
        return;
      }

      // Handle Rerun Last Command
      if (isMatch(e, settings.rerunShortcut || 'CommandOrControl+R') && e.type === 'keydown') {
        e.preventDefault();
        handleRerunLastCommand();
        return;
      }

      // Handle GitHub Desktop Shortcut
      if (isMatch(e, settings.ghDesktopShortcut) && e.type === 'keydown') {
        const cwd = getSessionCwd(activeTab.activeId);
        if (cwd) {
          e.preventDefault();
          ipcRenderer.invoke('app.openGitHubDesktop', { path: cwd });
        }
        return;
      }

      // Handle VS Code Shortcut
      if (isMatch(e, settings.vscodeShortcut) && e.type === 'keydown') {
        const cwd = getSessionCwd(activeTab.activeId);
        if (cwd) {
          e.preventDefault();
          ipcRenderer.invoke('app.openInVSCode', { path: cwd });
        }
        return;
      }

      // Handle Finder Shortcut
      if (isMatch(e, settings.finderShortcut) && e.type === 'keydown') {
        const cwd = getSessionCwd(activeTab.activeId);
        if (cwd) {
          e.preventDefault();
          ipcRenderer.invoke('app.openInFinder', { path: cwd });
        }
        return;
      }

      // Handle Commit Modal Shortcut
      if (isMatch(e, settings.commitShortcut) && e.type === 'keydown') {
        if (activeTab?.activeId) {
          e.preventDefault();
          window.dispatchEvent(new CustomEvent(`session:openCommit:${activeTab.activeId}`));
        }
        return;
      }

      // Handle Run Shortcut
      if (isMatch(e, settings.runShortcut || 'CommandOrControl+S') && e.type === 'keydown') {
        if (activeTab?.activeId) {
          e.preventDefault();
          window.dispatchEvent(new CustomEvent(`session:runCommand:${activeTab.activeId}`));
        }
        return;
      }

      if (!e.metaKey && !e.ctrlKey) return;

      // Handle Cmd+,
      if (e.key === ',' && e.type === 'keydown') {
        e.preventDefault();
        setShowSettings(prev => !prev);
        return;
      }

      // Handle Cmd+`
      if (e.key === '`' && e.type === 'keydown') {
        e.preventDefault();
        setActiveTabIndex(prev => (prev + 1) % tabs.length);
        return;
      }

      if (e.key === 't' && e.type === 'keydown') {
        e.preventDefault();
        handleNewTab();
      }
      if (!activeTab) return;
      if (e.key.toLowerCase() === 'r' && e.shiftKey && e.type === 'keydown') {
        e.preventDefault();
        handleSplit(activeTab.activeId, 'vertical');
      }
      if (e.key.toLowerCase() === 'd' && e.shiftKey && e.type === 'keydown') {
        e.preventDefault();
        handleSplit(activeTab.activeId, 'horizontal');
      }
      if (e.key === 'w' && e.type === 'keydown') {
        e.preventDefault();
        if (tabs.length <= 1 && paneCount <= 1) {
          // Last split of last tab: close the window (main ignores it if it's the last window)
          ipcRenderer?.send('window.closeIfNotLast');
        } else {
          handleClose(activeTab.activeId);
        }
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [activeTab?.activeId, activeTabIndexSafe, tabs.length, paneCount, handleNewTab, handleSplit, handleClose, showSettings, settings]);

  return (
    <div className="app-container">
      <TabBar
        tabs={tabs}
        activeTabIndex={activeTabIndex}
        onSelectTab={handleSelectTab}
        onCloseTab={handleCloseTab}
        onMiddleClickTab={handleMiddleClickTab}
        onNewTab={handleNewTab}
        onRenameTab={handleRenameTab}
        onMoveTab={handleMoveTab}
        onToggleSettings={() => setShowSettings(!showSettings)}
        showSettings={showSettings}
      />
      <main className="app-main">
        {showSettings ? (
          <Settings onClose={() => setShowSettings(false)} />
        ) : (
          activeTab ? (
            <LayoutNode
              key={`tab-${activeTab.id}`}
              node={activeTab.layout}
              activeId={activeTab.activeId}
              onSetActive={(id) => handleSetActivePane(activeTabIndex, id)}
              onSplit={handleSplit}
              onClose={handleClose}
              onLayoutChange={handleLayoutChange}
              onRegroupByColumn={handleRegroupByColumn}
              paneCount={countPanes(activeTab.layout)}
              settings={settings}
            />
          ) : null
        )}
      </main>
    </div>
  );
}
