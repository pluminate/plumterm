import { execFile } from 'child_process';

export async function verifyCommandString(command) {
  if (typeof command !== 'string' || !command.trim()) return false;
  if (process.platform === 'win32') return true; 
  
  const shellBinary = '/bin/sh';
  return new Promise((resolve) => {
    execFile(shellBinary, ['-n', '-c', command], { timeout: 2000 }, (error) => {
      resolve(!error);
    });
  });
}
