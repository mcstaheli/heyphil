// Lockout guards for login access and admin status (Settings -> Team).
// Pure, so they're unit-tested (scripts/tests/accessRules.test.js);
// permissions.js applies them inside a transaction that locks the admin
// rows, so two admins acting at once can't both pass and leave zero admins.
// Each returns null if allowed, else the reason.

const same = (a, b) => (a || '').trim().toLowerCase() === (b || '').trim().toLowerCase();

export function checkRevokeLogin({ actorEmail, targetEmail, targetIsAdmin, adminCount }) {
  if (same(actorEmail, targetEmail)) return "You can't revoke your own login.";
  if (targetIsAdmin && adminCount <= 1) return "That's the last admin - make someone else an admin first.";
  return null;
}

export function checkSetAdmin({ makeAdmin, targetIsAdmin, adminCount }) {
  if (!makeAdmin && targetIsAdmin && adminCount <= 1) {
    return "That's the last admin - make someone else an admin first.";
  }
  return null;
}
