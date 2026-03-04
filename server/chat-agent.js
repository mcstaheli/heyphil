// Chat agent - monitors for web chat messages and responds
// This script can be run by Clawdbot to handle web chat messages

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const pendingFile = path.join(__dirname, '.chat-pending.txt');
const processedFile = path.join(__dirname, '.chat-processed.txt');
const messagesFile = path.join(__dirname, '.chat-messages.json');

export function checkPendingMessages() {
  if (!fs.existsSync(pendingFile)) {
    return [];
  }
  
  const content = fs.readFileSync(pendingFile, 'utf8');
  if (!content.trim()) {
    return [];
  }
  
  const lines = content.trim().split('\n');
  const messages = lines.map(line => {
    const match = line.match(/\[(.*?)\] (.*?): (.*)$/);
    if (match) {
      return {
        timestamp: match[1],
        user: match[2],
        message: match[3]
      };
    }
    return null;
  }).filter(Boolean);
  
  return messages;
}

export function clearPendingMessages() {
  if (fs.existsSync(pendingFile)) {
    const content = fs.readFileSync(pendingFile, 'utf8');
    fs.appendFileSync(processedFile, content);
    fs.writeFileSync(pendingFile, '');
  }
}

export function addChatResponse(message) {
  try {
    const messages = JSON.parse(fs.readFileSync(messagesFile, 'utf8') || '[]');
    
    // Remove the "Thinking..." placeholder if it exists
    const filtered = messages.filter(m => m.content !== '💭 Thinking...');
    
    filtered.push({
      role: 'assistant',
      content: message,
      timestamp: new Date().toISOString()
    });
    
    fs.writeFileSync(messagesFile, JSON.stringify(filtered, null, 2));
    console.log('✅ Response added to chat history');
  } catch (error) {
    console.error('Error adding response:', error);
  }
}

// CLI usage
if (import.meta.url === `file://${process.argv[1]}`) {
  const pending = checkPendingMessages();
  console.log('Pending web chat messages:', pending.length);
  pending.forEach((msg, idx) => {
    console.log(`${idx + 1}. [${msg.user}]: ${msg.message}`);
  });
}
