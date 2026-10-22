import React, { useState, useEffect, useRef } from 'react';

const { ipcRenderer } = window.electron;

const IconGeneral = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);

const IconGemini = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
  </svg>
);

const IconKeyboard = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="4" width="20" height="16" rx="2" ry="2" />
    <path d="M6 8h.01M10 8h.01M14 8h.01M18 8h.01M6 12h.01M10 12h.01M14 12h.01M18 12h.01M6 16h.01M10 16h.01M14 16h.01M18 16h.01" />
  </svg>
);

const IconBell = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
    <path d="M13.73 21a2 2 0 0 1-3.46 0" />
  </svg>
);

const IconRefresh = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M23 4v6h-6M1 20v-6h6" />
    <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
  </svg>
);

const IconPlay = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="5 3 19 12 5 21 5 3" />
  </svg>
);

const IconPower = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18.36 6.64a9 9 0 1 1-12.73 0" />
    <line x1="12" y1="2" x2="12" y2="12" />
  </svg>
);

const IconHistory = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <polyline points="12 6 12 12 16 14" />
  </svg>
);

const IconVSCode = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M7.05 21.45l9.9-18.9 4.05 3.15-9.9 18.9-4.05-3.15z" />
    <path d="M16.95 2.55L7.05 21.45l-4.05-3.15 9.9-18.9 4.05 3.15z" />
  </svg>
);

const IconGithubDesktop = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22" />
  </svg>
);

const IconCommit = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3" />
    <line x1="12" y1="2" x2="12" y2="9" />
    <line x1="12" y1="15" x2="12" y2="22" />
  </svg>
);

const IconCode = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="16 18 22 12 16 6" />
    <polyline points="8 6 2 12 8 18" />
  </svg>
);

const IconIntelliJ = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="3" />
    <path d="M7 7h3v10H7z" />
    <path d="M12 14h5" />
  </svg>
);

const IconFinder = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
  </svg>
);

const IconSystem = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
    <line x1="8" y1="21" x2="16" y2="21" />
    <line x1="12" y1="17" x2="12" y2="21" />
  </svg>
);

const CATEGORIES = [
  { id: 'general', label: 'General', title: 'General Settings', description: 'Configure application startup and window behavior.', icon: IconGeneral },
  { id: 'ai', label: 'AI', title: 'AI Configuration', description: 'Configure Gemini API token and AI features.', icon: IconGemini },
  { id: 'shortcuts', label: 'Shortcuts', title: 'Keyboard Shortcuts', description: 'Customize global and command shortcuts.', icon: IconKeyboard },
  { id: 'git', label: 'Git', title: 'Git Integration', description: 'Configure version control and repository shortcuts.', icon: IconCommit },
  { id: 'editors', label: 'Editor Integrations', title: 'Editor Integrations', description: 'Shortcuts to open projects in external code editors.', icon: IconCode },
  { id: 'system', label: 'System', title: 'System & Notifications', description: 'Manage system utilities and command completion alerts.', icon: IconSystem }
];

export default function Settings({ onClose }) {
  const [activeCategory, setActiveCategory] = useState('general');
  const [appVersion, setAppVersion] = useState('');

  useEffect(() => {
    ipcRenderer.invoke('app.getVersion').then(setAppVersion).catch(() => {});
  }, []);
  const [settings, setSettings] = useState({
    globalHotkey: '',
    rerunShortcut: 'CommandOrControl+R',
    confirmOnQuit: false,
    excludeDangerousRerun: true,
    notifyOnCommandEnd: true,
    notificationThreshold: 120,
    geminiToken: '',
    ghDesktopShortcut: '',
    vscodeShortcut: '',
    intellijShortcut: '',
    finderShortcut: '',
    commitShortcut: '',
    runShortcut: 'CommandOrControl+S'
  });
  const [recordingTarget, setRecordingTarget] = useState(null); // 'global', 'rerun', 'ghdesktop', 'vscode', 'intellij', 'finder', 'commit', 'run'
  const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;

  const globalRecorderRef = useRef(null);
  const rerunRecorderRef = useRef(null);
  const ghRecorderRef = useRef(null);
  const vscodeRecorderRef = useRef(null);
  const intellijRecorderRef = useRef(null);
  const finderRecorderRef = useRef(null);
  const commitRecorderRef = useRef(null);
  const runRecorderRef = useRef(null);

  useEffect(() => {
    if (recordingTarget === 'global') globalRecorderRef.current?.focus();
    if (recordingTarget === 'rerun') rerunRecorderRef.current?.focus();
    if (recordingTarget === 'ghdesktop') ghRecorderRef.current?.focus();
    if (recordingTarget === 'vscode') vscodeRecorderRef.current?.focus();
    if (recordingTarget === 'intellij') intellijRecorderRef.current?.focus();
    if (recordingTarget === 'finder') finderRecorderRef.current?.focus();
    if (recordingTarget === 'commit') commitRecorderRef.current?.focus();
    if (recordingTarget === 'run') runRecorderRef.current?.focus();

    if (recordingTarget) {
      document.body.setAttribute('data-recording', 'true');
    } else {
      document.body.removeAttribute('data-recording');
    }
  }, [recordingTarget]);

  useEffect(() => {
    return () => {
      document.body.removeAttribute('data-recording');
    };
  }, []);

  useEffect(() => {
    try {
      const currentSettings = ipcRenderer.sendSync('settings.get');
      if (currentSettings) {
        setSettings(prev => ({ ...prev, ...currentSettings }));
      }
    } catch (err) {
      console.error('Failed to load settings:', err);
    }
  }, []);

  const saveSettings = (newSettings) => {
    setSettings(newSettings);
    ipcRenderer.send('settings.set', newSettings);
  };

  const toggleConfirmOnQuit = () => {
    saveSettings({ ...settings, confirmOnQuit: !settings.confirmOnQuit });
  };

  const toggleNotifyOnCommandEnd = () => {
    saveSettings({ ...settings, notifyOnCommandEnd: !settings.notifyOnCommandEnd });
  };

  const toggleRestoreSession = () => {
    saveSettings({ ...settings, restoreSession: !settings.restoreSession });
  };

  const handleKeyDown = (e) => {
    if (!recordingTarget) return;
    e.preventDefault();
    e.stopPropagation();

    if (e.key === 'Escape') {
      setRecordingTarget(null);
      return;
    }

    const keys = [];
    if (e.metaKey) keys.push('Command');
    if (e.ctrlKey) keys.push('Control');
    if (e.shiftKey) keys.push('Shift');
    if (e.altKey) keys.push('Alt');

    const key = e.key.toUpperCase();
    if (['CONTROL', 'SHIFT', 'ALT', 'META', 'COMMAND'].includes(key)) {
      // Just a modifier pressed so far
    } else {
      // Normal key pressed
      const keyName = key === ' ' ? 'SPACE' : key;
      keys.push(keyName);
      const hotkey = keys.join('+');
      
      if (recordingTarget === 'global') {
        saveSettings({ ...settings, globalHotkey: hotkey });
      } else if (recordingTarget === 'rerun') {
        saveSettings({ ...settings, rerunShortcut: hotkey });
      } else if (recordingTarget === 'ghdesktop') {
        saveSettings({ ...settings, ghDesktopShortcut: hotkey });
      } else if (recordingTarget === 'vscode') {
        saveSettings({ ...settings, vscodeShortcut: hotkey });
      } else if (recordingTarget === 'intellij') {
        saveSettings({ ...settings, intellijShortcut: hotkey });
      } else if (recordingTarget === 'finder') {
        saveSettings({ ...settings, finderShortcut: hotkey });
      } else if (recordingTarget === 'commit') {
        saveSettings({ ...settings, commitShortcut: hotkey });
      } else if (recordingTarget === 'run') {
        saveSettings({ ...settings, runShortcut: hotkey });
      }
      setRecordingTarget(null);
    }
  };

  const currentCategoryMeta = CATEGORIES.find(c => c.id === activeCategory) || CATEGORIES[0];

  return (
    <div className="settings-page">
      <div className="settings-container">
        <div className="settings-header">
          <div className="settings-title-area">
            <h2>Settings</h2>
            <p className="settings-subtitle">Preferences & Configuration</p>
          </div>
          <button className="settings-close" onClick={onClose} title="Close Settings">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="settings-body">
          <aside className="settings-sidebar">
            <nav className="settings-sidebar-nav">
              {CATEGORIES.map((category) => {
                const IconComponent = category.icon;
                const isActive = activeCategory === category.id;
                return (
                  <button
                    key={category.id}
                    className={`settings-nav-item ${isActive ? 'active' : ''}`}
                    onClick={() => {
                      setRecordingTarget(null);
                      setActiveCategory(category.id);
                    }}
                    type="button"
                  >
                    <span className="settings-nav-icon">
                      <IconComponent />
                    </span>
                    <span className="settings-nav-label">{category.label}</span>
                  </button>
                );
              })}
            </nav>
          </aside>

          <main className="settings-content-pane">
            <div className="settings-pane-header">
              <h3>{currentCategoryMeta.title}</h3>
              <p>{currentCategoryMeta.description}</p>
            </div>

            {activeCategory === 'general' && (
              <div className="settings-category-sections">
                <div className="settings-card">
                  <div className="settings-card-header">
                    <IconHistory />
                    <h3>Session</h3>
                  </div>
                  <div className="settings-section">
                    <div className="settings-row">
                      <div className="settings-info">
                        <p className="settings-description">Restore tabs and splits on launch.</p>
                      </div>
                      <div className="settings-toggle">
                        <label className="switch">
                          <input
                            type="checkbox"
                            checked={settings.restoreSession ?? true}
                            onChange={toggleRestoreSession}
                          />
                          <span className="slider round"></span>
                        </label>
                      </div>
                    </div>
                  </div>
                </div>

                {isMac && (
                  <div className="settings-card">
                    <div className="settings-card-header">
                      <IconPower />
                      <h3>Application</h3>
                    </div>
                    <div className="settings-section">
                      <div className="settings-row">
                        <div className="settings-info">
                          <p className="settings-description">Confirm before quitting (Cmd+Q).</p>
                        </div>
                        <div className="settings-toggle">
                          <label className="switch">
                            <input 
                              type="checkbox" 
                              checked={settings.confirmOnQuit} 
                              onChange={toggleConfirmOnQuit} 
                            />
                            <span className="slider round"></span>
                          </label>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {activeCategory === 'ai' && (
              <div className="settings-category-sections">
                <div className="settings-card">
                  <div className="settings-card-header">
                    <IconGemini />
                    <h3>Gemini AI</h3>
                  </div>
                  <div className="settings-section">
                    <p className="settings-description">
                      Enable AI features by providing your API token.{' '}
                      <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer">Get token</a>
                    </p>
                    <div className="token-input-container">
                      <input 
                        type="password" 
                        className="token-input"
                        placeholder="Enter your Gemini token"
                        value={settings.geminiToken || ''}
                        onChange={(e) => saveSettings({ ...settings, geminiToken: e.target.value.trim() })}
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeCategory === 'shortcuts' && (
              <div className="settings-category-sections">
                <div className="settings-card">
                  <div className="settings-card-header">
                    <IconKeyboard />
                    <h3>Global Hotkey</h3>
                  </div>
                  <div className="settings-section">
                    <p className="settings-description">Toggle application window visibility.</p>
                    <div className="hotkey-recorder">
                      <div 
                        className={`hotkey-input ${recordingTarget === 'global' ? 'recording' : ''}`}
                        onClick={() => setRecordingTarget('global')}
                        onKeyDown={handleKeyDown}
                        tabIndex={0}
                        ref={globalRecorderRef}
                      >
                        {recordingTarget === 'global' ? 'Press keys...' : (settings.globalHotkey || 'None')}
                      </div>
                      <div className="hotkey-actions">
                        {recordingTarget === 'global' && (
                          <button className="btn-icon btn-cancel" onClick={(e) => { e.stopPropagation(); setRecordingTarget(null); }} title="Cancel">×</button>
                        )}
                        <button className="btn-icon btn-clear" onClick={(e) => { e.stopPropagation(); saveSettings({ ...settings, globalHotkey: '' }); }} title="Clear">×</button>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="settings-card">
                  <div className="settings-card-header">
                    <IconPlay />
                    <h3>Run Shortcut</h3>
                  </div>
                  <div className="settings-section">
                    <p className="settings-description">Shortcut to trigger the Run button.</p>
                    <div className="hotkey-recorder">
                      <div
                        className={`hotkey-input ${recordingTarget === 'run' ? 'recording' : ''}`}
                        onClick={() => setRecordingTarget('run')}
                        onKeyDown={handleKeyDown}
                        tabIndex={0}
                        ref={runRecorderRef}
                      >
                        {recordingTarget === 'run' ? 'Press keys...' : (settings.runShortcut || 'None')}
                      </div>
                      <div className="hotkey-actions">
                        {recordingTarget === 'run' && (
                          <button className="btn-icon btn-cancel" onClick={(e) => { e.stopPropagation(); setRecordingTarget(null); }} title="Cancel">×</button>
                        )}
                        <button className="btn-icon btn-clear" onClick={(e) => { e.stopPropagation(); saveSettings({ ...settings, runShortcut: 'CommandOrControl+S' }); }} title="Reset">↺</button>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="settings-card">
                  <div className="settings-card-header">
                    <IconRefresh />
                    <h3>Rerun Shortcut</h3>
                  </div>
                  <div className="settings-section">
                    <p className="settings-description">Shortcut to rerun the last command.</p>
                    <div className="hotkey-recorder">
                      <div 
                        className={`hotkey-input ${recordingTarget === 'rerun' ? 'recording' : ''}`}
                        onClick={() => setRecordingTarget('rerun')}
                        onKeyDown={handleKeyDown}
                        tabIndex={0}
                        ref={rerunRecorderRef}
                      >
                        {recordingTarget === 'rerun' ? 'Press keys...' : (settings.rerunShortcut || 'None')}
                      </div>
                      <div className="hotkey-actions">
                        {recordingTarget === 'rerun' && (
                          <button className="btn-icon btn-cancel" onClick={(e) => { e.stopPropagation(); setRecordingTarget(null); }} title="Cancel">×</button>
                        )}
                        <button className="btn-icon btn-clear" onClick={(e) => { e.stopPropagation(); saveSettings({ ...settings, rerunShortcut: 'CommandOrControl+R' }); }} title="Reset">↺</button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeCategory === 'git' && (
              <div className="settings-category-sections">
                <div className="settings-card">
                  <div className="settings-card-header">
                    <IconCommit />
                    <h3>Commit Modal</h3>
                  </div>
                  <div className="settings-section">
                    <p className="settings-description">Open the AI commit dialog.</p>
                    <div className="hotkey-recorder">
                      <div 
                        className={`hotkey-input ${recordingTarget === 'commit' ? 'recording' : ''}`}
                        onClick={() => setRecordingTarget('commit')}
                        onKeyDown={handleKeyDown}
                        tabIndex={0}
                        ref={commitRecorderRef}
                      >
                        {recordingTarget === 'commit' ? 'Press keys...' : (settings.commitShortcut || 'None')}
                      </div>
                      <div className="hotkey-actions">
                        {recordingTarget === 'commit' && (
                          <button className="btn-icon btn-cancel" onClick={(e) => { e.stopPropagation(); setRecordingTarget(null); }} title="Cancel">×</button>
                        )}
                        <button className="btn-icon btn-clear" onClick={(e) => { e.stopPropagation(); saveSettings({ ...settings, commitShortcut: '' }); }} title="Clear">×</button>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="settings-card">
                  <div className="settings-card-header">
                    <IconGithubDesktop />
                    <h3>GitHub Desktop</h3>
                  </div>
                  <div className="settings-section">
                    <p className="settings-description">Open current repo in GitHub Desktop.</p>
                    <div className="hotkey-recorder">
                      <div 
                        className={`hotkey-input ${recordingTarget === 'ghdesktop' ? 'recording' : ''}`}
                        onClick={() => setRecordingTarget('ghdesktop')}
                        onKeyDown={handleKeyDown}
                        tabIndex={0}
                        ref={ghRecorderRef}
                      >
                        {recordingTarget === 'ghdesktop' ? 'Press keys...' : (settings.ghDesktopShortcut || 'None')}
                      </div>
                      <div className="hotkey-actions">
                        {recordingTarget === 'ghdesktop' && (
                          <button className="btn-icon btn-cancel" onClick={(e) => { e.stopPropagation(); setRecordingTarget(null); }} title="Cancel">×</button>
                        )}
                        <button className="btn-icon btn-clear" onClick={(e) => { e.stopPropagation(); saveSettings({ ...settings, ghDesktopShortcut: '' }); }} title="Clear">×</button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeCategory === 'editors' && (
              <div className="settings-category-sections">
                <div className="settings-card">
                  <div className="settings-card-header">
                    <IconVSCode />
                    <h3>VS Code</h3>
                  </div>
                  <div className="settings-section">
                    <p className="settings-description">Open project in Visual Studio Code.</p>
                    <div className="hotkey-recorder">
                      <div 
                        className={`hotkey-input ${recordingTarget === 'vscode' ? 'recording' : ''}`}
                        onClick={() => setRecordingTarget('vscode')}
                        onKeyDown={handleKeyDown}
                        tabIndex={0}
                        ref={vscodeRecorderRef}
                      >
                        {recordingTarget === 'vscode' ? 'Press keys...' : (settings.vscodeShortcut || 'None')}
                      </div>
                      <div className="hotkey-actions">
                        {recordingTarget === 'vscode' && (
                          <button className="btn-icon btn-cancel" onClick={(e) => { e.stopPropagation(); setRecordingTarget(null); }} title="Cancel">×</button>
                        )}
                        <button className="btn-icon btn-clear" onClick={(e) => { e.stopPropagation(); saveSettings({ ...settings, vscodeShortcut: '' }); }} title="Clear">×</button>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="settings-card">
                  <div className="settings-card-header">
                    <IconIntelliJ />
                    <h3>IntelliJ IDEA</h3>
                  </div>
                  <div className="settings-section">
                    <p className="settings-description">Open project in IntelliJ IDEA.</p>
                    <div className="hotkey-recorder">
                      <div
                        className={`hotkey-input ${recordingTarget === 'intellij' ? 'recording' : ''}`}
                        onClick={() => setRecordingTarget('intellij')}
                        onKeyDown={handleKeyDown}
                        tabIndex={0}
                        ref={intellijRecorderRef}
                      >
                        {recordingTarget === 'intellij' ? 'Press keys...' : (settings.intellijShortcut || 'None')}
                      </div>
                      <div className="hotkey-actions">
                        {recordingTarget === 'intellij' && (
                          <button className="btn-icon btn-cancel" onClick={(e) => { e.stopPropagation(); setRecordingTarget(null); }} title="Cancel">×</button>
                        )}
                        <button className="btn-icon btn-clear" onClick={(e) => { e.stopPropagation(); saveSettings({ ...settings, intellijShortcut: '' }); }} title="Clear">×</button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeCategory === 'system' && (
              <div className="settings-category-sections">
                <div className="settings-card">
                  <div className="settings-card-header">
                    <IconBell />
                    <h3>Notifications</h3>
                  </div>
                  <div className="settings-section">
                    <div className="settings-row">
                      <div className="settings-info">
                        <p className="settings-description">Notify when long-running commands finish in background.</p>
                      </div>
                      <div className="settings-toggle">
                        <label className="switch">
                          <input 
                            type="checkbox" 
                            checked={settings.notifyOnCommandEnd} 
                            onChange={toggleNotifyOnCommandEnd} 
                          />
                          <span className="slider round"></span>
                        </label>
                      </div>
                    </div>
                    
                    {settings.notifyOnCommandEnd && (
                      <div className="settings-sub-section">
                        <div className="threshold-control">
                          <span className="label">Threshold: <strong>{settings.notificationThreshold}s</strong></span>
                          <input 
                            type="range" 
                            min="5" 
                            max="600" 
                            step="5"
                            value={settings.notificationThreshold} 
                            onChange={(e) => saveSettings({ ...settings, notificationThreshold: parseInt(e.target.value, 10) })}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                <div className="settings-card">
                  <div className="settings-card-header">
                    <IconFinder />
                    <h3>Finder</h3>
                  </div>
                  <div className="settings-section">
                    <p className="settings-description">Open current directory in Finder.</p>
                    <div className="hotkey-recorder">
                      <div
                        className={`hotkey-input ${recordingTarget === 'finder' ? 'recording' : ''}`}
                        onClick={() => setRecordingTarget('finder')}
                        onKeyDown={handleKeyDown}
                        tabIndex={0}
                        ref={finderRecorderRef}
                      >
                        {recordingTarget === 'finder' ? 'Press keys...' : (settings.finderShortcut || 'None')}
                      </div>
                      <div className="hotkey-actions">
                        {recordingTarget === 'finder' && (
                          <button className="btn-icon btn-cancel" onClick={(e) => { e.stopPropagation(); setRecordingTarget(null); }} title="Cancel">×</button>
                        )}
                        <button className="btn-icon btn-clear" onClick={(e) => { e.stopPropagation(); saveSettings({ ...settings, finderShortcut: '' }); }} title="Clear">×</button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </main>
        </div>

        <div className="settings-footer">
          <span>Preferences</span>
          <span>PlumTerm{appVersion ? ` v${appVersion}` : ''}</span>
        </div>
      </div>
    </div>
  );
}
