import { app, BrowserWindow, ipcMain, Menu, shell, globalShortcut, dialog, Notification, clipboard, net, powerMonitor } from 'electron';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { verifyCommandString } from './utils/commandParser.js';

function writeCrashLog(type, err) {
  try {
    let logDir;
    try { logDir = app.getPath('logs'); } catch { logDir = path.join(os.homedir(), 'Library', 'Logs'); }
    const logFile = path.join(logDir, 'crash.log');
    fs.mkdirSync(logDir, { recursive: true });
    const entry = [
      `\n=== ${type} @ ${new Date().toISOString()} ===`,
      `Message: ${err?.message || String(err)}`,
      `Stack:\n${err?.stack || '(no stack)'}`,
      `pid=${process.pid} platform=${process.platform} arch=${process.arch}`,
      `node=${process.version} electron=${process.versions?.electron || 'unknown'}`,
      '==='
    ].join('\n');
    fs.appendFileSync(logFile, entry + '\n');
  } catch (_) {}
}

function writeDebugLog(msg) {
  try {
    const logFile = path.join(app.getPath('userData'), 'debug.log');
    fs.appendFileSync(logFile, `[${new Date().toISOString()}] ${msg}\n`);
  } catch (_) {}
}

// Block polling during sleep and for a grace period after wake to avoid
// hammering launchd's Mach port namespace all at once on resume
let systemSleeping = false;
let wakeGraceUntil = 0;
const WAKE_GRACE_MS = 15000; // 15s after wake before polling resumes

function pollingAllowed() {
  if (systemSleeping) return false;
  if (Date.now() < wakeGraceUntil) return false;
  return true;
}

process.on('uncaughtException', (err) => {
  writeCrashLog('uncaughtException', err);
});

process.on('unhandledRejection', (reason) => {
  writeCrashLog('unhandledRejection', reason instanceof Error ? reason : new Error(String(reason)));
});

function getLastShellCommand() {
  try {
    const home = os.homedir();
    const zshHistory = path.join(home, '.zsh_history');
    const bashHistory = path.join(home, '.bash_history');

    // Try zsh history first (format: ": timestamp:0;command")
    if (fs.existsSync(zshHistory)) {
      const content = fs.readFileSync(zshHistory, 'utf-8');
      const lines = content.split('\n').reverse();
      for (const line of lines) {
        const match = line.match(/^:\s*\d+:\d+;(.+)$/);
        if (match && match[1].trim()) return match[1].trim();
      }
    }

    // Fall back to bash history (one command per line)
    if (fs.existsSync(bashHistory)) {
      const content = fs.readFileSync(bashHistory, 'utf-8');
      const lines = content.split('\n').reverse();
      for (const line of lines) {
        if (line.trim()) return line.trim();
      }
    }
  } catch (e) { console.error('[history] read error:', e); }
  return null;
}
import { exec as _exec } from 'node:child_process';
import { promisify } from 'node:util';
import { spawn } from 'node-pty';
import { fileURLToPath } from 'url';
const execAsync = promisify(_exec);

// Pick a shell that exists on this machine: $SHELL, then zsh/bash, then sh
function getDefaultShell() {
  if (os.platform() === 'win32') return 'powershell.exe';
  const candidates = [process.env.SHELL, '/bin/zsh', '/usr/bin/zsh', '/bin/bash', '/usr/bin/bash', '/bin/sh'];
  return candidates.find((c) => c && fs.existsSync(c)) || '/bin/sh';
}

let ghPath = null;
let pendingQueuedGitAction = null; // Store queued git action { cwd, files, push, pullFirst } until message is ready

async function findGhPath() {
  if (ghPath) return ghPath;
  // 1. Check known Homebrew/system install paths first (fast, no subprocess)
  const knownPaths = ['/opt/homebrew/bin/gh', '/usr/local/bin/gh', '/usr/bin/gh'];
  for (const p of knownPaths) {
    if (fs.existsSync(p)) {
      ghPath = p;
      writeDebugLog(`Found gh at: ${ghPath}`);
      return ghPath;
    }
  }
  // 2. Fall back to login shell lookup (sources profile so PATH is complete)
  // Try shells in order: bash (most portable), then zsh, then fish
  const shells = ['/bin/bash', '/bin/zsh', '/bin/fish'];
  for (const shell of shells) {
    try {
      const { stdout } = await execAsync(`${shell} -l -c 'which gh'`, { timeout: 2000 });
      ghPath = stdout.trim();
      if (ghPath) {
        writeDebugLog(`Found gh via ${shell} at: ${ghPath}`);
        return ghPath;
      }
    } catch (e) {
      // Continue to next shell if this one fails
    }
  }
  writeDebugLog(`Could not find gh in known paths or via login shells`);
  ghPath = 'gh';
  return ghPath;
}

let serverPort = 0;
const windowInitialCwds = new Map();
let pendingPath = null;
const sessionFile = path.join(app.getPath('userData'), app.isPackaged ? 'session.json' : 'session.dev.json');
let sessionRestored = false; // only the first window on launch gets the saved session
const sessionCwds = new Map(); // sessionId -> current cwd (updated by lsof polling)
let mainWindow = null; // first window created — the only one whose session is persisted

// Handle files/folders dropped on app icon or opened via "Open with"
app.on('open-file', (event, path) => {
  event.preventDefault();
  if (fs.existsSync(path) && fs.statSync(path).isDirectory()) {
    if (app.isReady()) {
      createWindow(path);
    } else {
      pendingPath = path;
    }
  }
});

// Handle command line arguments
const args = process.argv.slice(app.isPackaged ? 1 : 2);
if (args.length > 0 && fs.existsSync(args[0]) && fs.statSync(args[0]).isDirectory()) {
  pendingPath = args[0];
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Packaged builds run the bundle from <app>/out/, so resources live one level up
const appRoot = app.isPackaged ? path.join(__dirname, '..') : __dirname;

// Map of sessionId -> { ptyProcess, webContents, scrollback }
const ptySessions = new Map();
// Cap on bytes of scrollback retained per session for mobile clients attaching mid-session.
const SCROLLBACK_LIMIT = 200 * 1024;

// Map of taskId -> { command, output, status, exitCode, startTime, endTime }
const backgroundTasks = new Map();

ipcMain.on('app.logRendererError', (event, { message, stack }) => {
  writeCrashLog('renderer-js-error', { message, stack });
});

ipcMain.handle('app.playSound', () => {
  if (process.platform === 'darwin') {
    _exec('afplay /System/Library/Sounds/Funk.aiff');
  }
});

ipcMain.handle('terminal.removeBackgroundTask', (event, { taskId }) => {
  backgroundTasks.delete(taskId);
  return true;
});

ipcMain.handle('terminal.viewBackgroundTask', (event, { taskId }) => {
  const task = backgroundTasks.get(taskId);
  if (task) {
    task.viewed = true;
    return true;
  }
  return false;
});

ipcMain.handle('terminal.killBackground', (event, { taskId }) => {
  const task = backgroundTasks.get(taskId);
  if (task && task.ptyProcess && task.status === 'running') {
    task.killedByUser = true;
    // Try graceful SIGINT first, then SIGKILL
    task.ptyProcess.kill('SIGKILL');
    task.status = 'finished';
    task.exitCode = -1;
    task.endTime = Date.now();
    return true;
  }
  return false;
});

// The wrapper shell reports a killed child as 128+signal (HUP/INT/KILL/TERM) with no signal field
const isSignalExitCode = (code) => code < 0 || (code > 128 && code <= 159);
// Wrappers (npm, concurrently) often turn an external SIGTERM into exit 1, so also look for a signal in the output tail
const outputShowsSignal = (output) => /\b(SIG(TERM|INT|KILL|HUP)|Terminated|Killed)\b/.test(String(output || '').slice(-600));

// Linux: /proc/<pid>/cwd is a symlink to the process's cwd (no lsof needed).
// Prefer the most recently started child of the shell (e.g. an interactive tool run inside it),
// matching the macOS behaviour, and fall back to the shell itself.
function getLinuxProcessCwd(shellPid) {
  const readCwd = (pid) => {
    try {
      const cwd = fs.readlinkSync(`/proc/${pid}/cwd`);
      return cwd && fs.existsSync(cwd) ? cwd : '';
    } catch (_) { return ''; }
  };
  try {
    const children = fs.readFileSync(`/proc/${shellPid}/task/${shellPid}/children`, 'utf8').trim().split(/\s+/).filter(Boolean);
    for (let i = children.length - 1; i >= 0; i--) {
      const cwd = readCwd(children[i]);
      if (cwd) return cwd;
    }
  } catch (_) {}
  return readCwd(shellPid);
}

// Shared timeout for status-polling subprocesses (cwd lookup, command/memory detection)
const POLL_TIMEOUT = { timeout: 3000 };

async function getSessionProcessCwd(ptyProcess) {
  if (!ptyProcess?.pid) return '';
  if (os.platform() === 'linux') return getLinuxProcessCwd(ptyProcess.pid);
  if (os.platform() !== 'darwin') return '';

  // 1. Check if there are active child processes (e.g. interactive AI tools like Claude, node, python)
  try {
    const { stdout: childPids } = await execAsync(`pgrep -P ${ptyProcess.pid} 2>/dev/null || true`, POLL_TIMEOUT);
    const pids = childPids.trim().split('\n').filter(Boolean);
    if (pids.length > 0) {
      // Check backwards from the most recent child process
      for (let i = pids.length - 1; i >= 0; i--) {
        const pid = pids[i];
        try {
          const { stdout: lsofOut } = await execAsync(`lsof -p ${pid} -a -d cwd -Fn 2>/dev/null`, POLL_TIMEOUT);
          const childCwd = lsofOut.split('\n').find(l => l.startsWith('n'))?.slice(1).trim() || '';
          if (childCwd && fs.existsSync(childCwd)) {
            return childCwd;
          }
        } catch (_) {}
      }
    }
  } catch (_) {}

  // 2. Fall back to parent PTY process
  try {
    const { stdout: lsofOut } = await execAsync(`lsof -p ${ptyProcess.pid} -a -d cwd -Fn 2>/dev/null`, POLL_TIMEOUT);
    const cwd = lsofOut.split('\n').find(l => l.startsWith('n'))?.slice(1).trim() || '';
    if (cwd && fs.existsSync(cwd)) {
      return cwd;
    }
  } catch (_) {}

  return '';
}

ipcMain.handle('terminal.runBackground', async (event, { command, cwd, sessionId, taskId: providedTaskId }) => {
  const taskId = providedTaskId || globalThis.crypto.randomUUID();
  const webContents = event.sender;
  
  try {
    const shell = getDefaultShell();
    // Use an interactive login shell to ensure aliases and .zshrc are loaded
    // Append "; exit" to ensure the shell closes immediately after the command finishes
    const shellArgs = os.platform() === 'win32' ? ['-Command', `${command}; exit`] : ['-i', '-l', '-c', `${command}; exit`];
    
    let resolvedCwd = cwd;
    if (sessionId && ptySessions.has(sessionId)) {
      const liveCwd = await getSessionProcessCwd(ptySessions.get(sessionId).ptyProcess);
      if (liveCwd && fs.existsSync(liveCwd)) {
        resolvedCwd = liveCwd;
        sessionCwds.set(sessionId, liveCwd);
      }
    }
    resolvedCwd = (resolvedCwd && fs.existsSync(resolvedCwd)) ? resolvedCwd : (sessionCwds.get(sessionId) || os.homedir());

    const ptyProcess = spawn(shell, shellArgs, {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd: resolvedCwd,
      env: process.env
    });

    const task = {
      id: taskId,
      sessionId, // Track which session started this task
      command,
      output: '',
      status: 'running',
      startTime: Date.now(),
      exitCode: null,
      viewed: false, // Track if user has seen the result
      ptyProcess // Store the process to kill it later
    };

    backgroundTasks.set(taskId, task);

    const MAX_TASK_OUTPUT = 2 * 1024 * 1024; // 2 MB cap per background task
    ptyProcess.onData((data) => {
      if (task.output.length < MAX_TASK_OUTPUT) {
        task.output += data;
      }
      BrowserWindow.getAllWindows().forEach(win => {
        if (!win.isDestroyed()) {
          win.webContents.send(`background-task-update-${taskId}`, { output: data });
        }
      });
    });

    ptyProcess.onExit(({ exitCode, signal }) => {
      task.status = 'finished';
      task.exitCode = exitCode ?? (signal ? -1 : 0);
      task.endTime = Date.now();
      const wasKilled = !!signal || task.killedByUser || isSignalExitCode(exitCode) || (exitCode !== 0 && outputShowsSignal(task.output));

      BrowserWindow.getAllWindows().forEach(win => {
        if (!win.isDestroyed()) {
          win.webContents.send(`background-task-finished-${taskId}`, {
            exitCode: task.exitCode,
            duration: Math.floor((task.endTime - task.startTime) / 1000),
            wasKilled
          });
        }
      });

      if (settings.notifyOnCommandEnd && !wasKilled) {
        new Notification({
          title: task.exitCode === 0 ? 'Task Succeeded' : 'Task Failed',
          body: `"${command}" finished with code ${task.exitCode}`,
          silent: false
        }).show();
      }
    });

    return taskId;
  } catch (err) {
    console.error('[Background] Failed to start:', err);
    throw err;
  }
});

ipcMain.handle('terminal.viewBackground', (event, { taskId }) => {
  const task = backgroundTasks.get(taskId);
  if (task) {
    task.viewed = true;
    return true;
  }
  return false;
});

ipcMain.handle('terminal.getBackgroundTask', (event, { taskId }) => {
  const task = backgroundTasks.get(taskId);
  if (!task) return null;
  // Return a serializable version of the task
  const { ptyProcess, ...serializableTask } = task;
  return serializableTask;
});

ipcMain.handle('terminal.getAllBackgroundTasks', (event, { sessionId } = {}) => {
  let tasks = Array.from(backgroundTasks.values());
  if (sessionId) {
    tasks = tasks.filter(t => t.sessionId === sessionId);
  }
  return tasks.map(task => {
    const { ptyProcess, ...serializableTask } = task;
    return serializableTask;
  });
});

// Settings management
const settingsFile = path.join(app.getPath('userData'), 'settings.json');
let settings = {
  globalHotkey: 'CommandOrControl+Shift+T',
  rerunShortcut: 'CommandOrControl+R',
  confirmOnQuit: false,
  excludeDangerousRerun: true,
  notifyOnCommandEnd: true,
  notificationThreshold: 120,
  geminiToken: '',
  restoreSession: true,
  ghDesktopShortcut: '',
  vscodeShortcut: '',
  intellijShortcut: '',
  finderShortcut: '',
  commitShortcut: '',
  runShortcut: 'CommandOrControl+S',
  runCommands: {}
};

function loadSettings() {
  try {
    if (fs.existsSync(settingsFile)) {
      const content = fs.readFileSync(settingsFile, 'utf-8');
      if (content.trim()) {
        settings = { ...settings, ...JSON.parse(content) };
      }
    }
  } catch (e) {
    console.error('[Main] Failed to load settings:', e);
  }
}

function saveSettings() {
  try {
    fs.writeFileSync(settingsFile, JSON.stringify(settings), 'utf-8');
  } catch (e) {
    console.error('[Main] Failed to save settings:', e);
  }
}

function registerGlobalHotkey() {
  globalShortcut.unregisterAll();
  if (settings.globalHotkey) {
    try {
      const success = globalShortcut.register(settings.globalHotkey, () => {
        toggleAppVisibility();
      });
      if (!success) {
        console.error(`[Main] Failed to register hotkey: ${settings.globalHotkey}`);
      }
    } catch (e) {
      console.error(`[Main] Error registering hotkey:`, e);
    }
  }
}

function toggleAppVisibility() {
  const allWindows = BrowserWindow.getAllWindows();
  if (allWindows.length === 0) {
    createWindow();
    return;
  }

  const anyFocused = allWindows.some(win => win.isFocused());

  if (anyFocused) {
    allWindows.forEach(win => win.hide());
    if (process.platform === 'darwin') {
      app.hide();
    }
  } else {
    allWindows.forEach(win => {
      win.show();
      win.focus();
    });
    if (process.platform === 'darwin') {
      app.focus({ steal: true });
    }
  }
}

// Window state management
const stateFile = path.join(app.getPath('userData'), 'window-state.json');
const windows = new Set();

function loadWindowState() {
  try {
    if (fs.existsSync(stateFile)) {
      const content = fs.readFileSync(stateFile, 'utf-8');
      if (!content.trim()) return { width: 1200, height: 800 };
      const data = JSON.parse(content);
      return data;
    }
  } catch (e) {
    console.error('[Main] Failed to load window state:', e);
  }
  return { width: 1200, height: 800 };
}

function saveWindowState(win) {
  if (!win || win.isDestroyed()) return;
  try {
    const bounds = win.getBounds();
    const isMaximized = win.isMaximized();
    const state = { ...bounds, isMaximized };
    fs.writeFileSync(stateFile, JSON.stringify(state), 'utf-8');
  } catch (e) {
    console.warn('[Main] Could not save window state');
  }
}

// Lazy-loaded heavy modules, imported once
let _findUp, _git, _fsExtra;
async function lazyImports() {
  if (!_findUp) _findUp = (await import('find-up')).findUp;
  if (!_git) _git = (await import('isomorphic-git')).default;
  if (!_fsExtra) _fsExtra = (await import('fs-extra')).default;
}

// Shared git cache per repo root — all panes in the same repo share one result
// Key: repo root path, Value: { branch, gitStats, updatedAt }
const gitCache = new Map();
const GIT_CACHE_TTL = 8000; // slightly under poll interval so each poll gets fresh data

// Deeply clone and sanitize objects for IPC serialization
function deepSanitize(obj, depth = 0) {
  if (depth > 10) return null; // Prevent deep recursion
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'string' || typeof obj === 'number' || typeof obj === 'boolean') return obj;
  if (typeof obj === 'object') {
    if (Array.isArray(obj)) {
      return obj.map(item => deepSanitize(item, depth + 1));
    }
    const result = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = deepSanitize(value, depth + 1);
    }
    return result;
  }
  return String(obj);
}

// Validate that an object is serializable for IPC
function validateSerializable(obj, handlerName = 'unknown') {
  try {
    const json = JSON.stringify(obj);
    return true;
  } catch (e) {
    console.error(`[IPC] Non-serializable object in ${handlerName}:`, e.message);
    console.error('[IPC] Object:', obj);
    return false;
  }
}

// Ensure status object is serializable (no Error objects, functions, circular refs, etc)
function sanitizeStatus(status) {
  return {
    cwd: String(status.cwd || ''),
    branch: status.branch ? String(status.branch) : null,
    folder: String(status.folder || ''),
    command: status.command ? String(status.command) : null,
    gitStats: status.gitStats ? {
      files: Number(status.gitStats.files) || 0,
      insertions: Number(status.gitStats.insertions) || 0,
      deletions: Number(status.gitStats.deletions) || 0
    } : null,
    pr: status.pr ? {
      number: Number(status.pr.number) || 0,
      url: String(status.pr.url || ''),
      title: String(status.pr.title || '')
    } : null,
    isBehindRemote: Boolean(status.isBehindRemote),
    memoryMB: Number(status.memoryMB) || 0
  };
}

// Nearest ancestor containing .git
function findGitRoot(startDir) {
  let dir = startDir;
  while (true) {
    if (fs.existsSync(path.join(dir, '.git'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

async function getGitInfo(repoRoot) {
  const cached = gitCache.get(repoRoot);
  if (cached && Date.now() - cached.updatedAt < GIT_CACHE_TTL) return cached;

  let branch = null, gitStats = null, isBehindRemote = false;
  try { branch = await _git.currentBranch({ fs: _fsExtra, dir: repoRoot }); } catch (e) {}
  if (!branch) {
    try { branch = (await execAsync(`git --no-optional-locks symbolic-ref --short -q HEAD`, { cwd: repoRoot, timeout: 5000 })).stdout.trim() || null; } catch (e) {}
  }
  try {
    const [{ stdout: diffSummary }, { stdout: statusOut }] = await Promise.all([
      execAsync(`git --no-optional-locks diff HEAD --shortstat`, { cwd: repoRoot, timeout: 5000 }),
      execAsync(`git --no-optional-locks status --porcelain`, { cwd: repoRoot, timeout: 5000 })
    ]);
    const untracked = (statusOut.match(/^\?\?/gm) || []).length;
    const files = parseInt(diffSummary.match(/(\d+) file/)?.[1] ?? 0) + untracked;
    gitStats = files > 0 ? {
      files,
      insertions: parseInt(diffSummary.match(/(\d+) insertion/)?.[1] ?? 0),
      deletions: parseInt(diffSummary.match(/(\d+) deletion/)?.[1] ?? 0)
    } : null;
  } catch (e) {}

  // Check if local branch is behind remote
  if (branch) {
    try {
      const { stdout: behindOut } = await execAsync(`git rev-list --count HEAD..origin/${branch} 2>/dev/null || echo 0`, { cwd: repoRoot, timeout: 5000 });
      const behindCount = parseInt(behindOut.trim()) || 0;
      isBehindRemote = behindCount > 0;
    } catch (e) {}
  }

  const result = { branch, gitStats, isBehindRemote, updatedAt: Date.now() };
  gitCache.set(repoRoot, result);
  return result;
}

// PR check runs every N polls, not every poll
const PR_CHECK_INTERVAL = 6; // every ~60s at 10s poll rate
const prPollCounters = new Map(); // sessionId -> counter

async function updateSessionStatus(sessionId) {
  const session = ptySessions.get(sessionId);
  if (!session) return;
  const { ptyProcess, webContents } = session;

  // Skip if window is hidden/minimized — no need to update UI
  const win = BrowserWindow.fromWebContents(webContents);
  if (!win || win.isDestroyed() || !win.isVisible()) return;

  // Guard against concurrent polls and polls during sleep/wake
  if (session.polling) return;
  if (!pollingAllowed()) return;
  session.polling = true;

  try {
    if (os.platform() !== 'darwin' && os.platform() !== 'linux') return;

    const shellCwd = await getSessionProcessCwd(ptyProcess);
    if (!shellCwd) return;

    sessionCwds.set(sessionId, shellCwd);
    session.lastCwd = shellCwd;
    console.log('[cwd] updated for', sessionId, ':', shellCwd);

    const cwd = shellCwd;

    let branch = session.lastBranch ?? null;
    let gitStats = session.lastGitStats ?? null;
    let isBehindRemote = session.lastIsBehindRemote ?? false;
    let pr = session.lastPr ?? null;
    let command = null;

    // Send immediate status with cached data so UI doesn't show blanks
    if (webContents && !webContents.isDestroyed()) {
      const statusObj = sanitizeStatus({
        cwd, branch, folder: path.basename(cwd), command: session.runningCommand || null, gitStats, pr, isBehindRemote, memoryMB: session.lastMemoryMB || 0
      });
      webContents.send(`terminal-status-${sessionId}`, statusObj);
    }

    await lazyImports();
    const root = findGitRoot(cwd);
    if (root) {
      session.gitRoot = root; // Store git root for PR checks
      const info = await getGitInfo(root);
      branch = info.branch;
      gitStats = info.gitStats;
      isBehindRemote = info.isBehindRemote || false;
    } else {
      branch = null; gitStats = null; isBehindRemote = false; pr = null;
      session.gitRoot = null;
    }

    const branchChanged = branch !== session.lastBranch;
    if (branchChanged) {
      pr = null;
      session.lastPr = null;
      prPollCounters.set(sessionId, 0);
    }
    session.lastBranch = branch;
    session.lastGitStats = gitStats;
    session.lastIsBehindRemote = isBehindRemote;

    // PR check: immediately on first poll or branch change, then every N polls
    const prCounter = (prPollCounters.get(sessionId) ?? 0) + 1;
    prPollCounters.set(sessionId, prCounter);
    if (prCounter === 1 && branch) {
      writeDebugLog(`Session ${sessionId}: checking PR on first poll`);
    } else if (prCounter > 1 && prCounter % PR_CHECK_INTERVAL === 0) {
      writeDebugLog(`Session ${sessionId}: periodic PR check (poll ${prCounter})`);
    }
    if ((prCounter === 1 || prCounter >= PR_CHECK_INTERVAL) && branch) {
      prPollCounters.set(sessionId, 1);
      try {
        const prCwd = session.gitRoot || cwd; // Use git root if available
        const ghBin = await findGhPath();
        const { stdout: prJson } = await execAsync(`${ghBin} pr view --json number,url,title`, { cwd: prCwd, timeout: 8000 });
        pr = prJson.trim() ? JSON.parse(prJson) : null;
        if (pr) {
          writeDebugLog(`PR found for branch ${branch}: #${pr.number} (from ${prCwd})`);
        } else {
          writeDebugLog(`No PR for branch ${branch} from ${prCwd} (gh returned empty)`);
        }
      } catch (e) {
        const msg = e.message || String(e);
        writeDebugLog(`PR check failed for branch ${branch}: ${msg.slice(0, 150)}`);
        pr = null;
      }
      session.lastPr = pr;
    }

    // Command detection + memory — scoped to PTY children only (avoids global ps -axo)
    let memoryMB = 0;
    try {
      const { stdout: childPids } = await execAsync(`pgrep -P ${ptyProcess.pid} 2>/dev/null || true`, POLL_TIMEOUT);
      const pids = childPids.trim().split('\n').filter(Boolean);
      const { stdout: selfRss } = await execAsync(`ps -p ${ptyProcess.pid} -o rss= 2>/dev/null`, POLL_TIMEOUT);
      let totalRss = parseInt(selfRss) || 0;
      if (pids.length > 0) {
        const pidList = pids.join(',');
        const { stdout: childPs } = await execAsync(`ps -p ${pidList} -o pid=,rss=,comm= 2>/dev/null || true`, POLL_TIMEOUT);
        const children = childPs.trim().split('\n').filter(Boolean).map(l => {
          const p = l.trim().split(/\s+/);
          return { pid: p[0], rss: parseInt(p[1]) || 0, comm: p[2] || '' };
        });
        totalRss += children.reduce((s, p) => s + p.rss, 0);
        if (children.length > 0) {
          const last = children[children.length - 1];
          const baseComm = path.basename(last.comm);
          const shellNames = ['zsh', 'bash', 'sh', 'fish', 'login', 'sudo'];
          if (baseComm && !shellNames.includes(baseComm)) command = baseComm;
        }
      }
      memoryMB = Math.round(totalRss / 1024);
      session.lastMemoryMB = memoryMB;
    } catch (e) {}

    if (webContents && !webContents.isDestroyed()) {
      if (settings.notifyOnCommandEnd && session.runningCommand && !command) {
        const duration = Math.floor((Date.now() - session.commandStartTime) / 1000);
        if (duration >= settings.notificationThreshold) {
          new Notification({
            title: 'Command Finished',
            body: `"${session.runningCommand}" completed in ${path.basename(cwd)} after ${duration}s`,
            silent: false
          }).show();
        }
      }
      if (command && !session.runningCommand) session.commandStartTime = Date.now();
      session.runningCommand = command;

      const statusObj = sanitizeStatus({
        cwd, branch, folder: path.basename(cwd), command, gitStats, pr, isBehindRemote, memoryMB
      });
      if (ptySessions.has(sessionId)) webContents.send(`terminal-status-${sessionId}`, statusObj);
    }
  } catch (err) {
  } finally {
    session.polling = false;
  }
}

function setupMenu() {
  const template = [
    ...(os.platform() === 'darwin' ? [{
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        {
          label: 'Settings...',
          accelerator: 'CmdOrCtrl+,',
          click: (menuItem, browserWindow) => {
            if (browserWindow) browserWindow.webContents.send('menu.settings');
          }
        },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        {
          label: 'Quit GitTerminal',
          accelerator: 'Cmd+Q',
          click: () => {
            app.quit();
          }
        }
      ]
    }] : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'New Window',
          accelerator: 'CmdOrCtrl+N',
          click: () => createWindow()
        },
        ...(os.platform() !== 'darwin' ? [
          { type: 'separator' },
          {
            label: 'Settings...',
            accelerator: 'CmdOrCtrl+,',
            click: (menuItem, browserWindow) => {
              if (browserWindow) browserWindow.webContents.send('menu.settings');
            }
          }
        ] : []),
        { type: 'separator' },
        { 
          role: 'close',
          accelerator: 'CmdOrCtrl+W'
        }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        // Ctrl+A is "start of line" in a shell, so only macOS uses the bare Cmd+A
        {
          label: 'Select All',
          accelerator: process.platform === 'darwin' ? 'Cmd+A' : 'Ctrl+Shift+A',
          click: (menuItem, browserWindow) => {
            if (browserWindow) browserWindow.webContents.send('menu.selectAll');
          }
        }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        ...(os.platform() === 'darwin' ? [
          {
            label: 'Next Window',
            accelerator: 'Cmd+`',
            click: () => {
              const allWindows = BrowserWindow.getAllWindows();
              if (allWindows.length <= 1) return;
              
              const focusedWindow = BrowserWindow.getFocusedWindow();
              let nextWindowIndex = 0;
              
              if (focusedWindow) {
                const currentIndex = allWindows.indexOf(focusedWindow);
                nextWindowIndex = (currentIndex + 1) % allWindows.length;
              }
              
              const nextWindow = allWindows[nextWindowIndex];
              nextWindow.show();
              nextWindow.focus();
            }
          },
          { type: 'separator' },
          { role: 'front' },
          { type: 'separator' },
          { role: 'window' }
        ] : [
          { role: 'close' }
        ])
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

function createWindow(cwd = null) {
  const state = loadWindowState();
  
  // Default values
  let x = state.x;
  let y = state.y;
  const MIN_WIDTH = 400;
  const MIN_HEIGHT = 300;
  const width = (state.width >= MIN_WIDTH) ? state.width : 1200;
  const height = (state.height >= MIN_HEIGHT) ? state.height : 800;

  // Find the base window to offset from
  const allWindows = BrowserWindow.getAllWindows();
  if (allWindows.length > 0) {
    // Offset from the most recently active or any existing window
    const baseWin = BrowserWindow.getFocusedWindow() || allWindows[0];
    if (baseWin && !baseWin.isDestroyed()) {
      const bounds = baseWin.getBounds();
      x = bounds.x + 100;
      y = bounds.y + 100;
    }
  }

  // If we ended up too far down/right, or if no base window, center it
  if (x === undefined || y === undefined) {
    x = undefined; // Let Electron center it
    y = undefined;
  }

  const win = new BrowserWindow({
    x,
    y,
    width,
    height,
    backgroundColor: '#000000',
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(appRoot, 'client', 'preload.js'),
    },
  });

  if (cwd) {
    windowInitialCwds.set(win.id, cwd);
  }

  // Explicitly move window after it exists to ensure offset is respected
  if (x !== undefined && y !== undefined) {
    win.setPosition(x, y, false);
  }

  windows.add(win);
  if (!mainWindow) mainWindow = win;

  if (state.isMaximized) {
    win.maximize();
  }

  win.once('ready-to-show', () => {
    win.show();
  });

  let saveTimeout;
  const debouncedSave = () => {
    clearTimeout(saveTimeout);
    if (!win.isDestroyed()) {
      saveTimeout = setTimeout(() => saveWindowState(win), 500);
    }
  };

  // No menu bar on Linux (the native drop-downs are unreliable in the snap); shortcuts still work
  if (process.platform === 'linux') {
    win.setAutoHideMenuBar(false);
    win.setMenuBarVisibility(false);
  }

  win.on('resize', debouncedSave);
  win.on('move', debouncedSave);
  win.on('close', (event) => {
    if (settings.confirmOnQuit && !isQuitting) {
      const choice = dialog.showMessageBoxSync(win, {
        type: 'question',
        buttons: ['Close Window', 'Cancel'],
        defaultId: 0,
        cancelId: 1,
        title: 'Confirm Close',
        message: 'Are you sure you want to close this window?',
        detail: 'All active terminal sessions in this window will be terminated.'
      });

      if (choice === 1) {
        event.preventDefault();
        return;
      }
    }

    clearTimeout(saveTimeout);
    saveWindowState(win);
    windows.delete(win);
    if (mainWindow === win) mainWindow = null;
    windowInitialCwds.delete(win.id);
    
    // Cleanup sessions associated with this window
    for (const [sessionId, session] of ptySessions.entries()) {
      if (session.webContents === win.webContents) {
        session.ptyProcess.kill();
        ptySessions.delete(sessionId);
        cleanupSessionTasks(sessionId); // Also kill background tasks
      }
    }
  });

  const indexPath = path.join(appRoot, 'client', 'dist', 'index.html');

  if (app.isPackaged) {
    win.loadFile(indexPath);
  } else {
    if (process.env.VITE_DEV === 'true') {
      win.loadURL('http://localhost:5173').catch(() => win.loadFile(indexPath));
    } else {
      win.loadFile(indexPath);
    }
  }
}

// IPC Handlers
ipcMain.handle('app.readClipboard', () => clipboard.readText());
ipcMain.handle('app.writeClipboard', (event, { text }) => {
  if (typeof text === 'string') clipboard.writeText(text);
});

ipcMain.handle('app.getInitialCwd', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win && windowInitialCwds.has(win.id)) {
    return windowInitialCwds.get(win.id);
  }
  return null;
});

ipcMain.on('app.getInitialCwdSync', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  event.returnValue = (win && windowInitialCwds.has(win.id)) ? windowInitialCwds.get(win.id) : null;
});
ipcMain.on('terminal.start', (event, { sessionId, cwd }) => {
  if (ptySessions.has(sessionId)) return;

  const defaultShell = getDefaultShell();

  try {
    const resolvedCwd = (cwd && fs.existsSync(cwd)) ? cwd : os.homedir();
    const ptyProcess = spawn(defaultShell, ['-l'], {
      name: 'xterm-256color',
      cols: 150,
      rows: 30,
      cwd: resolvedCwd,
      env: {
        ...process.env,
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor',
      }
    });

    const webContents = event.sender;

    ptyProcess.onData((data) => {
      try {
        // Skip once the session was closed (window closing): the render frame may already be gone
        if (ptySessions.has(sessionId) && !webContents.isDestroyed()) {
          webContents.send(`terminal-output-${sessionId}`, data);
        }
      } catch (err) {}

      const session = ptySessions.get(sessionId);
      if (session) {
        session.scrollback += data;
        if (session.scrollback.length > SCROLLBACK_LIMIT) {
          session.scrollback = session.scrollback.slice(-SCROLLBACK_LIMIT);
        }
      }
    });

    ptyProcess.onExit(() => {
      ptySessions.delete(sessionId);
      sessionCwds.delete(sessionId);
    });

    ptySessions.set(sessionId, { ptyProcess, webContents, scrollback: '' });

    // Asynchronously fetch initial status after pty spawns without blocking
    setTimeout(() => updateSessionStatus(sessionId), 100);

    const statusInterval = setInterval(() => {
      if (ptySessions.has(sessionId)) {
        updateSessionStatus(sessionId);
      } else {
        clearInterval(statusInterval);
      }
    }, 30000);
  } catch (err) {
    console.error(`[PTY] Failed to spawn:`, err);
  }
});

ipcMain.on('terminal.keystroke', (event, { sessionId, data }) => {
  const session = ptySessions.get(sessionId);
  if (session) session.ptyProcess.write(data);
});

ipcMain.on('terminal.resize', (event, { sessionId, cols, rows }) => {
  const session = ptySessions.get(sessionId);
  if (session && cols > 0 && rows > 0) {
    session.ptyProcess.resize(cols, rows);
  }
});
function cleanupSessionTasks(sessionId) {
  for (const [taskId, task] of backgroundTasks.entries()) {
    if (task.sessionId === sessionId && task.status === 'running' && task.ptyProcess) {
      console.log(`[Cleanup] Killing background task ${taskId} for session ${sessionId}`);
      task.ptyProcess.kill();
      task.status = 'finished';
      task.exitCode = -1;
    }
  }
}

// IPC Handlers
// True when something other than the shell owns the terminal's foreground (vim, ssh, a REPL, a build…)
ipcMain.handle('terminal.hasForegroundJob', async (event, { sessionId }) => {
  const session = ptySessions.get(sessionId);
  if (!session) return false;
  const shellPid = session.ptyProcess.pid;
  try {
    const { stdout } = await execAsync(`ps -o tpgid= -p ${shellPid}`, { timeout: 2000 });
    const tpgid = parseInt(stdout.trim(), 10);
    if (Number.isFinite(tpgid) && tpgid > 0) return tpgid !== shellPid;
  } catch (e) {}
  return Boolean(session.runningCommand);
});

ipcMain.on('terminal.close', (event, { sessionId }) => {
  const session = ptySessions.get(sessionId);
  if (session) {
    session.ptyProcess.kill();
    ptySessions.delete(sessionId);
    cleanupSessionTasks(sessionId); // Kill background tasks for this session
  }
});

ipcMain.handle('terminal.getFileDiff', async (event, { cwd, file }) => {
  try {
    const { findUp } = await import('find-up');

    const gitDir = await findUp('.git', { cwd, type: 'directory' });
    if (!gitDir) return null;
    const root = path.dirname(gitDir);

    // Try staged first, fall back to unstaged, then untracked
    let diff = '';
    try {
      const { stdout } = await runGit(`git diff HEAD -- "${file}"`, { cwd: root });
      diff = stdout;
    } catch (e) {}

    if (!diff.trim()) {
      try {
        const { stdout } = await runGit(`git diff --cached -- "${file}"`, { cwd: root });
        diff = stdout;
      } catch (e) {}
    }

    if (!diff.trim()) {
      // Untracked — show full file as added
      try {
        const { stdout } = await runGit(`git diff --no-index /dev/null "${file}"`, { cwd: root });
        diff = stdout;
      } catch (e) {
        diff = e.stdout || '';
      }
    }

    return diff;
  } catch (e) {
    return null;
  }
});

ipcMain.handle('terminal.checkPathExists', async (event, { cwd, relativePath }) => {
  try {
    const target = path.isAbsolute(relativePath) ? relativePath : path.join(cwd || '', relativePath);
    await fs.promises.access(target, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
});

ipcMain.handle('terminal.refreshGitStatus', async (event, { sessionId }) => {
  const session = ptySessions.get(sessionId);
  if (!session) return;
  const cwd = sessionCwds.get(sessionId);
  if (!cwd) return;
  const gitRoot = findGitRoot(cwd);
  if (gitRoot) gitCache.delete(gitRoot); // bust cache for this repo
  updateSessionStatus(sessionId);
});

ipcMain.handle('terminal.queueGitAction', (event, { cwd, files, push, pullFirst }) => {
  console.log('[Queue] Storing action:', { cwd, files, push, pullFirst });
  pendingQueuedGitAction = { cwd, files, push, pullFirst };
  return true;
});


ipcMain.handle('terminal.generateCommitMessage', async (event, { cwd, files: selectedFiles }) => {
  if (!settings.geminiToken) throw new Error('Gemini API Token not set in settings.');
  try {
    await lazyImports();
    const gitDir = await _findUp('.git', { cwd, type: 'directory' });
    if (!gitDir) throw new Error('Not a git repository');
    const root = path.dirname(gitDir);

    // Use selected files if provided, otherwise fall back to all changed files
    let files;
    if (selectedFiles?.length) {
      files = selectedFiles;
    } else {
      const { stdout: statusOut } = await execAsync(`git --no-optional-locks status --porcelain`, { cwd: root });
      files = statusOut.split('\n').filter(Boolean).map(l => l.slice(3).trim());
    }
    if (!files.length) throw new Error('No changes to commit');

    // Get diffs for each file (cap at 2000 chars each)
    const diffs = await Promise.all(files.map(async f => {
      try {
        const { stdout } = await execAsync(`git --no-optional-locks diff HEAD -- "${f}"`, { cwd: root });
        if (stdout.trim()) {
          // Remove git hunk headers (@@ ... @@) and diff headers (index, ---, +++)
          const cleanDiff = stdout
            .split('\n')
            .filter(line => !line.startsWith('@@') && !line.startsWith('index ') && !line.startsWith('---') && !line.startsWith('+++') && !line.startsWith('diff --git'))
            .join('\n')
            .substring(0, 2000);
          return `## ${f}\n\`\`\`diff\n${cleanDiff}\n\`\`\``;
        }
        // New untracked file — show first 50 lines
        const { stdout: content } = await execAsync(`head -50 "${f}"`, { cwd: root }).catch(() => ({ stdout: '' }));
        return content ? `## ${f} (new file)\n${content}` : null;
      } catch { return null; }
    }));
    const diffContext = diffs.filter(Boolean).join('\n\n');

    const prompt = `Analyze these git diffs and write a SHORT, CLEAR commit message. Return ONLY the message text, nothing else.

Files: ${files.join(', ')}

${diffContext}

Message rules:
- ONE single line, no newlines or line breaks
- 50-80 characters (but clarity > brevity)
- Start with capital verb: Add, Remove, Fix, Update, Improve, Refactor, etc.
- Plain English, no "feat:" "fix:" "chore:" prefixes
- No quotes, backticks, or trailing punctuation

RETURN ONLY THE COMMIT MESSAGE TEXT.`;

    const fallbackModels = ['gemini-3-pro-preview', 'gemini-2.5-pro', 'gemini-3-flash-preview', 'gemini-2.5-flash-lite', 'gemini-2.5-flash', 'gemini-1.5-flash'];
    let lastError = 'All models failed';
    for (const model of fallbackModels) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${settings.geminiToken.trim()}`;
        console.log('[Gemini] Trying model:', model);
        const response = await net.fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.3, maxOutputTokens: 500 } })
        });
        const text = await response.text();
        console.log('[Gemini] Response status:', response.status, 'body:', text.substring(0, 300));
        const data = JSON.parse(text);
        if (data.error) { lastError = `${model}: ${data.error.message}`; console.error('[Gemini] API error:', lastError); continue; }
        const rawMsg = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
        const msg = rawMsg.replace(/\s*\n\s*/g, ' ').trim();
        console.log('[Gemini] Raw response:', rawMsg);
        console.log('[Gemini] Processed message:', msg);
        if (msg) {
          console.log('[Gemini] Success with', model, '->', msg);
          // Execute any queued action with this message
          executeQueuedGitActionIfExists(msg);
          return deepSanitize({ message: msg, files });
        }
        lastError = `${model}: empty response`;
        console.error('[Gemini]', lastError);
      } catch (e) { lastError = `${model}: ${e.message}`; console.error('[Gemini] Fetch error:', lastError); continue; }
    }
    const fallbackMsg = `Update ${files.map(f => f.split('/').pop()).join(', ')}`;
    executeQueuedGitActionIfExists(fallbackMsg);
    return deepSanitize({ message: fallbackMsg, files, error: lastError });
  } catch (err) {
    const errMsg = String(err?.message || 'Failed to generate commit message');
    return deepSanitize({ error: errMsg });
  }
});

// Execute queued git action if one exists
async function executeQueuedGitActionIfExists(message) {
  console.log('[Execute] Checking queued action:', pendingQueuedGitAction ? 'exists' : 'null', 'message:', message);
  if (!pendingQueuedGitAction) {
    console.log('[Execute] No queued action, returning');
    return;
  }

  const { cwd, files, push, pullFirst } = pendingQueuedGitAction;
  pendingQueuedGitAction = null; // Clear immediately

  try {
    const commitMsg = message.replace(/"/g, '\\"');
    const fileArgs = files.map(f => `"${f}"`).join(' ');

    let command = `git add ${fileArgs} && git commit -m "${commitMsg}"`;
    if (push) {
      command += ' && git pull && git push';
    } else if (pullFirst) {
      command = `git pull && ${command}`;
    }

    console.log('[QueuedAction] Executing:', command, 'at:', cwd);

    const taskId = globalThis.crypto.randomUUID();
    const shell = getDefaultShell();
    const shellArgs = os.platform() === 'win32' ? ['-Command', `${command}; exit`] : ['-i', '-l', '-c', `${command}; exit`];

    const ptyProcess = spawn(shell, shellArgs, {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd: cwd || os.homedir(),
      env: process.env
    });

    const task = {
      id: taskId,
      command,
      output: '',
      status: 'running',
      startTime: Date.now(),
      exitCode: null,
      viewed: false,
      ptyProcess
    };

    backgroundTasks.set(taskId, task);

    const MAX_TASK_OUTPUT = 2 * 1024 * 1024;
    ptyProcess.onData((data) => {
      if (task.output.length < MAX_TASK_OUTPUT) {
        task.output += data;
      }
      BrowserWindow.getAllWindows().forEach(win => {
        if (!win.isDestroyed()) {
          win.webContents.send(`background-task-update-${taskId}`, { output: data });
        }
      });
    });

    ptyProcess.onExit(({ exitCode, signal }) => {
      task.status = 'finished';
      task.exitCode = exitCode ?? (signal ? -1 : 0);
      task.endTime = Date.now();
      const wasKilled = !!signal || task.killedByUser || isSignalExitCode(exitCode) || (exitCode !== 0 && outputShowsSignal(task.output));

      BrowserWindow.getAllWindows().forEach(win => {
        if (!win.isDestroyed()) {
          win.webContents.send(`background-task-finished-${taskId}`, {
            exitCode: task.exitCode,
            duration: Math.floor((task.endTime - task.startTime) / 1000),
            wasKilled
          });
        }
      });

      if (settings.notifyOnCommandEnd && !wasKilled) {
        new Notification({
          title: task.exitCode === 0 ? 'Task Succeeded' : 'Task Failed',
          body: `"${command}" finished with code ${task.exitCode}`,
          silent: false
        }).show();
      }
    });
  } catch (err) {
    console.error('[QueuedAction] Failed to execute:', err);
  }
}

// Helper to run git commands with automatic index.lock detection and cleanup
async function runGit(command, options, retry = true) {
  try {
    return await execAsync(command, options);
  } catch (err) {
    const stderr = err.stderr || '';
    const message = err.message || '';
    
    // Check for index.lock error
    if (retry && (stderr.includes('index.lock') || message.includes('index.lock'))) {
      try {
        const root = options.cwd;
        const lockFile = path.join(root, '.git', 'index.lock');
        console.warn(`[Git] index.lock detected at ${lockFile}. Attempting automatic cleanup...`);
        
        if (fs.existsSync(lockFile)) {
          fs.unlinkSync(lockFile);
          console.log('[Git] Stale index.lock removed. Retrying command...');
          return await runGit(command, options, false); // Retry once
        }
      } catch (cleanupErr) {
        console.error('[Git] Failed to remove index.lock:', cleanupErr);
      }
    }
    throw err;
  }
}

ipcMain.handle('terminal.commitFiles', async (event, { cwd, files, message, push, pullFirst = false }) => {
  try {
    await lazyImports();
    const gitDir = await _findUp('.git', { cwd, type: 'directory' });
    if (!gitDir) throw new Error('Not a git repository');
    const root = path.dirname(gitDir);
    const fileArgs = files.map(f => `"${f}"`).join(' ');
    await runGit(`git add ${fileArgs}`, { cwd: root });
    await runGit(`git commit -m "${message.replace(/"/g, '\\"')}"`, { cwd: root });

    if (push) {
      if (pullFirst) {
        await runGit('git pull', { cwd: root });
      }
      try {
        await runGit('git push', { cwd: root });
      } catch (pushErr) {
        const stderr = pushErr.stderr || '';
        const errMsg = String(stderr || pushErr.message || 'Failed to push');
        if (errMsg.includes('non-fast-forward') || errMsg.includes('rejected') || errMsg.includes('fetch first')) {
          return deepSanitize({ success: true, committed: true, pushError: 'Remote has updates', needsPull: true });
        }
        return deepSanitize({ success: true, committed: true, pushError: errMsg });
      }
    }
    return deepSanitize({ success: true });
  } catch (err) {
    const errMsg = String(err?.message || 'Failed to commit');
    return deepSanitize({ error: errMsg });
  }
});

ipcMain.handle('terminal.discardFile', async (event, { cwd, file }) => {
  try {
    await lazyImports();
    const gitDir = await _findUp('.git', { cwd, type: 'directory' });
    if (!gitDir) throw new Error('Not a git repository');
    const root = path.dirname(gitDir);
    await runGit(`git restore -- "${file}"`, { cwd: root });
    gitCache.delete(root);
    return { success: true };
  } catch (err) {
    const errMsg = String(err?.message || 'Failed to discard file');
    return { error: errMsg };
  }
});

ipcMain.handle('terminal.getChangedFiles', async (event, { cwd }) => {
  try {
    const { findUp } = await import('find-up');

    const gitDir = await findUp('.git', { cwd, type: 'directory' });
    if (!gitDir) return [];
    const root = path.dirname(gitDir);

    // Staged + unstaged tracked changes
    const { stdout: diffOut } = await runGit('git diff HEAD --name-status', { cwd: root });
    // Untracked files
    const { stdout: untrackedOut } = await runGit('git ls-files --others --exclude-standard', { cwd: root });

    const files = [];

    diffOut.trim().split('\n').filter(l => l.trim()).forEach(line => {
      const parts = line.split('\t');
      const rawStatus = parts[0][0]; // M, A, D, R, C…
      const file = parts[parts.length - 1]; // for renames, use destination
      files.push({ status: rawStatus, file });
    });

    untrackedOut.trim().split('\n').filter(l => l.trim()).forEach(file => {
      files.push({ status: '?', file });
    });

    return deepSanitize(files);
  } catch (e) {
    return [];
  }
});

ipcMain.handle('terminal.getUnpushedCommits', async (event, { cwd }) => {
  try {
    const { findUp } = await import('find-up');

    const gitDir = await findUp('.git', { cwd, type: 'directory' });
    if (!gitDir) return [];
    const root = path.dirname(gitDir);

    // Get current branch
    let branch = '';
    try {
      const { stdout: branchOut } = await runGit('git rev-parse --abbrev-ref HEAD', { cwd: root });
      branch = branchOut.trim();
    } catch (e) {
      return [];
    }

    // Get unpushed commits (commits in local branch but not in origin/branch)
    const { stdout: logsOut } = await runGit(
      `git log origin/${branch}..HEAD --oneline 2>/dev/null || git log HEAD --oneline 2>/dev/null`,
      { cwd: root }
    );

    const commits = logsOut.trim().split('\n')
      .filter(l => l.trim())
      .map(line => {
        const [hash, ...msgParts] = line.split(' ');
        return { hash, message: msgParts.join(' ') };
      });

    return deepSanitize(commits);
  } catch (e) {
    return [];
  }
});

ipcMain.handle('terminal.push', async (event, { cwd, pullFirst = false }) => {
  try {
    if (pullFirst) {
      try {
        await runGit('git pull', { cwd });
      } catch (pullErr) {
        const pullErrMsg = String(pullErr?.stderr || pullErr?.message || 'Pull failed');
        return deepSanitize({ error: pullErrMsg, success: false });
      }
    }

    try {
      await runGit('git push', { cwd });
      return deepSanitize({ success: true });
    } catch (pushErr) {
      const stderr = pushErr.stderr || '';
      const errMsg = String(stderr || pushErr.message || 'Failed to push');

      // Check if error is due to non-fast-forward (need to pull)
      if (errMsg.includes('non-fast-forward') || errMsg.includes('rejected') || errMsg.includes('fetch first')) {
        return deepSanitize({ error: 'Remote has updates', needsPull: true, success: false });
      }

      return deepSanitize({ error: errMsg, success: false });
    }
  } catch (err) {
    const errMsg = String(err?.message || 'Operation failed');
    return deepSanitize({ error: errMsg, success: false });
  }
});

async function openInGithubDesktop(repoPath) {
  const { exec } = await import('node:child_process');
  const util = await import('node:util');
  const execAsync = util.promisify(exec);

  const isInstalled = fs.existsSync('/Applications/GitHub Desktop.app');

  if (!isInstalled) {
    return { installed: false };
  }

  try {
    await execAsync(`open -a "GitHub Desktop" "${repoPath}"`);
    return { installed: true, opened: true };
  } catch (e) {
    return { installed: true, opened: false, error: e.message };
  }
}


ipcMain.handle('app.getLastShellCommand', async (event) => {
  const cmd = getLastShellCommand();
  if (cmd) console.log('[history] last command:', cmd);
  return cmd;
});

ipcMain.handle('app.getShellHistory', async (event, { limit = 25 } = {}) => {
  try {
    const home = os.homedir();
    const zshHistory = path.join(home, '.zsh_history');
    const bashHistory = path.join(home, '.bash_history');
    const seen = new Set();
    const commands = [];

    // Try zsh history first (format: ": timestamp:0;command")
    if (fs.existsSync(zshHistory)) {
      const content = fs.readFileSync(zshHistory, 'utf-8');
      const lines = content.split('\n').reverse();
      for (const line of lines) {
        if (commands.length >= limit) break;
        const match = line.match(/^:\s*\d+:\d+;(.+)$/);
        if (match) {
          const cmd = match[1].trim();
          if (cmd && !seen.has(cmd) && !cmd.startsWith('cd ') && cmd !== 'cd') {
            seen.add(cmd);
            commands.push(cmd);
          }
        }
      }
    }

    // Fall back to bash history if needed
    if (commands.length < limit && fs.existsSync(bashHistory)) {
      const content = fs.readFileSync(bashHistory, 'utf-8');
      const lines = content.split('\n').reverse();
      for (const line of lines) {
        if (commands.length >= limit) break;
        const cmd = line.trim();
        if (cmd && !seen.has(cmd) && !cmd.startsWith('cd ') && cmd !== 'cd') {
          seen.add(cmd);
          commands.push(cmd);
        }
      }
    }

    return commands.reverse();
  } catch (e) {
    console.error('[history] read error:', e);
    return [];
  }
});

ipcMain.handle('app.openGitHubDesktop', async (event, { path: targetPath }) => {
  try {
    const ghDesktopPath = process.platform === 'darwin'
      ? '/Applications/GitHub Desktop.app'
      : process.platform === 'win32'
      ? 'C:\\Users\\' + os.userInfo().username + '\\AppData\\Local\\GitHubDesktop\\app-*\\GitHub Desktop.exe'
      : '/usr/bin/github-desktop';

    if (process.platform === 'darwin') {
      const isInstalled = fs.existsSync(ghDesktopPath);
      if (isInstalled) {
        const { exec } = await import('node:child_process');
        exec(`open -a "GitHub Desktop" "${targetPath}"`);
        return { success: true };
      }
    } else if (process.platform === 'win32') {
      const { exec } = await import('node:child_process');
      exec(`start "" "GitHub Desktop" "${targetPath}"`);
      return { success: true };
    } else {
      const { exec } = await import('node:child_process');
      exec(`github-desktop "${targetPath}"`);
      return { success: true };
    }
    return { success: false, error: 'GitHub Desktop not found' };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

async function openInVSCode(targetPath) {
  const { exec } = await import('node:child_process');
  const util = await import('node:util');
  const execAsync = util.promisify(exec);

  try {
    await execAsync(`code "${targetPath}"`);
    return { installed: true, opened: true };
  } catch (e) {
    const appPaths = ['/Applications/Visual Studio Code.app', '/usr/local/bin/code', '/opt/homebrew/bin/code'];
    const isInstalled = appPaths.some(p => fs.existsSync(p));
    if (isInstalled) {
      try {
        await execAsync(`open -a "Visual Studio Code" "${targetPath}"`);
        return { installed: true, opened: true };
      } catch (e2) {}
    }
    return { installed: isInstalled, opened: false };
  }
}


async function openInIntelliJ(targetPath) {
  const { exec } = await import('node:child_process');
  const util = await import('node:util');
  const execAsync = util.promisify(exec);

  const appPaths = ['/Applications/IntelliJ IDEA.app', '/Applications/IntelliJ IDEA Community Edition.app'];
  const isInstalled = appPaths.some(p => fs.existsSync(p));

  if (!isInstalled) {
    return { installed: false, opened: false };
  }

  try {
    const appName = fs.existsSync(appPaths[0]) ? 'IntelliJ IDEA' : 'IntelliJ IDEA Community Edition';
    await execAsync(`open -a "${appName}" "${targetPath}"`);
    return { installed: true, opened: true };
  } catch (e) {
    return { installed: true, opened: false };
  }
}


ipcMain.handle('app.openInVSCode', (event, { path: p }) => openInVSCode(p));
ipcMain.handle('app.openInIntelliJ', (event, { path: p }) => openInIntelliJ(p));
ipcMain.handle('app.openInGithubDesktop', (event, { repoPath }) => openInGithubDesktop(repoPath));

// Run an IDE opener; if the app isn't installed, offer to download it
async function openWithIde(win, name, url, opener, targetPath) {
  const result = await opener(targetPath);
  if (result && !result.installed) {
    const { response } = await dialog.showMessageBox(win, {
      type: 'question',
      buttons: ['Download', 'Cancel'],
      defaultId: 0,
      cancelId: 1,
      message: `${name} is not installed.`,
      detail: 'Would you like to download it?'
    });
    if (response === 0) shell.openExternal(url);
  }
}

ipcMain.handle('app.openInFinder', async (event, { path: targetPath }) => {
  try {
    await shell.openPath(targetPath);
    return { opened: true };
  } catch (e) {
    return { opened: false, error: e.message };
  }
});

ipcMain.on('folder.open', (event, { path: targetPath }) => {
  if (!targetPath) return;
  if (targetPath.startsWith('http')) {
    shell.openExternal(targetPath);
  } else {
    shell.openPath(targetPath);
  }
});

ipcMain.on('window.closeIfNotLast', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win && !win.isDestroyed() && BrowserWindow.getAllWindows().length > 1) win.close();
});

ipcMain.on('folder.context-menu', (event, { path: targetPath }) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const template = [
    {
      label: 'Copy Path',
      click: () => {
        clipboard.writeText(targetPath);
      }
    },
    { type: 'separator' },
    {
      label: 'Open in Finder',
      click: () => {
        shell.openPath(targetPath);
      }
    },
    { type: 'separator' },
    {
      label: 'Open in VS Code',
      click: () => openWithIde(win, 'VS Code', 'https://code.visualstudio.com/', openInVSCode, targetPath)
    },
    {
      label: 'Open in IntelliJ IDEA',
      click: () => openWithIde(win, 'IntelliJ IDEA', 'https://www.jetbrains.com/idea/', openInIntelliJ, targetPath)
    },
    {
      label: 'Open in GitHub Desktop',
      click: () => openWithIde(win, 'GitHub Desktop', 'https://desktop.github.com/', openInGithubDesktop, targetPath)
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  menu.popup({ window: win });
});

ipcMain.handle('terminal.isDangerousCommand', async (event, { command }) => {
  if (!command) return false;

  const trimmed = command.trim();
  const firstWord = trimmed.split(/\s+/)[0];

  // Direct check for dangerous commands
  if (firstWord === 'git' || firstWord === 'cd') return true;

  // Check if it's an alias that expands to a dangerous command
  try {
    const { exec } = await import('node:child_process');
    const shell = getDefaultShell();
    
    // Command to check alias in an interactive-like shell
    const cmd = process.platform === 'win32' 
      ? `Get-Alias ${firstWord} | Select-Object -ExpandProperty Definition`
      : `${shell} -i -c "alias ${firstWord}; which ${firstWord}; type ${firstWord}" 2>/dev/null`;

    return await new Promise((resolve) => {
      exec(cmd, (error, stdout) => {
        const out = stdout ? stdout.toLowerCase() : '';
        
        // Use regex to find git/cd as standalone words or at the start of an alias expansion
        // Matches: "='git", "=' git", "is git", "function { git", etc.
        const dangerousRegex = /\b(git|cd)\b|='?\s*(git|cd)\b/;
        const isDangerous = dangerousRegex.test(out);
        
        if (isDangerous) {
          console.log(`[Main] Dangerous command detected via shell expansion: ${trimmed}`);
        }
        resolve(isDangerous);
      });
    });
  } catch (e) {
    return false;
  }
});


ipcMain.handle('terminal.verifyCommand', async (event, { command }) => {
  return verifyCommandString(command);
});

ipcMain.handle('terminal.askAI', async (event, { prompt }) => {
  if (!settings.geminiToken) {
    throw new Error('Gemini API Token not set in settings.');
  }

  const systemPrompt = `You are a terminal assistant. Your job is to convert natural language requests into valid, safe, and efficient zsh/bash commands.
RULES:
1. Return ONLY the command to execute. No markdown, no triple backticks, no explanations.
2. If multiple steps are needed, combine them with '&&' or ';'.
3. Assume standard macOS utilities (e.g. valid flags for BSD ls, sed, awk).
4. If the request implies danger (delete all files), use proper flags but assume user knows what they are doing (perhaps add -i for interactive if unsure).
5. Output format: Just the command string.`;

  const fallbackModels = [
    'gemini-2.5-flash',
    'gemini-3-pro-preview',
    'gemini-2.5-pro',
    'gemini-3-flash-preview',
    'gemini-2.5-flash-lite',
    'gemini-1.5-flash'
  ];

  let lastError = null;

  for (const model of fallbackModels) {
    try {
      const https = await import('https');
      const url = new URL(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${settings.geminiToken.trim()}`);
      const payload = JSON.stringify({
        contents: [{
          parts: [{ text: `${systemPrompt}\n\nRequest: ${prompt}` }]
        }],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 1024
        }
      });

      const response = await new Promise((resolve, reject) => {
        const req = https.request(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload)
          },
          rejectUnauthorized: false // Allow self-signed certs from corporate proxies
        }, (res) => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => resolve({ status: res.statusCode, body: data }));
        });
        req.on('error', reject);
        req.write(payload);
        req.end();
      });

      const data = JSON.parse(response.body);
      
      if (data.error) {
        const code = data.error.code;
        const msg = data.error.message || '';
        
        // Fallback on 404 (Not Found), 429 (Rate Limit), or 503 (Overloaded)
        if (code === 404 || code === 429 || code === 503 || msg.toLowerCase().includes('overloaded')) {
          console.warn(`[Main] Model ${model} failed (${code}). Trying fallback...`);
          lastError = new Error(msg);
          continue;
        }
        throw new Error(msg || 'Gemini API Error');
      }

      const command = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
      if (!command) {
        console.warn(`[Main] Model ${model} returned empty response. Trying fallback...`);
        continue;
      }

      return command;
    } catch (error) {
      const errorMsg = error.message || String(error);
      console.error(`[Main] Error with model ${model}:`, errorMsg);

      // Provide helpful diagnostics for common network errors
      if (errorMsg.includes('fetch failed') || errorMsg.includes('ECONNREFUSED') || errorMsg.includes('ETIMEDOUT')) {
        console.error('[Main] Network error detected - check internet connectivity or firewall settings');
      }

      lastError = error;
      continue;
    }
  }

  const finalMsg = lastError?.message || 'Unknown error';
  const errorHint = (finalMsg.includes('fetch failed') || finalMsg.includes('ECONNREFUSED'))
    ? ' (Network error - check internet connection, firewall, or try again)'
    : '';
  throw new Error(`Gemini API failed${errorHint}: ${finalMsg}`);
});

ipcMain.on('git.getBranches', async (event, { sessionId }) => {
  const session = ptySessions.get(sessionId);
  if (!session) return;

  try {
    const { exec } = await import('node:child_process');
    const util = await import('node:util');
    const execAsync = util.promisify(exec);

    const { stdout: cwdStdout } = await execAsync(`lsof -p ${session.ptyProcess.pid} | grep cwd | awk '{print $NF}'`);
    const cwd = cwdStdout.trim();

    if (cwd) {
      const root = findGitRoot(cwd);
      if (root) {
        const { stdout: branchStdout } = await execAsync(`git branch --format="%(refname:short)"`, { cwd: root });
        const branches = branchStdout.trim().split('\n').filter(b => b.trim());
        event.reply(`git.branches-${sessionId}`, { branches });
      }
    }
  } catch (e) {}
});

ipcMain.on('git.branch-context-menu', (event, { branch }) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const template = [
    {
      label: 'Copy Branch Name',
      click: () => {
        clipboard.writeText(branch);
      }
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  menu.popup({ window: win });
});

ipcMain.on('git.checkout', async (event, { sessionId, branch }) => {
  const session = ptySessions.get(sessionId);
  if (session) session.ptyProcess.write(`git checkout ${branch}\n`);
});

ipcMain.on('context-menu.show', (event, { canClose, selection, sessionId }) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const isMac = process.platform === 'darwin';
  const shift = isMac ? '⇧' : 'Shift+';
  const cmd = isMac ? '⌘' : 'Ctrl+';

  const template = [
    {
      label: 'Copy',
      enabled: !!selection,
      click: () => clipboard.writeText(selection)
    },
    {
      label: 'Paste',
      click: () => {
        const text = clipboard.readText();
        if (text) win.webContents.send('context-menu.action', { action: 'paste', text, sessionId });
      }
    },
    {
      label: `Select All (${isMac ? '⌘A' : `${cmd}${shift}A`})`,
      click: () => {
        win.webContents.send('context-menu.action', { action: 'select-all', sessionId });
      }
    },
    { type: 'separator' },
    {
      label: `Split Right (${cmd}${shift}R)`,
      click: () => {
        win.webContents.send('context-menu.action', { action: 'split-right' });
      }
    },
    {
      label: `Split Down (${cmd}${shift}D)`,
      click: () => {
        win.webContents.send('context-menu.action', { action: 'split-down' });
      }
    },
    { type: 'separator' },
    {
      label: `Close (${cmd}W)`,
      click: () => {
        win.webContents.send('context-menu.action', { action: 'close' });
      },
      enabled: canClose
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  menu.popup({ window: win });
});

ipcMain.on('app.saveSession', (event, data) => {
  if (mainWindow && event.sender !== mainWindow.webContents) return;
  try {
    fs.writeFileSync(sessionFile, JSON.stringify(data), 'utf-8');
    const cmds = (data || []).map(t => t.layout ? JSON.stringify(t.layout).match(/"savedLastCommand":"([^"]+)"/g) : null).filter(Boolean);
    const cwds = (data || []).map(t => t.layout ? JSON.stringify(t.layout).match(/"savedCwd":"([^"]+)"/g) : null).filter(Boolean);
    console.log('[session] saved to', sessionFile, '| lastCommands:', cmds.length ? cmds : 'none', '| cwds:', cwds.length ? cwds : 'none');
  } catch (e) { console.error('[session] save error', e); }
});

ipcMain.on('app.sessionData', (event, data) => {
  if (mainWindow && event.sender !== mainWindow.webContents) { app.quit(); return; }
  try {
    fs.writeFileSync(sessionFile, JSON.stringify(data), 'utf-8');
  } catch (e) {}
  app.quit();
});

ipcMain.on('app.getCwdsSync', (event) => {
  event.returnValue = Object.fromEntries(sessionCwds);
});

ipcMain.handle('app.getVersion', () => app.getVersion());

ipcMain.handle('app.forceCwdUpdate', async (event, { sessionId } = {}) => {
  if (sessionId) {
    console.log('[cwd] forcing immediate update for', sessionId);
    const session = ptySessions.get(sessionId);
    if (session) {
      let retries = 10;
      while (session.polling && retries-- > 0) {
        await new Promise(r => setTimeout(r, 50));
      }
      if (!session.polling) {
        await updateSessionStatus(sessionId);
      }
    }
  }
  return Object.fromEntries(sessionCwds);
});

ipcMain.on('app.getSessionSync', (event) => {
  if (sessionRestored) { event.returnValue = null; return; }
  sessionRestored = true;
  try {
    if (fs.existsSync(sessionFile)) {
      const data = JSON.parse(fs.readFileSync(sessionFile, 'utf-8'));
      const cmds = JSON.stringify(data).match(/"savedLastCommand":"([^"]+)"/g);
      const cwds = JSON.stringify(data).match(/"savedCwd":"([^"]+)"/g);
      console.log('[session] restoring from', sessionFile, '| lastCommands:', cmds || 'none', '| cwds:', cwds || 'none');
      event.returnValue = data;
      return;
    }
  } catch (e) { console.error('[session] restore error', e); }
  event.returnValue = null;
});

ipcMain.on('settings.get', (event) => {
  event.returnValue = settings;
});

ipcMain.on('settings.set', (event, newSettings) => {
  settings = { ...settings, ...newSettings };
  saveSettings();
  registerGlobalHotkey();
  BrowserWindow.getAllWindows().forEach(win => {
    if (!win.isDestroyed()) {
      win.webContents.send('settings.updated', settings);
    }
  });
});

app.whenReady().then(async () => {
  loadSettings();
  registerGlobalHotkey();
  setupMenu();
  createWindow(pendingPath);
  pendingPath = null;

  powerMonitor.on('suspend', () => {
    systemSleeping = true;
    console.log('[power] system suspended — polling paused');
  });
  powerMonitor.on('resume', () => {
    systemSleeping = false;
    wakeGraceUntil = Date.now() + WAKE_GRACE_MS;
    console.log(`[power] system resumed — polling resumes in ${WAKE_GRACE_MS / 1000}s`);
  });

  app.on('render-process-gone', (event, webContents, details) => {
    writeCrashLog('render-process-gone', {
      message: `reason=${details.reason} exitCode=${details.exitCode} url=${webContents.getURL()}`,
      stack: '(renderer crash — no JS stack available)'
    });
  });

  app.on('child-process-gone', (event, details) => {
    if (details.type !== 'GPU' && details.reason !== 'clean-exit') {
      writeCrashLog('child-process-gone', {
        message: `type=${details.type} reason=${details.reason} exitCode=${details.exitCode}`,
        stack: '(child process crash — no JS stack available)'
      });
    }
  });
  // Start server in background — loadFile doesn't need it, only the dev fallback does
  import('./server/index.js').then(({ startServer }) => {
    startServer().then(port => { serverPort = port; }).catch(console.error);
  });
  import('./server/mobile.js').then(({ startMobileServer }) => {
    startMobileServer(ptySessions, sessionCwds).catch(console.error);
  });
});

app.on('activate', () => {
  if (windows.size === 0) createWindow();
});

let isQuitting = false;

// An external kill (SIGTERM from `kill`, a system shutdown, a wrapper like concurrently, ...)
// must not be blocked by the "close window?" prompt. On macOS the confirmation lives in
// before-quit; elsewhere it's only in the window 'close' handler, which Electron's default
// signal handling would trigger via app.quit().
for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP']) {
  process.on(sig, () => {
    isQuitting = true;
    app.quit();
  });
}

app.on('before-quit', (event) => {
  if (process.platform === 'darwin' && !isQuitting && settings.confirmOnQuit) {
    event.preventDefault();

    const result = dialog.showMessageBoxSync({
      type: 'question',
      buttons: ['Quit', 'Cancel'],
      defaultId: 0,
      cancelId: 1,
      title: 'Confirm Quit',
      message: 'Are you sure you want to quit GitTerminal?',
      detail: 'All active terminal sessions will be terminated.'
    });

    if (result === 1) return; // Cancel

    isQuitting = true;

    // Always save session so the next launch restores tabs (main window only)
    const win = mainWindow || BrowserWindow.getAllWindows()[0];
    if (win && !win.isDestroyed()) {
      win.webContents.send('app.captureSession');
      return; // wait for app.sessionData IPC response which then calls app.quit()
    }
    app.quit();
  }
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('will-quit', () => {
  for (const win of windows) {
    saveWindowState(win);
  }
  globalShortcut.unregisterAll();
});

