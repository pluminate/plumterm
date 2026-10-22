import express from 'express';
import crypto from 'node:crypto';
import http from 'node:http';
import { WebSocketServer } from 'ws';

/**
 * Separate, opt-in server exposing live PTY sessions to remote (mobile) clients
 * over WebSocket, for viewing/typing into the *same* session running in the
 * desktop app (not a new shell). Intentionally isolated from server/index.js,
 * which is Electron's own internal static-file loader and must not change
 * behavior because of this feature.
 *
 * Trust model: this listens on localhost only by default. It does nothing at
 * all — does not even bind a port — unless TERMINAL_MOBILE_TOKEN is set, so
 * the feature is off unless deliberately turned on. Reaching it from another
 * device (e.g. a phone over WireGuard) requires the operator to also set
 * TERMINAL_MOBILE_HOST to a specific interface address; it never defaults to
 * 0.0.0.0. Do not change these defaults to "just make it work" — they're the
 * whole point.
 */

const MOBILE_TOKEN = process.env.TERMINAL_MOBILE_TOKEN || null;
const MOBILE_PORT = Number(process.env.TERMINAL_MOBILE_PORT || 3939);
const MOBILE_HOST = process.env.TERMINAL_MOBILE_HOST || '127.0.0.1';

function timingSafeTokenEqual(a, b) {
  const bufA = Buffer.from(String(a || ''));
  const bufB = Buffer.from(String(b || ''));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function requireToken(req, res, next) {
  const provided = req.query.token || req.headers['x-terminal-token'];
  if (!timingSafeTokenEqual(provided, MOBILE_TOKEN)) {
    res.status(401).json({ error: 'Invalid or missing token.' });
    return;
  }
  next();
}

/**
 * ptySessions: shared Map<sessionId, { ptyProcess, webContents, scrollback }> owned by main.js.
 * sessionCwds: shared Map<sessionId, cwd> owned by main.js.
 * This module never spawns PTYs — only attaches to ones the desktop app already started.
 */
export function startMobileServer(ptySessions, sessionCwds) {
  if (!MOBILE_TOKEN) {
    console.log('[Mobile] TERMINAL_MOBILE_TOKEN not set — mobile access server not started.');
    return Promise.resolve(null);
  }

  const app = express();
  app.get('/api/sessions', requireToken, (req, res) => {
    const sessions = Array.from(ptySessions.keys()).map((sessionId) => ({
      sessionId,
      cwd: sessionCwds?.get(sessionId) || null,
    }));
    res.json({ sessions });
  });

  const server = http.createServer(app);
  attachWebSocketRelay(server, ptySessions);

  return new Promise((resolve, reject) => {
    server.listen(MOBILE_PORT, MOBILE_HOST, () => {
      console.log(`[Mobile] Listening on http://${MOBILE_HOST}:${MOBILE_PORT} (token required)`);
      resolve(server);
    });
    server.on('error', (err) => {
      console.error('[Mobile] Server error:', err);
      reject(err);
    });
  });
}

function attachWebSocketRelay(server, ptySessions) {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    let url;
    try {
      url = new URL(req.url, 'http://localhost');
    } catch {
      socket.destroy();
      return;
    }
    if (url.pathname !== '/ws') {
      socket.destroy();
      return;
    }
    const token = url.searchParams.get('token');
    if (!timingSafeTokenEqual(token, MOBILE_TOKEN)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req, url);
    });
  });

  wss.on('connection', (ws, req, url) => {
    const sessionId = url.searchParams.get('sessionId');
    const session = sessionId && ptySessions.get(sessionId);

    if (!session) {
      ws.send(JSON.stringify({ type: 'error', message: 'Unknown or inactive sessionId.' }));
      ws.close();
      return;
    }

    // Replay recent scrollback so a phone attaching mid-session isn't blank —
    // this is what makes it "the same session" rather than a fresh shell.
    if (session.scrollback) {
      ws.send(JSON.stringify({ type: 'output', data: session.scrollback }));
    }

    const dataSubscription = session.ptyProcess.onData((data) => {
      try {
        ws.send(JSON.stringify({ type: 'output', data }));
      } catch {}
    });

    ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw);
      } catch {
        return;
      }
      if (msg.type === 'input' && typeof msg.data === 'string') {
        session.ptyProcess.write(msg.data);
      }
      // Deliberately no 'resize' handling: the PTY has one cols/rows shared
      // with the desktop xterm.js pane. Letting the phone resize it would
      // fight the desktop view. The mobile client should reflow/scroll its
      // own display instead of resizing the shared PTY.
    });

    ws.on('close', () => {
      dataSubscription.dispose();
    });
  });
}
