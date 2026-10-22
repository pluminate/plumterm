import assert from 'assert';
import { verifyCommandString } from '../utils/commandParser.js';

async function runTests() {
  console.log('Running tests...');
  
  // Test 1: Valid command
  const valid = await verifyCommandString('ls -la');
  assert.strictEqual(valid, true, 'Valid command should return true');

  // Test 2: Invalid command (syntax error)
  const invalid = await verifyCommandString('if [ -z "$VAR" ]; then echo "missing fi"');
  assert.strictEqual(invalid, false, 'Invalid command should return false');

  // Test 3: Empty string
  const empty = await verifyCommandString('   ');
  assert.strictEqual(empty, false, 'Empty string should return false');

  // Test 4: Non-string input
  const nonString = await verifyCommandString({ cmd: 'ls' });
  assert.strictEqual(nonString, false, 'Non-string input should return false');

  console.log('All verifyCommand tests passed!');
}

runTests().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
