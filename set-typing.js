#!/usr/bin/env node
// Set typing indicator status
// Usage: node set-typing.js [on|off]

import { setTyping, clearTyping } from './server/typing-status.js';

const arg = process.argv[2] || 'on';

if (arg === 'on' || arg === '1' || arg === 'true') {
  setTyping(true);
  console.log('✅ Typing indicator ON');
} else {
  clearTyping();
  console.log('✅ Typing indicator OFF');
}
