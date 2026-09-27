// Shared Socket.io broadcast helper, usable from route modules that don't
// have direct access to the `io` instance created in index.js (which owns
// the HTTP/WebSocket server setup). init() is called once at boot; every
// other caller just imports broadcastChange.
let io = null;

export function initRealtime(ioInstance) {
  io = ioInstance;
}

export function broadcastChange(event, data) {
  if (!io) return;
  const clientCount = io.engine.clientsCount;
  console.log(`📡 Broadcasting ${event} to ${clientCount} clients:`, data.id || data.improvementId || '');
  io.emit(event, data);
}
