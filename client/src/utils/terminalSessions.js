import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';

const ipcRenderer = window.electron?.ipcRenderer;

// Map of sessionId -> { term, fitAddon, unsubscribe, sessionId }
const sessions = new Map();

export function getLastCommand(sessionId) {
  return sessions.get(sessionId)?.lastCommand || null;
}

export function getOrCreateSession(sessionId, cwd, lastCommand) {
  if (sessions.has(sessionId)) {
    return sessions.get(sessionId);
  }

  const container = document.createElement('div');
  container.className = 'xterm-container';
  container.style.width = '100%';
  container.style.height = '100%';

  const term = new Terminal({
    cursorBlink: true,
    cursorStyle: 'block',
    fontSize: 14,
    lineHeight: 1.2,
    fontFamily: '"JetBrains Mono", "Fira Code", "SF Mono", "Monaco", "Menlo", monospace',
    theme: {
      background: '#000000',
      foreground: '#ffffff',
      cursor: '#ffffff',
      selectionBackground: '#474747',
      black: '#000000',
      red: '#c0392b',
      green: '#27ae60',
      yellow: '#f39c12',
      blue: '#2980b9',
      magenta: '#8e44ad',
      cyan: '#06b6d4',
      white: '#ecf0f1',
      brightBlack: '#7f8c8d',
      brightRed: '#e74c3c',
      brightGreen: '#2ecc71',
      brightYellow: '#f1c40f',
      brightBlue: '#3498db',
      brightMagenta: '#9b59b6',
      brightCyan: '#22d3ee',
      brightWhite: '#ffffff'
    },
    scrollback: 10000,
    scrollOnOutput: true,
    scrollOnUserInput: true,
    allowProposedApi: true
  });
  
  const fitAddon = new FitAddon();
  term.loadAddon(fitAddon);

  const searchAddon = new SearchAddon();
  term.loadAddon(searchAddon);

  // Initial open into our detached container
  term.open(container);

  // Start PTY for this session
  ipcRenderer.send('terminal.start', { sessionId, cwd });
  
  // ... (rest same)
  let outputIdleTimeout = null;
  const onOutput = (event, data) => {
    term.write(data);
    if (outputIdleTimeout) clearTimeout(outputIdleTimeout);
    outputIdleTimeout = setTimeout(() => {
      ipcRenderer.invoke('app.forceCwdUpdate', { sessionId }).catch(() => {});
    }, 800);
  };
  const channelId = `terminal-output-${sessionId}`;
  const unsubscribe = ipcRenderer.on(channelId, onOutput);

  let cmdBuffer = '';
  let cmdSaveTimeout = null;
  const onDataDispose = term.onData(data => {
    ipcRenderer.send('terminal.keystroke', { sessionId, data });
    if (data === '\r') {
      // On Enter: verify command by cross-checking history with what we tracked
      if (cmdSaveTimeout) clearTimeout(cmdSaveTimeout);
      const typedCmd = cmdBuffer.trim();
      cmdSaveTimeout = setTimeout(async () => {
        const historyCmd = await ipcRenderer.invoke('app.getLastShellCommand');

        // Double-check: does history match what was typed (or is an expansion of it)?
        let cmdToSave = null;
        if (historyCmd && typedCmd) {
          if (historyCmd === typedCmd) {
            // Exact match
            cmdToSave = historyCmd;
            console.log('[session] command matched (exact):', cmdToSave);
          } else if (historyCmd.startsWith(typedCmd)) {
            // History is expansion of what was typed (e.g., tab completion)
            cmdToSave = historyCmd;
            console.log('[session] command matched (expansion):', cmdToSave);
          } else {
            console.log('[session] command mismatch — typed:', typedCmd, 'history:', historyCmd);
          }
        } else if (typedCmd) {
          // No history found, use what we tracked
          cmdToSave = typedCmd;
          console.log('[session] using tracked command (no history match):', cmdToSave);
        }

        if (cmdToSave) {
          session.lastCommand = cmdToSave;
          window.dispatchEvent(new CustomEvent('session:commandTracked'));
        }
        ipcRenderer.invoke('app.forceCwdUpdate', { sessionId }).catch(() => {});
        cmdSaveTimeout = null;
      }, 200); // Delay to let shell write to history

      cmdBuffer = '';
    } else if (data === '\x7f') {
      // Backspace
      cmdBuffer = cmdBuffer.slice(0, -1);
    } else if (data >= ' ') {
      // Printable character
      cmdBuffer += data;
    }
  });

  if (lastCommand) {
    let injectTimer = null;
    const injectOnQuiet = ipcRenderer.on(`terminal-output-${sessionId}`, () => {
      if (injectTimer) clearTimeout(injectTimer);
      injectTimer = setTimeout(() => {
        injectOnQuiet();
        // Only restore AI interactive tools (claude, gemini, copilot, codex)
        const aiTools = ['claude', 'gemini', 'copilot', 'codex'];
        const isAiTool = aiTools.some(tool => lastCommand.trim().startsWith(tool));

        if (isAiTool) {
          console.log('[session] injecting AI tool:', lastCommand);
          // Pre-save for next session
          session.lastCommand = lastCommand;
          window.dispatchEvent(new CustomEvent('session:commandTracked'));
          // Inject command
          ipcRenderer.send('terminal.keystroke', { sessionId, data: lastCommand });
          // Auto-execute after 500ms
          setTimeout(() => {
            console.log('[session] auto-executing AI tool:', lastCommand);
            ipcRenderer.send('terminal.keystroke', { sessionId, data: '\n' });
          }, 500);
        }
      }, 1500);
    });
  }

  const session = {
    term,
    fitAddon,
    searchAddon,
    container,
    lastCommand: null,
    rerunTimeout: null,
    status: { folder: '', branch: '', cwd: '' },
    unsubscribe: () => {
      if (outputIdleTimeout) clearTimeout(outputIdleTimeout);
      if (cmdSaveTimeout) clearTimeout(cmdSaveTimeout);
      unsubscribe();
      onDataDispose.dispose();
      statusUnsubscribe();
    },
    sessionId
  };

  // Status updates
  const statusUnsubscribe = ipcRenderer.on(`terminal-status-${sessionId}`, (event, status) => {
    session.status = status;
    // Notify any listeners if needed, but for now we'll rely on React polling/rendering
    if (session.onStatusChange) session.onStatusChange(status);
  });

  sessions.set(sessionId, session);
  return session;
}

export function getSession(sessionId) {
  return sessions.get(sessionId) || null;
}

export function destroySession(sessionId) {
  const session = sessions.get(sessionId);
  if (session) {
    session.unsubscribe();
    session.term.dispose();
    ipcRenderer.send('terminal.close', { sessionId });
    sessions.delete(sessionId);
  }
}

export function resizeSession(sessionId, cols, rows) {
  const session = sessions.get(sessionId);
  if (session && cols > 0 && rows > 0) {
    ipcRenderer.send('terminal.resize', { sessionId, cols, rows });
  }
}

export function scheduleRerun(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) return;
  if (session.rerunTimeout) clearTimeout(session.rerunTimeout);
  ipcRenderer.send('terminal.keystroke', { sessionId, data: '\x03\x15\x1b[A' });
  session.rerunTimeout = setTimeout(() => {
    session.rerunTimeout = null;
    ipcRenderer.send('terminal.keystroke', { sessionId, data: '\r' });
  }, 1000);
}

export function cancelRerun(sessionId) {
  const session = sessions.get(sessionId);
  if (!session?.rerunTimeout) return;
  clearTimeout(session.rerunTimeout);
  session.rerunTimeout = null;
  ipcRenderer.send('terminal.keystroke', { sessionId, data: '\x15' }); // clear recalled command
}


export function getSessionCwd(sessionId) {
  const session = sessions.get(sessionId);
  return session?.status?.cwd || null;
}

export function getSessionStatus(sessionId) {
  const session = sessions.get(sessionId);
  return session?.status || null;
}

