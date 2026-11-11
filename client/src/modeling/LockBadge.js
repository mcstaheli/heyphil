import React from 'react';

// Drive lock state of a release or locked version.
export default function LockBadge({ locked }) {
  return locked
    ? <span className="mdl-badge mdl-badge-locked" title="Drive Lock: view-only for everyone; only a drive Manager can unlock it">🔒 Locked</span>
    : <span className="mdl-badge mdl-badge-unlocked" title="Not locked in Drive - anyone in the drive can still edit it">⚠ Not locked</span>;
}
