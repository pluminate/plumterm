export function enqueueCommand(queue, command, statusCommandRunning) {
  if (!command.trim()) return { queue, executeNow: null };
  if (statusCommandRunning || queue.length > 0) {
    return { 
      queue: [...queue, { id: crypto.randomUUID(), cmd: command }], 
      executeNow: null 
    };
  } else {
    return { queue, executeNow: command };
  }
}

export function processQueue(queue, statusCommandRunning) {
  if (!statusCommandRunning && queue.length > 0) {
    const [nextItem, ...remaining] = queue;
    return { queue: remaining, executeNow: nextItem.cmd };
  }
  return { queue, executeNow: null };
}
