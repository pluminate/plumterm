import assert from 'assert';
import { enqueueCommand, processQueue } from '../client/src/utils/commandQueue.js';

function runQueueTests() {
  console.log('Running queue state tests...');

  let queue = [];
  
  // Test 1: Immediate execution when idle
  let result = enqueueCommand(queue, 'echo 1', false);
  assert.strictEqual(result.executeNow, 'echo 1');
  assert.strictEqual(result.queue.length, 0);

  // Test 2: Queueing when busy
  result = enqueueCommand(queue, 'echo 2', true);
  assert.strictEqual(result.executeNow, null);
  assert.strictEqual(result.queue.length, 1);
  assert.strictEqual(result.queue[0].cmd, 'echo 2');
  queue = result.queue;

  // Queueing when queue not empty (but status is false)
  result = enqueueCommand(queue, 'echo 3', false);
  assert.strictEqual(result.executeNow, null);
  assert.strictEqual(result.queue.length, 2);
  queue = result.queue;

  // Test 3: Processing queue
  result = processQueue(queue, false);
  assert.strictEqual(result.executeNow, 'echo 2');
  assert.strictEqual(result.queue.length, 1);
  queue = result.queue;

  result = processQueue(queue, false);
  assert.strictEqual(result.executeNow, 'echo 3');
  assert.strictEqual(result.queue.length, 0);

  console.log('All queue tests passed!');
}

runQueueTests();
