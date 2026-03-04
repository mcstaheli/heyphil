// Simple typing indicator system
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const STATUS_FILE = path.join(__dirname, '.typing-status.json');

export function setTyping(isTyping = true) {
  const status = {
    isTyping,
    timestamp: new Date().toISOString()
  };
  fs.writeFileSync(STATUS_FILE, JSON.stringify(status));
}

export function getTypingStatus() {
  try {
    if (fs.existsSync(STATUS_FILE)) {
      const data = JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8'));
      // Clear typing status if older than 2 minutes
      const age = Date.now() - new Date(data.timestamp).getTime();
      if (age > 120000) {
        setTyping(false);
        return false;
      }
      return data.isTyping;
    }
  } catch (err) {
    console.error('Error reading typing status:', err);
  }
  return false;
}

export function clearTyping() {
  setTyping(false);
}
