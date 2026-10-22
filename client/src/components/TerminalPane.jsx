import React, { useState, useEffect, useRef, memo } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { getOrCreateSession, resizeSession, cancelRerun, getSessionStatus } from '../utils/terminalSessions';
import { enqueueCommand, processQueue } from '../utils/commandQueue';
import CommitDialog from './CommitDialog';
import DiffViewer from './DiffViewer';
import gitIcon from '../assets/git.png';
import vscodeIcon from '../assets/vscode.png';
import '@xterm/xterm/css/xterm.css';

const ipcRenderer = window.electron?.ipcRenderer;

const formatShortcut = (hotkey) => {
  const isMac = window.navigator.platform.includes('Mac');
  return hotkey
    .replace(/CommandOrControl|CmdOrCtrl/g, isMac ? 'Cmd' : 'Ctrl')
    .replace(/Command/g, 'Cmd')
    .replace(/Control/g, 'Ctrl');
};

function TerminalPane({ sessionId = 'default', cwd = null, initialLastCommand = null, isActive = false, onSetActive, settings = {} }) {
  const terminalRef = useRef(null);
  const initializedRef = useRef(false);

  const isMatch = (e, hotkey) => {
    if (!hotkey) return false;
    const parts = hotkey.split('+');
    const targetKey = parts.pop().toUpperCase();
    
    const cmdOrCtrl = parts.includes('CommandOrControl') || parts.includes('CmdOrCtrl');
    const meta = parts.includes('Command') || parts.includes('Meta') || (cmdOrCtrl && window.navigator.platform.includes('Mac'));
    const ctrl = parts.includes('Control') || (cmdOrCtrl && !window.navigator.platform.includes('Mac'));
    const shift = parts.includes('Shift');
    const alt = parts.includes('Alt');

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
  const [status, setStatus] = useState(() => {
    const s = getSessionStatus(sessionId);
    if (s?.cwd) return s;
    return {
      folder: cwd ? cwd.split(/[\\/]/).pop() : '',
      branch: '',
      cwd: cwd || '',
      memoryMB: 0
    };
  });
  const [branches, setBranches] = useState([]);
  const [showBranches, setShowBranches] = useState(false);
  const [showAIInput, setShowAIInput] = useState(false);
  const [showTaskInput, setShowTaskInput] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [taskPrompt, setTaskPrompt] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [backgroundTasks, setBackgroundTasks] = useState([]);
  const [showTaskViewer, setShowTaskViewer] = useState(null);

  // History and Suggestions State
  const [aiHistory, setAiHistory] = useState(() => JSON.parse(localStorage.getItem('aiHistory') || '[]'));
  const [taskHistory, setTaskHistory] = useState(() => JSON.parse(localStorage.getItem('taskHistory') || '[]'));
  const [aiHistoryIndex, setAiHistoryIndex] = useState(-1);
  const [taskHistoryIndex, setTaskHistoryIndex] = useState(-1);
  const [aiFilteredMatch, setAiFilteredMatch] = useState(null); // Current filtered history match
  const [taskFilteredMatch, setTaskFilteredMatch] = useState(null);
  const [queueHistoryIndex, setQueueHistoryIndex] = useState(-1);
  const [queueFilteredMatch, setQueueFilteredMatch] = useState(null);
  const [shellHistoryLoaded, setShellHistoryLoaded] = useState(false);

  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showChangedFiles, setShowChangedFiles] = useState(false);
  const [changedFiles, setChangedFiles] = useState([]);
  const [diffViewer, setDiffViewer] = useState(null); // { file, lines }
  const [diffSplit, setDiffSplit] = useState(false);
  const [discardConfirm, setDiscardConfirm] = useState(false);
  const [commitDialog, setCommitDialog] = useState(false);
  const changedFilesRef = useRef(null);

  const searchInputRef = useRef(null);
  const dropdownRef = useRef(null);
  const aiInputRef = useRef(null);
  const taskInputRef = useRef(null);
  const queueInputRef = useRef(null);
  const taskTerminalRef = useRef(null);
  const taskXtermRef = useRef(null);
  const taskXtermUnsubRef = useRef(null);
  const taskViewerQueue = useRef([]); // finished tasks waiting to be shown

  const [commandQueue, setCommandQueue] = useState([]);
  const [showQueueInput, setShowQueueInput] = useState(false);
  const [queuePrompt, setQueuePrompt] = useState('');
  const [showRunEdit, setShowRunEdit] = useState(false);
  const [runEditValue, setRunEditValue] = useState('');
  const [runTargetExists, setRunTargetExists] = useState(false);
  const runEditRef = useRef(null);
  const prevCommandRef = useRef(status.command);

  const isMounted = useRef(true);
  useEffect(() => {
    return () => { isMounted.current = false; };
  }, []);

  const [aiSuggestedCommand, setAiSuggestedCommand] = useState(null);
  const [aiSyntaxValid, setAiSyntaxValid] = useState('idle'); // 'idle' | 'verifying' | 'valid' | 'dangerous' | 'invalid'
  const [aiError, setAiError] = useState(null);

  const getSuggestion = (input, history) => {
    if (!input) return '';
    const match = history.find(cmd => cmd.startsWith(input) && cmd !== input);
    return match ? match.slice(input.length) : '';
  };

  const handleHistoryNav = (e, type) => {
    // Queued commands are shell commands, so they autocomplete from the same
    // history as background tasks (shell history + local task history).
    const prompt = { ai: aiPrompt, task: taskPrompt, queue: queuePrompt }[type];
    const history = { ai: aiHistory, task: taskHistory, queue: taskHistory }[type];
    const index = { ai: aiHistoryIndex, task: taskHistoryIndex, queue: queueHistoryIndex }[type];
    const setIndex = { ai: setAiHistoryIndex, task: setTaskHistoryIndex, queue: setQueueHistoryIndex }[type];
    const setPrompt = { ai: setAiPrompt, task: setTaskPrompt, queue: setQueuePrompt }[type];
    const setMatch = { ai: setAiFilteredMatch, task: setTaskFilteredMatch, queue: setQueueFilteredMatch }[type];
    const currentMatch = { ai: aiFilteredMatch, task: taskFilteredMatch, queue: queueFilteredMatch }[type];

    // Filter history to only commands starting with current input
    const filtered = history.filter(cmd => cmd.startsWith(prompt));

    if (e.key === 'ArrowUp') {
      // Show next matching command as suggestion (keep prompt, show filtered match)
      if (filtered.length > 0 && index < filtered.length - 1) {
        const newIndex = index + 1;
        setIndex(newIndex);
        setMatch(filtered[newIndex]); // Track current match for suggestion UI
      }
      e.preventDefault();
    } else if (e.key === 'ArrowDown') {
      if (index > 0) {
        const newIndex = index - 1;
        setIndex(newIndex);
        setMatch(filtered[newIndex]);
      } else {
        setIndex(-1);
        setMatch(null);
      }
      e.preventDefault();
    } else if (e.key === 'ArrowRight' || e.key === 'Tab') {
      // Accept current match or suggestion
      if (currentMatch) {
        setPrompt(currentMatch);
        setIndex(-1);
        setMatch(null);
      } else {
        const suggestion = getSuggestion(prompt, history);
        if (suggestion) {
          setPrompt(prompt + suggestion);
        }
      }
      e.preventDefault();
    }
  };

  const addToHistory = (cmd, type) => {
    if (!cmd.trim()) return;
    const setter = type === 'ai' ? setAiHistory : setTaskHistory;
    const storageKey = type === 'ai' ? 'aiHistory' : 'taskHistory';
    
    setter(prev => {
      const filtered = prev.filter(c => c !== cmd);
      const newHistory = [cmd, ...filtered].slice(0, 50);
      localStorage.setItem(storageKey, JSON.stringify(newHistory));
      return newHistory;
    });
    const setIndex = type === 'ai' ? setAiHistoryIndex : setTaskHistoryIndex;
    setIndex(-1);
  };

  useEffect(() => {
    let unsubs = [];
    const fetchTasks = async () => {
      const allTasks = await ipcRenderer.invoke('terminal.getAllBackgroundTasks', { sessionId });
      setBackgroundTasks(allTasks);

      allTasks.forEach(task => {
        if (task.status === 'running') {
          const unsub = ipcRenderer.on(`background-task-finished-${task.id}`, (_, { exitCode, wasKilled }) => {
            setBackgroundTasks(prev => prev.map(t =>
              t.id === task.id ? { ...t, status: 'finished', exitCode } : t
            ));
            if (!wasKilled) {
              showOrQueueTask({ ...task, status: 'finished', exitCode });
              ipcRenderer.invoke('app.playSound');
            }
            ipcRenderer.invoke('terminal.viewBackgroundTask', { taskId: task.id });
            unsub();
          });
          unsubs.push(unsub);
        }
      });
    };
    fetchTasks();
    return () => {
      unsubs.forEach(unsub => unsub());
    };
  }, [sessionId]);

  useEffect(() => {
    if (shellHistoryLoaded) return;
    const loadShellHistory = async () => {
      try {
        const shellCmds = await ipcRenderer.invoke('app.getShellHistory', { limit: 200 });
        if (shellCmds && shellCmds.length > 0) {
          const localCmds = JSON.parse(localStorage.getItem('taskHistory') || '[]');
          const combined = [...shellCmds, ...localCmds];
          const seen = new Set();
          const unique = combined.filter(cmd => {
            if (seen.has(cmd)) return false;
            seen.add(cmd);
            return true;
          }).slice(0, 200);
          setTaskHistory(unique);
        }
      } catch (err) {
        console.error('[shell-history] failed to load:', err);
      }
      setShellHistoryLoaded(true);
    };
    loadShellHistory();
  }, [shellHistoryLoaded]);


  const handleRunBackground = async (command, targetCwd = null) => {
    if (!command) return;
    const effectiveCwd = targetCwd || status.cwd;
    const taskId = crypto.randomUUID();
    const newTask = { id: taskId, sessionId, command, status: 'running', startTime: Date.now(), viewed: false };
    
    // Register listener BEFORE invoke to avoid race on fast-exiting commands
    const unsub = ipcRenderer.on(`background-task-finished-${taskId}`, (_, { exitCode, wasKilled }) => {
      setBackgroundTasks(prev => prev.map(t =>
        t.id === taskId ? { ...t, status: 'finished', exitCode } : t
      ));
      if (!wasKilled) {
        showOrQueueTask({ id: taskId, sessionId, command, status: 'finished', exitCode });
        ipcRenderer.invoke('app.playSound');
      }
      ipcRenderer.invoke('terminal.viewBackgroundTask', { taskId });
      unsub();
    });

    setBackgroundTasks(prev => [newTask, ...prev]);

    try {
      await ipcRenderer.invoke('terminal.runBackground', { command, cwd: effectiveCwd, sessionId, taskId });
    } catch (err) {
      unsub();
      setBackgroundTasks(prev => prev.filter(t => t.id !== taskId));
      alert(`Failed to start background task: ${err.message}`);
    }
  };

  const midEllipsis = (filePath, maxLen = 32) => {
    if (!filePath || filePath.length <= maxLen) return filePath;
    
    const sep = filePath.includes('/') ? '/' : '\\';
    const parts = filePath.split(sep);
    const filename = parts.pop();
    const dir = parts.join(sep);
    
    // If filename itself is very long, truncate the filename
    if (filename.length > maxLen - 7) {
      return `…${sep}${filename.slice(-(maxLen - 2))}`;
    }
    
    // Calculate how much of the directory we can keep
    // We want: "part_of_dir…/filename"
    const available = maxLen - filename.length - 2; // 2 for '…/'
    
    if (available <= 0) {
      return `…${sep}${filename}`;
    }
    
    return `${dir.slice(0, available)}…${sep}${filename}`;
  };

  const openTaskViewer = (task) => {
    setShowTaskViewer(task);
    setBackgroundTasks(prev => prev.map(t => t.id === task.id ? { ...t, viewed: true } : t));
    ipcRenderer.invoke('terminal.viewBackgroundTask', { taskId: task.id });
  };

  const showOrQueueTask = (task) => {
    setShowTaskViewer(prev => {
      if (!prev) return task;
      taskViewerQueue.current = [...taskViewerQueue.current, task];
      return prev;
    });
  };

  const advanceQueue = () => {
    const next = taskViewerQueue.current.shift() ?? null;
    setShowTaskViewer(next);
  };

  const dismissTaskViewer = () => {
    if (showTaskViewer) {
      const task = backgroundTasks.find(t => t.id === showTaskViewer.id);
      if (task?.status !== 'running') removeTask(showTaskViewer.id);
      else { setShowTaskViewer(null); advanceQueue(); }
    }
  };

  const removeTask = (taskId) => {
    ipcRenderer.invoke('terminal.removeBackgroundTask', { taskId });
    setBackgroundTasks(prev => prev.filter(t => t.id !== taskId));
    taskViewerQueue.current = taskViewerQueue.current.filter(t => t.id !== taskId);
    setShowTaskViewer(prev => {
      if (prev?.id !== taskId) return prev;
      const next = taskViewerQueue.current.shift() ?? null;
      return next;
    });
  };
  useEffect(() => {
    if (prevCommandRef.current && !status.command && commandQueue.length > 0) {
      const { queue, executeNow } = processQueue(commandQueue, status.command);
      if (executeNow) {
        setCommandQueue(queue);
        ipcRenderer.send('terminal.keystroke', { sessionId, data: `${executeNow}\n` });
      }
    }
    prevCommandRef.current = status.command;
  }, [status.command, commandQueue, sessionId]);

  const handleQueueCommand = (cmd) => {
    const { queue, executeNow } = enqueueCommand(commandQueue, cmd, status.command);
    if (executeNow) {
      ipcRenderer.send('terminal.keystroke', { sessionId, data: executeNow + '\n' });
    } else {
      setCommandQueue(queue);
    }
  };

  const runCommand = (status.cwd && settings.runCommands?.[status.cwd]) || './start.sh';
  const runCommandIsScript = /^\.{0,2}\/?\S*\.sh(\s|$)/.test(runCommand.trim()) || runCommand.trim().startsWith('/') || runCommand.trim().startsWith('./') || runCommand.trim().startsWith('../');

  useEffect(() => {
    if (!status.cwd) {
      setRunTargetExists(false);
      return;
    }
    if (!runCommandIsScript) {
      setRunTargetExists(true);
      return;
    }
    let cancelled = false;
    const target = runCommand.trim().split(/\s+/)[0];
    ipcRenderer.invoke('terminal.checkPathExists', { cwd: status.cwd, relativePath: target }).then(exists => {
      if (!cancelled) setRunTargetExists(exists);
    });
    return () => { cancelled = true; };
  }, [status.cwd, runCommand, runCommandIsScript]);

  const handleRunClick = async () => {
    let currentCwd = status.cwd;
    try {
      const cwds = await ipcRenderer.invoke('app.forceCwdUpdate', { sessionId });
      if (cwds && cwds[sessionId]) {
        currentCwd = cwds[sessionId];
      }
    } catch (e) {
      console.error('[Run] Failed to force CWD update:', e);
    }

    const commandToRun = (currentCwd && settings.runCommands?.[currentCwd]) || './start.sh';
    const isScript = /^\.{0,2}\/?\S*\.sh(\s|$)/.test(commandToRun.trim()) || commandToRun.trim().startsWith('/') || commandToRun.trim().startsWith('./') || commandToRun.trim().startsWith('../');

    if (isScript) {
      const target = commandToRun.trim().split(/\s+/)[0];
      const exists = await ipcRenderer.invoke('terminal.checkPathExists', { cwd: currentCwd, relativePath: target });
      if (!exists) return;
    }
    handleRunBackground(commandToRun, currentCwd);
  };

  const handleSaveRunCommand = () => {
    const trimmed = runEditValue.trim();
    if (!trimmed) return; // keep the row open — nothing to save yet
    if (!status.cwd) { setShowRunEdit(false); return; }
    ipcRenderer.send('settings.set', { runCommands: { ...(settings.runCommands || {}), [status.cwd]: trimmed } });
    setShowRunEdit(false);
  };

  useEffect(() => {
    if (showRunEdit && runEditRef.current) {
      runEditRef.current.focus();
      runEditRef.current.select();
    }
  }, [showRunEdit]);
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setShowBranches(false);
      }
      if (changedFilesRef.current && !changedFilesRef.current.contains(event.target)) {
        setShowChangedFiles(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (!diffViewer) return;
    const handler = (e) => { if (e.key === 'Escape') setDiffViewer(null); };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [diffViewer]);

  useEffect(() => {
    const unsubscribe = ipcRenderer.on(`git.branches-${sessionId}`, (event, data) => {
      if (data.branches) setBranches(data.branches);
    });
    return unsubscribe;
  }, [sessionId]);

  useEffect(() => {
    const handleOpenCommit = () => {
      if (status.cwd) {
        setCommitDialog(true);
      }
    };
    window.addEventListener(`session:openCommit:${sessionId}`, handleOpenCommit);
    return () => window.removeEventListener(`session:openCommit:${sessionId}`, handleOpenCommit);
  }, [sessionId, status.cwd]);

  useEffect(() => {
    const handleRunShortcut = () => handleRunClick();
    window.addEventListener(`session:runCommand:${sessionId}`, handleRunShortcut);
    return () => window.removeEventListener(`session:runCommand:${sessionId}`, handleRunShortcut);
  }, [sessionId, runCommand, runCommandIsScript, status.cwd]);

  useEffect(() => {
    if (!terminalRef.current) return;

    const session = getOrCreateSession(sessionId, cwd, initialLastCommand);
    const { term, fitAddon, container } = session;

    if (session.status?.cwd) {
      setStatus(session.status);
    }

    session.onStatusChange = (newStatus) => {
      setStatus(newStatus);
    };

    // Attach container to DOM
    if (terminalRef.current) {
      terminalRef.current.innerHTML = '';
      terminalRef.current.appendChild(container);
    }

    // Request immediate git status refresh when pane becomes active
    ipcRenderer.invoke('terminal.refreshGitStatus', { sessionId }).catch(() => {});

    const handleAISubmit = async () => {
      if (!aiPrompt.trim() || aiLoading) return;
      setAiLoading(true);
      try {
        const command = await ipcRenderer.invoke('terminal.askAI', { prompt: aiPrompt });
        if (command) {
          ipcRenderer.send('terminal.keystroke', { sessionId, data: command });
          setShowAIInput(false);
          setAiPrompt('');
          term.focus();
        }
      } catch (err) {
        console.error('AI Command Error:', err);
        alert(`AI Error: ${err.message}`);
      } finally {
        setAiLoading(false);
      }
    };

    // Re-attach key event handlers
    if (!initializedRef.current) {
      term.attachCustomKeyEventHandler((e) => {
        if (e.type !== 'keydown') return true;

        // Check custom shortcuts from settings
        if (isMatch(e, settings.rerunShortcut || 'CommandOrControl+R')) return false;
        if (isMatch(e, settings.ghDesktopShortcut)) return false;
        if (isMatch(e, settings.vscodeShortcut)) return false;
        if (isMatch(e, settings.commitShortcut)) return false;

        if ((e.metaKey || e.ctrlKey) && e.key === 'f' && e.type === 'keydown') {
          e.preventDefault();
          setShowSearch(prev => !prev);
          return false;
        }
        if ((e.metaKey || e.ctrlKey) && e.key === 'g' && e.type === 'keydown') {
          e.preventDefault();
          setShowAIInput(prev => !prev);
          setShowTaskInput(false);
          setShowQueueInput(false);
          return false;
        }
        if ((e.metaKey || e.ctrlKey) && e.key === 'b' && e.type === 'keydown') {
          e.preventDefault();
          setShowTaskInput(prev => !prev);
          setShowAIInput(false);
          setShowQueueInput(false);
          return false;
        }
        // Cmd/Ctrl+Shift+E to "enqueue" — Cmd+Shift+Q is the macOS log-out shortcut
        if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'e' && e.type === 'keydown') {
          e.preventDefault();
          setShowQueueInput(prev => !prev);
          setShowAIInput(false);
          setShowTaskInput(false);
          return false;
        }
        if (e.ctrlKey && e.key === 'Tab' && e.type === 'keydown') {
          return false;
        }
        if ((e.metaKey || e.ctrlKey) && e.key === 'r' && e.type === 'keydown') {
          // Allow App.jsx to handle the rerun shortcut
          return false;
        }
        if ((e.metaKey || e.ctrlKey) && e.key === ',' && e.type === 'keydown') {
          // Allow settings modal to open
          return false;
        }
        if ((e.metaKey || e.ctrlKey) && e.key === 'k' && e.type === 'keydown') {
          term.clear();
          return false;
        }
        if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key.toLowerCase() === 'd' || e.key.toLowerCase() === 'r') && e.type === 'keydown') {
          return false;
        }
        if ((e.metaKey || e.ctrlKey) && e.key === 'w' && e.type === 'keydown') {
          return false;
        }
        if ((e.keyCode === 13 || e.code === 'Enter') && e.type === 'keydown') {
          if (e.shiftKey) {
            e.preventDefault();
            ipcRenderer.send('terminal.keystroke', { sessionId, data: '\x0a' });
            return false;
          }
          if (e.altKey) {
            e.preventDefault();
            ipcRenderer.send('terminal.keystroke', { sessionId, data: '\x1b\r' });
            return false;
          }
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            ipcRenderer.send('terminal.keystroke', { sessionId, data: '\n' });
            return false;
          }
        }
        if ((e.metaKey || e.ctrlKey) && e.key === 'End' && e.type === 'keydown') {
          term.scrollToBottom();
          return false;
        }
        // Option+Left → word back (ESC b)
        if (e.altKey && !e.metaKey && !e.ctrlKey && e.key === 'ArrowLeft' && e.type === 'keydown') {
          ipcRenderer.send('terminal.keystroke', { sessionId, data: '\x1bb' });
          return false;
        }
        // Option+Right → word forward (ESC f)
        if (e.altKey && !e.metaKey && !e.ctrlKey && e.key === 'ArrowRight' && e.type === 'keydown') {
          ipcRenderer.send('terminal.keystroke', { sessionId, data: '\x1bf' });
          return false;
        }
        // Cmd+Left → beginning of line
        if (e.metaKey && !e.altKey && !e.ctrlKey && e.key === 'ArrowLeft' && e.type === 'keydown') {
          ipcRenderer.send('terminal.keystroke', { sessionId, data: '\x01' });
          return false;
        }
        // Cmd+Right → end of line
        if (e.metaKey && !e.altKey && !e.ctrlKey && e.key === 'ArrowRight' && e.type === 'keydown') {
          ipcRenderer.send('terminal.keystroke', { sessionId, data: '\x05' });
          return false;
        }
        // Cmd+Backspace → clear to beginning of line
        if (e.metaKey && !e.altKey && !e.ctrlKey && e.key === 'Backspace' && e.type === 'keydown') {
          ipcRenderer.send('terminal.keystroke', { sessionId, data: '\x15' });
          return false;
        }
        // Option+Backspace → delete word back
        if (e.altKey && !e.metaKey && !e.ctrlKey && e.key === 'Backspace' && e.type === 'keydown') {
          ipcRenderer.send('terminal.keystroke', { sessionId, data: '\x1b\x7f' });
          return false;
        }
        // Ctrl+Shift+C → copy, Ctrl+(Shift+)V → paste; plain Ctrl+C stays SIGINT
        if (e.ctrlKey && e.shiftKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === 'c') {
          e.preventDefault();
          const text = term.getSelection();
          if (text) ipcRenderer.invoke('app.writeClipboard', { text });
          return false;
        }
        // Plain Ctrl+V also pastes (deliberate deviation from GNOME Terminal, where it sends ^V)
        if (e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === 'v') {
          e.preventDefault();
          ipcRenderer.invoke('app.readClipboard').then((text) => { if (text) term.paste(text); });
          return false;
        }
        // Ctrl+C → send SIGINT to PTY and cancel pending rerun
        if (e.ctrlKey && !e.metaKey && e.key === 'c' && e.type === 'keydown') {
          cancelRerun(sessionId);
          ipcRenderer.send('terminal.keystroke', { sessionId, data: '\x03' });
          return false;
        }
        return true;
      });
      initializedRef.current = true;
    }

    const handleResize = () => {
      if (terminalRef.current && terminalRef.current.offsetWidth > 0) {
        try {
          fitAddon.fit();
          resizeSession(sessionId, term.cols, term.rows);
        } catch (e) {
          console.error('Fit error:', e);
        }
      }
    };

    // Watch for container resize
    const resizeObserver = new ResizeObserver(() => {
      requestAnimationFrame(handleResize);
    });
    resizeObserver.observe(terminalRef.current);

    // Initial fits
    setTimeout(handleResize, 50);
    setTimeout(handleResize, 250);
    if (isActive) {
      setTimeout(() => {
        handleResize();
        term.focus();
      }, 500);
    }

    window.addEventListener('resize', handleResize);

    const focusHandler = () => onSetActive?.();
    const xtermTextarea = term.textarea;
    if (xtermTextarea) {
      xtermTextarea.addEventListener('focus', focusHandler);
    }

    return () => {
      if (xtermTextarea) {
        xtermTextarea.removeEventListener('focus', focusHandler);
      }
      resizeObserver.disconnect();
      window.removeEventListener('resize', handleResize);
      // Remove container from DOM so it can be re-attached elsewhere
      if (terminalRef.current && container.parentNode === terminalRef.current) {
        terminalRef.current.removeChild(container);
      }
    };
  }, [sessionId, cwd]);

  useEffect(() => {
    if (isActive) {
      const session = getOrCreateSession(sessionId, cwd);
      session.term.focus();
    }
  }, [isActive, sessionId, cwd]);

  useEffect(() => {
    if (showSearch) {
      setTimeout(() => searchInputRef.current?.focus(), 50);
    } else {
      setSearchQuery('');
      const session = getOrCreateSession(sessionId, cwd);
      session.searchAddon?.clearDecorations?.();
    }
  }, [showSearch]);

  useEffect(() => {
    if (showAIInput && aiInputRef.current) {
      aiInputRef.current.focus();
    }
  }, [showAIInput]);

  useEffect(() => {
    if (showTaskInput && taskInputRef.current) {
      taskInputRef.current.focus();
    }
  }, [showTaskInput]);

  useEffect(() => {
    if (showQueueInput && queueInputRef.current) {
      queueInputRef.current.focus();
    }
  }, [showQueueInput]);

  // Mount/unmount xterm inside the task viewer modal
  useEffect(() => {
    if (!showTaskViewer || !taskTerminalRef.current) return;

    const term = new Terminal({
      disableStdin: true,
      convertEol: true,
      scrollback: 10000,
      fontSize: 13,
      fontFamily: '"JetBrains Mono", "Fira Code", "SF Mono", "Monaco", "Menlo", monospace',
      theme: {
        background: '#000000',
        foreground: '#ecf0f1',
        cursor: '#ecf0f1',
        black: '#000000', red: '#c0392b', green: '#27ae60', yellow: '#f39c12',
        blue: '#2980b9', magenta: '#8e44ad', cyan: '#06b6d4', white: '#ecf0f1',
        brightBlack: '#7f8c8d', brightRed: '#e74c3c', brightGreen: '#2ecc71',
        brightYellow: '#f1c40f', brightBlue: '#3498db', brightMagenta: '#9b59b6',
        brightCyan: '#22d3ee', brightWhite: '#ffffff',
      },
    });
    const taskFit = new FitAddon();
    term.loadAddon(taskFit);
    term.open(taskTerminalRef.current);
    taskFit.fit();
    term.focus(); // Focus so keyboard events (like Escape) go to this xterm
    taskXtermRef.current = term;

    const ro = new ResizeObserver(() => { try { taskFit.fit(); } catch (e) {} });
    ro.observe(taskTerminalRef.current);

    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown') return true;
      if (e.key === 'Escape') {
        dismissTaskViewer();
        return false;
      }
      if (e.ctrlKey && !e.metaKey && e.key === 'c') {
        ipcRenderer.invoke('terminal.killBackground', { taskId: showTaskViewer.id }).then(success => {
          if (success) removeTask(showTaskViewer.id);
        });
        return false;
      }
      return true;
    });

    ipcRenderer.invoke('terminal.getBackgroundTask', { taskId: showTaskViewer.id }).then(task => {
      if (task?.output) {
        term.write(task.output);
        term.scrollToBottom();
      }
    });

    const unsub = ipcRenderer.on(`background-task-update-${showTaskViewer.id}`, (_, { output }) => {
      term.write(output);
      term.scrollToBottom();
    });
    taskXtermUnsubRef.current = unsub;

    return () => {
      ro.disconnect();
      unsub();
      term.dispose();
      taskXtermRef.current = null;
      taskXtermUnsubRef.current = null;
    };
  }, [showTaskViewer?.id]);

  useEffect(() => {
    if (!isActive) return; // Only handle Escape if this pane is active

    const handleKeyDown = (event) => {
      if (event.key === 'Escape' && showTaskViewer) {
        event.stopPropagation();
        dismissTaskViewer();
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [showTaskViewer, isActive]);

  const handleOpenFolder = () => {
    if (status.cwd) {
      ipcRenderer.send('folder.open', { path: status.cwd });
    }
  };

  const handleFolderContextMenu = (e) => {
    e.preventDefault();
    if (status.cwd) {
      ipcRenderer.send('folder.context-menu', { path: status.cwd });
    }
  };

  const handleOpenPR = () => {
    if (status.pr?.url) {
      ipcRenderer.send('folder.open', { path: status.pr.url });
    }
  };

  const handleGitStatsClick = async (e) => {
    e.stopPropagation();
    if (!status.cwd) return;
    // Open GitHub Desktop directly instead of showing file list
    await ipcRenderer.invoke('app.openGitHubDesktop', { path: status.cwd });
  };

  const handleBranchClick = (e) => {
    e.stopPropagation();
    ipcRenderer.send('git.getBranches', { sessionId });
    setShowBranches(!showBranches);
  };

  const handleBranchContextMenu = (e) => {
    e.preventDefault();
    if (status.branch) {
      ipcRenderer.send('git.branch-context-menu', { branch: status.branch });
    }
  };

  const handleCheckout = (branch) => {
    ipcRenderer.send('git.checkout', { sessionId, branch });
    setShowBranches(false);
  };

  return (
    <div
      className={`${isActive ? 'terminal-pane--active' : ''} terminal-pane-container ${!isActive ? 'terminal-pane-container--inactive' : ''}`}
      style={{
        width: '100%',
        height: '100%',
        backgroundColor: '#000000',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden'
      }}
    >
      <div className="terminal-status-bar" style={{ borderBottom: '1px solid #222222', borderTop: 'none', flexShrink: 0 }}>
        <span 
          className="status-folder" 
          onClick={handleOpenFolder}
          onContextMenu={handleFolderContextMenu}
          title={status.cwd}
          style={{ cursor: 'pointer' }}
        >
          📁 {status.folder || '...'}
        </span>
        {status.branch && (
          <div style={{ position: 'relative', marginLeft: '10px' }} ref={dropdownRef}>
            <span className="status-git" onClick={handleBranchClick} onContextMenu={handleBranchContextMenu} style={{ cursor: 'pointer' }}>
              <img src={gitIcon} style={{ width: '14px', height: '14px', marginRight: '4px', verticalAlign: 'middle', filter: 'grayscale(1) brightness(1.8)' }} />
              {status.branch}
            </span>
            {showBranches && (
              <div className="branch-dropdown" style={{ top: '100%', bottom: 'auto', marginTop: '4px' }}>
                {branches.map(b => (
                  <div 
                    key={b} 
                    className={`branch-item ${b === status.branch ? 'active' : ''}`}
                    onClick={() => handleCheckout(b)}
                  >
                    {b}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        <div style={{ flex: 1 }} />
        
        {status.command && (
          <span 
            className="status-command" 
            title="Running command"
            style={{ 
              color: '#f1c40f', 
              fontSize: '11px', 
              fontFamily: 'monospace',
              backgroundColor: '#332b00',
              padding: '2px 6px',
              borderRadius: '4px',
              border: '1px solid #665500',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              marginRight: '8px'
            }}
          >
            <span style={{ animation: 'task-pulse 1.5s infinite' }}>⚙</span> {status.command}
          </span>
        )}

        {status.pr && (
          <span 
            className="status-pr" 
            onClick={handleOpenPR}
            title={status.pr.title}
            style={{ cursor: 'pointer' }}
          >
            PR #{status.pr.number}
          </span>
        )}

        {status.isBehindRemote && (
          <button
            title="Pull remote changes"
            onClick={() => handleRunBackground('git pull')}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#f39c12', padding: '0 4px', display: 'flex', alignItems: 'center', transition: 'color 0.15s', fontSize: '12px', fontWeight: 600 }}
            onMouseEnter={e => e.currentTarget.style.color = '#fbbf24'}
            onMouseLeave={e => e.currentTarget.style.color = '#f39c12'}
          >
            ⬇ Pull
          </button>
        )}
        {status.gitStats && (
          <div style={{ position: 'relative' }} ref={changedFilesRef}>
            <span
              className="status-git-stats"
              onClick={handleGitStatsClick}
              style={{ cursor: 'pointer' }}
            >
              <span style={{ color: '#2ecc71' }}>+{status.gitStats.insertions}</span>
              <span style={{ color: '#e74c3c', marginLeft: '4px' }}>-{status.gitStats.deletions}</span>
            </span>
            {showChangedFiles && (
              <div style={{
                position: 'absolute', top: '100%', right: 0, marginTop: '4px',
                backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '6px',
                minWidth: '260px', maxWidth: '340px', maxHeight: '300px', overflowY: 'auto',
                boxShadow: '0 8px 24px rgba(0,0,0,0.5)', zIndex: 200, padding: '4px 0'
              }}>
                {changedFiles.length === 0 && (
                  <div style={{ padding: '8px 12px', color: '#64748b', fontSize: '12px' }}>Loading…</div>
                )}
                {changedFiles.map((f, i) => {
                  const color = f.status === 'M' || f.status === 'MM' ? '#f39c12'
                    : f.status === 'A' || f.status === 'AM' ? '#2ecc71'
                    : f.status === 'D' ? '#e74c3c'
                    : f.status === 'R' ? '#3498db'
                    : f.status === 'C' ? '#06b6d4'
                    : f.status.includes('U') ? '#e74c3c'
                    : '#94a3b8'; // untracked ??
                  const label = f.status === 'M' || f.status === 'MM' ? 'M'
                    : f.status === 'A' || f.status === 'AM' ? 'A'
                    : f.status === 'D' ? 'D'
                    : f.status === 'R' ? 'R'
                    : f.status === 'C' ? 'C'
                    : f.status.includes('U') ? 'U'
                    : '?';
                  const fullPath = `${status.cwd}/${f.file}`;
                  return (
                    <div key={i}
                      onClick={async () => {
                        setShowChangedFiles(false);
                        // Try to open GitHub Desktop if available
                        const ghResult = await ipcRenderer.invoke('app.openGitHubDesktop', { path: status.cwd });
                        if (ghResult.success) {
                          return; // GitHub Desktop opened, don't show diff viewer
                        }
                        // Fallback: show diff viewer if GitHub Desktop not available
                        const raw = await ipcRenderer.invoke('terminal.getFileDiff', { cwd: status.cwd, file: f.file });
                        if (raw) { setDiffViewer({ file: f.file, lines: raw.split('\n') }); setDiscardConfirm(false); }
                      }}
                      style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 12px', fontSize: '12px', fontFamily: 'monospace', cursor: 'pointer' }}
                      onMouseEnter={e => e.currentTarget.style.backgroundColor = '#334155'}
                      onMouseLeave={e => e.currentTarget.style.backgroundColor = ''}
                    >
                      <span style={{ color, fontWeight: 'bold', width: '12px', flexShrink: 0 }}>{label}</span>
                      <span title={f.file} style={{ color: '#e2e8f0', whiteSpace: 'nowrap', userSelect: 'text', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{midEllipsis(f.file)}</span>
                      <img
                        src={vscodeIcon}
                        title="Open in VS Code"
                        onClick={e => { e.stopPropagation(); ipcRenderer.invoke('app.openInVSCode', { path: fullPath }); }}
                        style={{ width: '13px', height: '13px', opacity: 0.5, flexShrink: 0, cursor: 'pointer' }}
                        onMouseEnter={e => e.currentTarget.style.opacity = '1'}
                        onMouseLeave={e => e.currentTarget.style.opacity = '0.5'}
                      />
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {backgroundTasks.filter(t => t.status === 'running').length > 0 && (
          <div className="background-tasks-status" style={{ display: 'flex', gap: '6px' }}>
            {backgroundTasks
              .filter(t => t.status === 'running')
              .slice(0, 5)
              .map(task => (
                <div
                  key={task.id}
                  className="task-indicator running"
                  onClick={(e) => {
                    if (e.button === 1) return;
                    openTaskViewer(task);
                  }}
                  onMouseDown={(e) => {
                    if (e.button !== 1) return;
                    e.preventDefault();
                    e.stopPropagation();
                    ipcRenderer.invoke('terminal.killBackground', { taskId: task.id }).then(success => {
                      if (success) removeTask(task.id);
                    });
                  }}
                  onAuxClick={(e) => {
                    if (e.button === 1) e.preventDefault();
                  }}
                  title={`${task.command} (running)\nMiddle-click to stop`}
                  style={{
                    width: '14px',
                    height: '14px',
                    borderRadius: '50%',
                    backgroundColor: '#f39c12',
                    cursor: 'pointer',
                    animation: 'task-pulse 1.5s infinite'
                  }}
                />
              ))
            }
          </div>
        )}

        <button
          className={`ai-toggle-btn ${showAIInput ? 'active' : ''}`}
          onClick={() => { setShowAIInput(!showAIInput); setShowTaskInput(false); setShowQueueInput(false); setAiSuggestedCommand(null); setAiSyntaxValid(null); }}
          title="Ask AI (Cmd+G)"
          style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', fontSize: '14px' }}
        >
          ✨
        </button>

        <button 
          className={`task-toggle-btn ${showTaskInput ? 'active' : ''}`}
          onClick={() => { setShowTaskInput(!showTaskInput); setShowAIInput(false); setShowQueueInput(false); setAiSuggestedCommand(null); setAiSyntaxValid(null); }}
          title="Run Background Task (Cmd+B)"
          style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
        >
          <svg style={{width: '18px', height: '18px'}} viewBox="0 0 24 24">
            <path fill="currentColor" d="M20,19H4c-1.1,0-2-0.9-2-2V7c0-1.1,0.9-2,2-2h16c1.1,0,2,0.9,2,2v10C22,18.1,21.1,19,20,19z M4,7v10h16V7H4z M14,15v-2h4v2H14z M6,15l5-4l-5-4l1.4-1.4l6.8,5.4l-6.8,5.4L6,15z" />
          </svg>
        </button>

        <button
          className="run-btn"
          onClick={handleRunClick}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setRunEditValue(runCommand);
            setShowRunEdit(true);
          }}
          title={`${runTargetExists ? `Run: ${runCommand}` : `${runCommand} not found`} (${formatShortcut(settings.runShortcut || 'CommandOrControl+S')} · Right-click to edit)`}
          style={{
            background: 'none',
            border: 'none',
            color: runTargetExists ? '#2ecc71' : '#4b5563',
            cursor: runTargetExists ? 'pointer' : 'default',
            fontSize: '15px',
            display: 'flex',
            alignItems: 'center',
            padding: '0 4px',
            opacity: runTargetExists ? 1 : 0.5
          }}
        >
          ▶
        </button>
      </div>
      
      {showSearch && (
        <div style={{ backgroundColor: '#111', borderBottom: '1px solid #222', padding: '4px 8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            placeholder="Search…"
            onChange={(e) => {
              const q = e.target.value;
              setSearchQuery(q);
              const session = getOrCreateSession(sessionId, cwd);
              if (q) session.searchAddon.findNext(q, { decorations: { matchBackground: '#f39c1266', matchBorder: '#f39c12', matchOverviewRuler: '#f39c12', activeMatchBackground: '#f39c12', activeMatchBorder: '#f39c12', activeMatchColorOverviewRuler: '#f39c12' } });
            }}
            onKeyDown={(e) => {
              const session = getOrCreateSession(sessionId, cwd);
              const opts = { decorations: { matchBackground: '#f39c1266', matchBorder: '#f39c12', matchOverviewRuler: '#f39c12', activeMatchBackground: '#f39c12', activeMatchBorder: '#f39c12', activeMatchColorOverviewRuler: '#f39c12' } };
              if (e.key === 'Enter') { e.shiftKey ? session.searchAddon.findPrevious(searchQuery, opts) : session.searchAddon.findNext(searchQuery, opts); }
              if (e.key === 'Escape') { setShowSearch(false); getOrCreateSession(sessionId, cwd).term.focus(); }
            }}
            style={{ flex: 1, background: '#1e293b', border: '1px solid #334155', borderRadius: '4px', padding: '3px 8px', color: '#f1f5f9', fontSize: '12px', outline: 'none' }}
          />
          <button onClick={() => { const s = getOrCreateSession(sessionId, cwd); s.searchAddon.findPrevious(searchQuery); }} style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', fontSize: '14px', padding: '0 2px' }}>↑</button>
          <button onClick={() => { const s = getOrCreateSession(sessionId, cwd); s.searchAddon.findNext(searchQuery); }} style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', fontSize: '14px', padding: '0 2px' }}>↓</button>
          <button onClick={() => { setShowSearch(false); getOrCreateSession(sessionId, cwd).term.focus(); }} style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', fontSize: '16px', padding: '0 2px' }}>×</button>
        </div>
      )}

      {showAIInput && (
        <div className="ai-input-container">
          <div style={{ position: 'relative', flex: 1, display: 'flex', flexDirection: 'column' }}>
            <input
              ref={aiInputRef}
              type="text"
              className="ai-input"
              placeholder={(aiFilteredMatch || getSuggestion(aiPrompt, aiHistory)) ? '' : 'Ask AI for a command...'}
              value={aiPrompt}
              onChange={(e) => setAiPrompt(e.target.value)}
              onKeyDown={async (e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  e.stopPropagation();
                  const session = getOrCreateSession(sessionId, cwd);

                  if (!aiPrompt.trim() || aiLoading) return;
                  addToHistory(aiPrompt, 'ai');
                  setAiLoading(true);
                  setAiSuggestedCommand(null);
                  setAiSyntaxValid('verifying');
                  setAiError(null);
                  try {
                    const command = await ipcRenderer.invoke('terminal.askAI', { prompt: aiPrompt });
                    if (!isMounted.current) return;
                    if (command) {
                      setAiSuggestedCommand(command);
                      const [isValid, isDangerous] = await Promise.all([
                        ipcRenderer.invoke('terminal.verifyCommand', { command }),
                        ipcRenderer.invoke('terminal.isDangerousCommand', { command })
                      ]);
                      if (isMounted.current) {
                        setAiSyntaxValid(isValid ? (isDangerous ? 'dangerous' : 'valid') : 'invalid');
                      }
                    }
                  } catch (err) {
                    console.error('AI Command Error:', err);
                    if (isMounted.current) {
                      setAiError(err.message);
                      setAiSyntaxValid('idle');
                    }
                  } finally {
                    if (isMounted.current) setAiLoading(false);
                  }
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  e.stopPropagation();
                  setShowAIInput(false);
                  setAiSuggestedCommand(null);
                  setAiSyntaxValid('idle');
                  setAiError(null);
                  const session = getOrCreateSession(sessionId, cwd);
                  session.term.focus();
                } else if (['ArrowUp', 'ArrowDown', 'ArrowRight', 'Tab'].includes(e.key)) {
                  handleHistoryNav(e, 'ai');
                }
              }}
            />
            {aiSuggestedCommand && (
              <div className="ai-suggestion-box">
                <div className="ai-suggestion-text">
                  {aiSuggestedCommand}
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  {aiSyntaxValid !== 'idle' && aiSyntaxValid !== null && (
                    <span style={{ 
                      fontSize: '12px', 
                      color: aiSyntaxValid === 'verifying' ? '#94a3b8' 
                           : aiSyntaxValid === 'dangerous' ? '#f39c12' 
                           : aiSyntaxValid === 'valid' ? '#2ecc71' 
                           : '#e74c3c' 
                    }}>
                      {aiSyntaxValid === 'verifying' && 'Verifying syntax...'}
                      {aiSyntaxValid === 'dangerous' && '⚠ Valid but potentially dangerous'}
                      {aiSyntaxValid === 'valid' && '✓ Syntax Valid'}
                      {aiSyntaxValid === 'invalid' && '⚠ Syntax Error'}
                    </span>
                  )}
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                      disabled={aiSyntaxValid === 'verifying' || aiLoading}
                      onClick={() => {
                        ipcRenderer.send('terminal.keystroke', { sessionId, data: aiSuggestedCommand });
                        setShowAIInput(false);
                        setAiSuggestedCommand(null);
                        setAiPrompt('');
                        getOrCreateSession(sessionId, cwd).term.focus();
                      }}
                      style={{ background: aiSyntaxValid === 'verifying' ? '#475569' : '#334155', color: '#f8fafc', border: 'none', padding: '4px 8px', borderRadius: '4px', cursor: aiSyntaxValid === 'verifying' ? 'not-allowed' : 'pointer', fontSize: '12px' }}
                    >
                      Paste
                    </button>
                    <button
                      disabled={aiSyntaxValid === 'verifying' || aiLoading}
                      onClick={() => {
                        if (aiSyntaxValid === 'dangerous' && !window.confirm('This command has been flagged as potentially dangerous. Are you sure you want to run it?')) return;
                        ipcRenderer.send('terminal.keystroke', { sessionId, data: aiSuggestedCommand + '\n' });
                        setShowAIInput(false);
                        setAiSuggestedCommand(null);
                        setAiPrompt('');
                        getOrCreateSession(sessionId, cwd).term.focus();
                      }}
                      style={{ background: aiSyntaxValid === 'verifying' ? '#475569' : '#2563eb', color: '#f8fafc', border: 'none', padding: '4px 8px', borderRadius: '4px', cursor: aiSyntaxValid === 'verifying' ? 'not-allowed' : 'pointer', fontSize: '12px' }}
                    >
                      Run
                    </button>
                  </div>
                </div>
              </div>
            )}
            {!aiSuggestedCommand && (aiFilteredMatch || getSuggestion(aiPrompt, aiHistory)) && (
              <div
                style={{
                  position: 'absolute',
                  left: 0,
                  top: 0,
                  right: 0,
                  bottom: 0,
                  padding: '0 12px',
                  display: 'flex',
                  alignItems: 'center',
                  pointerEvents: 'none',
                  fontSize: '13px'
                }}
              >
                <span style={{ color: 'transparent' }}>{aiPrompt}</span>
                <span style={{ color: '#475569' }}>
                  {aiFilteredMatch ? aiFilteredMatch.slice(aiPrompt.length) : getSuggestion(aiPrompt, aiHistory)}
                </span>
              </div>
            )}
            {aiError && (
              <div style={{ marginTop: '8px', padding: '8px', backgroundColor: '#3b1c1c', borderRadius: '4px', border: '1px solid #7f1d1d', color: '#fca5a5', fontSize: '13px' }}>
                ⚠ AI Error: {aiError}
              </div>
            )}
          </div>
          {aiLoading && <div className="ai-loader">Generating...</div>}
        </div>
      )}

      {showTaskInput && (
        <div className="task-input-container" style={{ backgroundColor: '#111111', padding: '8px 12px', borderBottom: '1px solid #222222', display: 'flex', gap: '8px' }}>
          <div style={{ position: 'relative', flex: 1, display: 'flex' }}>
            <input
              ref={taskInputRef}
              type="text"
              className="task-input"
              style={{ flex: 1, background: '#1e293b', border: '1px solid #334155', borderRadius: '4px', padding: '6px 12px', color: '#f1f5f9', fontSize: '13px', outline: 'none' }}
              placeholder={(taskFilteredMatch || getSuggestion(taskPrompt, taskHistory)) ? '' : 'Run manual command in background...'}
              value={taskPrompt}
              onChange={(e) => setTaskPrompt(e.target.value)}
              onKeyDown={async (e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  e.stopPropagation();
                  if (!taskPrompt.trim()) return;
                  addToHistory(taskPrompt, 'task');
                  handleRunBackground(taskPrompt);
                  setShowTaskInput(false);
                  setTaskPrompt('');
                  const session = getOrCreateSession(sessionId, cwd);
                  session.term.focus();
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  e.stopPropagation();
                  setShowTaskInput(false);
                  const session = getOrCreateSession(sessionId, cwd);
                  session.term.focus();
                } else if (['ArrowUp', 'ArrowDown', 'ArrowRight', 'Tab'].includes(e.key)) {
                  handleHistoryNav(e, 'task');
                }
              }}
            />
            {(taskFilteredMatch || getSuggestion(taskPrompt, taskHistory)) && (
              <div
                style={{
                  position: 'absolute',
                  left: 0,
                  top: 0,
                  right: 0,
                  bottom: 0,
                  padding: '0 12px',
                  display: 'flex',
                  alignItems: 'center',
                  pointerEvents: 'none',
                  fontSize: '13px'
                }}
              >
                <span style={{ color: 'transparent' }}>{taskPrompt}</span>
                <span style={{ color: '#64748b' }}>
                  {taskFilteredMatch ? taskFilteredMatch.slice(taskPrompt.length) : getSuggestion(taskPrompt, taskHistory)}
                </span>
              </div>
            )}
          </div>
          <small style={{ color: '#666', alignSelf: 'center' }}><b>↵</b> background</small>
        </div>
      )}

      {showRunEdit && (
        <div className="run-edit-container" style={{ backgroundColor: '#111111', padding: '8px 12px', borderBottom: '1px solid #222222', display: 'flex', gap: '8px' }}>
          <input
            ref={runEditRef}
            type="text"
            style={{ flex: 1, background: '#1e293b', border: '1px solid #334155', borderRadius: '4px', padding: '6px 12px', color: '#f1f5f9', fontSize: '13px', outline: 'none' }}
            placeholder="Command to run (e.g. ./start.sh)"
            value={runEditValue}
            onChange={(e) => setRunEditValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                e.stopPropagation();
                handleSaveRunCommand();
                const session = getOrCreateSession(sessionId, cwd);
                session.term.focus();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                setShowRunEdit(false);
                const session = getOrCreateSession(sessionId, cwd);
                session.term.focus();
              }
            }}
          />
          <small style={{ color: '#666', alignSelf: 'center' }}><b>↵</b> save &nbsp; <b>esc</b> cancel</small>
        </div>
      )}

      {showTaskViewer && (
        <div className="task-viewer-modal" style={{
          position: 'absolute',
          top: '40px',
          left: '20px',
          right: '20px',
          bottom: '20px',
          backgroundColor: '#0f172a',
          border: '1px solid #334155',
          borderRadius: '8px',
          zIndex: 100,
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5)'
        }}>
          <div style={{ padding: '4px 8px', borderBottom: '1px solid #334155', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ color: '#94a3b8', fontSize: '11px' }}>Task: <code style={{ color: '#e2e8f0' }}>{showTaskViewer.command}</code></span>
              {backgroundTasks.find(t => t.id === showTaskViewer.id)?.status === 'running' && (
                <button
                  onClick={async () => {
                    const success = await ipcRenderer.invoke('terminal.killBackground', { taskId: showTaskViewer.id });
                    if (success) {
                      removeTask(showTaskViewer.id);
                    }
                  }}
                  title="Kill Process"
                  style={{
                    marginLeft: '8px',
                    background: 'rgba(239,68,68,0.12)',
                    border: '1px solid rgba(239,68,68,0.3)',
                    fontSize: '12px',
                    padding: '0 4px',
                    lineHeight: '1.4',
                    borderRadius: '4px',
                    cursor: 'pointer'
                  }}
                >
                  🛑
                </button>
              )}
            </div>
            <button 
              onClick={dismissTaskViewer}
              style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: '18px' }}
            >
              ✕
            </button>
          </div>
          <div ref={taskTerminalRef} style={{ flex: 1, overflow: 'hidden', backgroundColor: '#000', padding: '8px' }} />
        </div>
      )}
      {diffViewer && (
        <DiffViewer
          diff={diffViewer}
          cwd={status.cwd}
          changedFiles={changedFiles}
          onClose={() => setDiffViewer(null)}
          onDiscard={async (file) => {
            const result = await ipcRenderer.invoke('terminal.discardFile', { cwd: status.cwd, file });
            if (!result.error) {
              setDiffViewer(null);
              ipcRenderer.invoke('terminal.refreshGitStatus', { sessionId });
            }
          }}
          onNext={async () => {
            const idx = changedFiles.findIndex(f => f.file === diffViewer.file);
            if (idx !== -1 && idx < changedFiles.length - 1) {
              const nextFile = changedFiles[idx + 1];
              const raw = await ipcRenderer.invoke('terminal.getFileDiff', { cwd: status.cwd, file: nextFile.file });
              if (raw) setDiffViewer({ file: nextFile.file, lines: raw.split('\n') });
            }
          }}
          onPrev={async () => {
            const idx = changedFiles.findIndex(f => f.file === diffViewer.file);
            if (idx > 0) {
              const prevFile = changedFiles[idx - 1];
              const raw = await ipcRenderer.invoke('terminal.getFileDiff', { cwd: status.cwd, file: prevFile.file });
              if (raw) setDiffViewer({ file: prevFile.file, lines: raw.split('\n') });
            }
          }}
        />
      )}
      <div
        ref={terminalRef}
        className="terminal-content"
        onMouseDown={() => onSetActive?.()}
        style={{
          flex: 1,
          width: '100%',
          minHeight: 0,
          paddingLeft: '8px',
          paddingRight: '8px',
          paddingBottom: '4px'
        }}
        onDragOver={e => e.preventDefault()}
        onDrop={e => {
          e.preventDefault();
          const files = Array.from(e.dataTransfer.files);
          if (!files.length) return;
          const paths = files.map(f => {
            const p = f.path;
            return p.includes(' ') ? `"${p}"` : p;
          }).join(' ');
          ipcRenderer.send('terminal.keystroke', { sessionId, data: paths });
        }}
      />
      {commandQueue.length > 0 && (
        <div className="queue-list" style={{ backgroundColor: '#111111', padding: '6px 12px', borderTop: '1px solid #222222', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
          <span style={{ color: '#64748b', fontSize: '11px' }}>Enqueued</span>
          {commandQueue.map((item) => (
            <span key={item.id} className="queue-btn" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
              ⏳ {item.cmd}
              <button
                type="button"
                title="Cancel"
                onClick={() => setCommandQueue(queue => queue.filter((q) => q.id !== item.id))}
                style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: 0, fontSize: '11px' }}
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      )}
      {showQueueInput && (
        <div className="queue-input-container" style={{ backgroundColor: '#111111', padding: '8px 12px', borderTop: '1px solid #222222', display: 'flex', gap: '8px', flexShrink: 0 }}>
          <div style={{ position: 'relative', flex: 1, display: 'flex' }}>
            <input
              ref={queueInputRef}
              type="text"
              className="queue-input"
              style={{ flex: 1, background: '#1e293b', border: '1px solid #334155', borderRadius: '4px', padding: '6px 12px', color: '#f1f5f9', fontSize: '13px', outline: 'none' }}
              placeholder={(queueFilteredMatch || getSuggestion(queuePrompt, taskHistory)) ? '' : 'Enqueue next command (runs when the current one finishes)...'}
              value={queuePrompt}
              onChange={(e) => { setQueuePrompt(e.target.value); setQueueFilteredMatch(null); setQueueHistoryIndex(-1); }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  e.stopPropagation();
                  if (!queuePrompt.trim()) return;
                  addToHistory(queuePrompt, 'task');
                  handleQueueCommand(queuePrompt);
                  setShowQueueInput(false);
                  setQueuePrompt('');
                  setQueueFilteredMatch(null);
                  setQueueHistoryIndex(-1);
                  const session = getOrCreateSession(sessionId, cwd);
                  session.term.focus();
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  e.stopPropagation();
                  setShowQueueInput(false);
                  setQueuePrompt('');
                  setQueueFilteredMatch(null);
                  setQueueHistoryIndex(-1);
                  const session = getOrCreateSession(sessionId, cwd);
                  session.term.focus();
                } else if (['ArrowUp', 'ArrowDown', 'ArrowRight', 'Tab'].includes(e.key)) {
                  handleHistoryNav(e, 'queue');
                }
              }}
            />
            {(queueFilteredMatch || getSuggestion(queuePrompt, taskHistory)) && (
              <div
                style={{
                  position: 'absolute',
                  left: 0,
                  top: 0,
                  right: 0,
                  bottom: 0,
                  padding: '0 12px',
                  display: 'flex',
                  alignItems: 'center',
                  pointerEvents: 'none',
                  fontSize: '13px'
                }}
              >
                <span style={{ color: 'transparent' }}>{queuePrompt}</span>
                <span style={{ color: '#64748b' }}>
                  {queueFilteredMatch ? queueFilteredMatch.slice(queuePrompt.length) : getSuggestion(queuePrompt, taskHistory)}
                </span>
              </div>
            )}
          </div>
          <small style={{ color: '#666', alignSelf: 'center' }}><b>↵</b> queue &nbsp; <b>⇥</b> complete</small>
        </div>
      )}


      {commitDialog && (
        <CommitDialog
          cwd={status.cwd}
          sessionId={sessionId}
          onRunBackground={handleRunBackground}
          onClose={() => setCommitDialog(false)}
          onDone={() => {
            setCommitDialog(false);
            ipcRenderer.invoke('terminal.refreshGitStatus', { sessionId });
          }}
        />
      )}
    </div>
  );
}

export default memo(TerminalPane);
