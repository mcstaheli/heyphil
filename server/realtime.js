// Shared Socket.io broadcast helper, usable from route modules that don't
// have direct access to the `io` instance created in index.js (which owns
// the HTTP/WebSocket server setup). init() is called once at boot; every
// other caller just imports broadcastChange.
//
// Who hears what: a connection must carry the same sign-in token the API
// uses (checked in index.js), and joins a room per app the person can use
// (admins: every app). Events for apps with their own data go only to that
// app's room; everything else (the project board's cards, tasks, links,
// logs) goes to every signed-in connection - those apps are hidden, not
// blocked (Chad's call, 2026-11-11).
import { myAppAccess } from './permissions.js';
import { APP_KEYS } from './app-catalog.js';

let io = null;

export function initRealtime(ioInstance) {
  io = ioInstance;
}

// event prefix -> the app whose data it carries
const EVENT_APP = { design: 'design', modeling: 'modeling', improvement: 'improvements' };
export const roomForEvent = (event) => {
  const app = EVENT_APP[String(event).split(':')[0]];
  return app ? `app:${app}` : null;
};

export function broadcastChange(event, data) {
  if (!io) return;
  const room = roomForEvent(event);
  console.log(`📡 Broadcasting ${event} to ${room || 'everyone signed in'}:`, data.id || data.cardId || data.actionId || data.improvementId || data.requestId || data.request?.id || '');
  (room ? io.to(room) : io).emit(event, data);
}

// Put a connection in the rooms for the apps its person has now.
export async function joinAppRooms(socket) {
  const { apps } = await myAppAccess(socket.data.user.email);
  APP_KEYS.forEach((k) => { if (!apps.includes(k)) socket.leave(`app:${k}`); });
  apps.forEach((k) => socket.join(`app:${k}`));
}

// After someone's access changes: update their open connections (or, with
// `disconnect`, close them - their login was removed).
export async function refreshUserRooms(email, { disconnect = false } = {}) {
  if (!io) return;
  const target = (email || '').toLowerCase();
  const sockets = await io.fetchSockets();
  await Promise.all(sockets
    .filter((s) => (s.data.user?.email || '').toLowerCase() === target)
    .map((s) => (disconnect ? s.disconnect(true) : joinAppRooms(s))));
}
