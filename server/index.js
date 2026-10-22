import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json());

// Serve static files from client dist
const distPath = path.join(__dirname, '..', 'client', 'dist');
app.use(express.static(distPath));

// Fallback to index.html for SPA
app.get(/.*/, (req, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});

export function startServer() {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      console.log(`[Server] Terminal app server running on http://localhost:${port}`);
      resolve(port);
    });

    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.error(`[Server] Port already in use, trying another...`);
      } else {
        console.error('[Server] Server error:', err);
        reject(err);
      }
    });
  });
}
