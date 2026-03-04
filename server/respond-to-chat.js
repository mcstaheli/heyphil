// Quick script to respond to web chat messages
// Usage: node respond-to-chat.js "Your response message here"

import { addChatResponse, clearPendingMessages } from './chat-agent.js';

const response = process.argv[2];

if (!response) {
  console.error('Usage: node respond-to-chat.js "Your response message"');
  process.exit(1);
}

addChatResponse(response);
clearPendingMessages();

console.log('✅ Response posted to web chat');
console.log('💬 Message:', response);
