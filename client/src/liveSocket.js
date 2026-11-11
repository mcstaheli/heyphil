import { io } from 'socket.io-client';

// Every live-update connection goes through here. The server only accepts
// signed-in connections (the same token as API calls), so:
//   - the token is read fresh on every (re)connect, never a stale copy;
//   - if the server refuses a connection (Socket.io then stops retrying on
//     its own - e.g. a database blip during a deploy), keep trying every
//     few seconds instead of going quiet until the page is reloaded.
export function openLiveSocket(url, options = {}) {
  const socket = io(url, {
    ...options,
    auth: (cb) => cb({ token: localStorage.getItem('authToken') }),
  });
  let retry = null;
  socket.on('connect_error', () => {
    if (socket.active || retry) return; // Socket.io is already retrying
    retry = setTimeout(() => { retry = null; socket.connect(); }, 5000);
  });
  socket.on('connect', () => { clearTimeout(retry); retry = null; });
  // closing the socket (e.g. the page unmounting) also cancels a pending retry
  ['close', 'disconnect'].forEach((name) => {
    if (typeof socket[name] !== 'function') return;
    const original = socket[name].bind(socket);
    socket[name] = (...args) => { clearTimeout(retry); retry = null; return original(...args); };
  });
  return socket;
}
