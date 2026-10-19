import express from 'express';
import { requireAuth, makeRequireAdmin } from '../auth-middleware.js';
import * as designDb from '../design-db.js';
import { isAdmin } from '../permissions.js';
import {
  DesignValidationError,
  MAX_ATTACHMENT_BYTES,
  buildDraftEmail,
  isPreviewableType,
  isUuid,
} from '../design-rules.js';
import { broadcastChange } from '../realtime.js';

const router = express.Router();

// Everyone who can sign in can request, edit and move design cards, post
// to a card's journal, add files and edit the type lists; deleting a card
// is admin-only, and a journal entry or file can be removed by whoever
// added it or an admin.
router.use(requireAuth);
const requireDesignAdmin = makeRequireAdmin(isAdmin, 'Only admins can delete design requests.');

// A malformed id can't match anything; answer 404 before Postgres refuses it.
for (const param of ['id', 'entryId', 'attachmentId']) {
  router.param(param, (req, res, next, id) => (isUuid(id) ? next() : res.status(404).json({ error: 'Not found' })));
}

function handleError(res, error, action) {
  if (error instanceof DesignValidationError) {
    return res.status(400).json({ error: error.message });
  }
  if (error instanceof designDb.DesignForbiddenError) {
    return res.status(403).json({ error: error.message });
  }
  console.error(`Failed to ${action}:`, error.message);
  return res.status(500).json({ error: `Failed to ${action}` });
}

const actorOf = (req) => ({ email: req.user.email, name: req.user.name });
const isAdminReq = (req) => isAdmin((req.user.email || '').toLowerCase()).catch(() => false);

// Tells open boards a card changed (counts, stage) and open cards that
// their journal or files did.
async function announce(requestId, request) {
  const fresh = request || await designDb.getRequestById(requestId);
  if (fresh) broadcastChange('design:updated', { request: fresh });
  broadcastChange('design:details', { requestId });
}

router.get('/', async (req, res) => {
  try {
    const [requests, canDelete, options] = await Promise.all([
      designDb.getAllRequests(),
      isAdminReq(req),
      designDb.getOptionLists(),
    ]);
    res.json({ requests, canDelete, options });
  } catch (error) {
    handleError(res, error, 'list design requests');
  }
});

router.put('/settings/options', async (req, res) => {
  try {
    const options = await designDb.saveOptionLists(req.body || {}, actorOf(req));
    broadcastChange('design:options', { options });
    res.json({ options });
  } catch (error) {
    handleError(res, error, 'save design options');
  }
});

router.post('/', async (req, res) => {
  try {
    const request = await designDb.createRequest(req.body || {}, actorOf(req));
    broadcastChange('design:created', { request });
    res.status(201).json({ request });
  } catch (error) {
    handleError(res, error, 'create design request');
  }
});

router.put('/:id', async (req, res) => {
  try {
    const request = await designDb.updateRequest(req.params.id, req.body || {}, actorOf(req));
    if (!request) return res.status(404).json({ error: 'Not found' });
    await announce(request.id, request);
    res.json({ request });
  } catch (error) {
    handleError(res, error, 'update design request');
  }
});

router.delete('/:id', requireDesignAdmin, async (req, res) => {
  try {
    const ok = await designDb.softDeleteRequest(req.params.id);
    if (!ok) return res.status(404).json({ error: 'Not found' });
    broadcastChange('design:deleted', { requestId: req.params.id });
    res.json({ success: true });
  } catch (error) {
    handleError(res, error, 'delete design request');
  }
});

// The journal and files for one card, loaded when it's opened.
router.get('/:id/details', async (req, res) => {
  try {
    const request = await designDb.getRequestById(req.params.id);
    if (!request) return res.status(404).json({ error: 'Not found' });
    const [journal, attachments, admin] = await Promise.all([
      designDb.listJournal(req.params.id),
      designDb.listAttachments(req.params.id),
      isAdminReq(req),
    ]);
    res.json({ journal, attachments, isAdmin: admin });
  } catch (error) {
    handleError(res, error, 'load design request details');
  }
});

// Never throws: by the time this runs the post is saved, so a failed
// email is reported, not turned into a failed post.
async function sendResendEmail(email) {
  if (!process.env.RESEND_API_KEY) return { ok: false, reason: 'email isn\'t set up on the server' };
  let res;
  try {
    res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(email),
      signal: AbortSignal.timeout(10000),
    });
  } catch (error) {
    console.error('Draft email failed:', error.message);
    return { ok: false, reason: 'the email service couldn\'t be reached' };
  }
  if (res.ok) return { ok: true };
  const body = await res.text().catch(() => '');
  console.error('Draft email failed:', res.status, body.slice(0, 300));
  return { ok: false, reason: 'the email service refused it' };
}

// Posts a comment, draft or final. A draft can email the requester that
// it's waiting for their comments (notifyRequester); the email, or why it
// couldn't go, is recorded in the journal.
router.post('/:id/journal', async (req, res) => {
  try {
    const { kind, body, link, attachmentId, notifyRequester, moveStage } = req.body || {};
    if (attachmentId !== undefined && attachmentId !== null && !isUuid(attachmentId)) {
      return res.status(400).json({ error: 'That file id isn\'t valid.' });
    }
    const actor = actorOf(req);
    const posted = await designDb.addJournalEntry(
      req.params.id,
      { kind, body, link, attachmentId },
      actor,
      { moveStage: moveStage !== false }
    );
    if (!posted) return res.status(404).json({ error: 'Not found' });
    let { request } = posted;
    const { entry } = posted;

    let email = null;
    if (kind === 'draft' && notifyRequester) {
      const who = request.requesterName || 'the requester';
      if (!request.requesterEmail) {
        email = { sent: false, reason: `${who} has no email in People` };
      } else {
        const result = await sendResendEmail(buildDraftEmail({
          request,
          entry: { body: entry?.body, link: entry?.link },
          authorName: actor.name,
          appUrl: process.env.APP_URL || 'https://heyphil.bot',
          attachmentName: entry?.attachmentName,
        }));
        email = result.ok ? { sent: true, to: request.requesterEmail } : { sent: false, reason: result.reason };
      }
      await designDb.logEvent(
        request.id,
        'email',
        email.sent ? `Emailed ${who} that the draft is ready for comments` : `Couldn't email ${who}: ${email.reason}`,
        actor
      );
      request = await designDb.getRequestById(request.id);
    }

    await announce(request.id, request);
    res.status(201).json({ request, email });
  } catch (error) {
    handleError(res, error, 'post to the design journal');
  }
});

router.delete('/:id/journal/:entryId', async (req, res) => {
  try {
    const ok = await designDb.deleteJournalEntry(req.params.id, req.params.entryId, req.user.email, await isAdminReq(req));
    if (!ok) return res.status(404).json({ error: 'Not found' });
    await announce(req.params.id);
    res.json({ success: true });
  } catch (error) {
    handleError(res, error, 'remove the journal entry');
  }
});

// The file is the raw request body, sent as application/octet-stream so
// the app-wide JSON parser never touches it; its name comes in X-Filename
// (URI-encoded) and its real type in X-Content-Type.
router.post(
  '/:id/attachments',
  express.raw({ type: () => true, limit: MAX_ATTACHMENT_BYTES }),
  async (req, res) => {
    try {
      const attachment = await designDb.addAttachment(req.params.id, {
        filename: req.get('X-Filename'),
        contentType: req.get('X-Content-Type'),
        data: Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0),
      }, actorOf(req));
      if (!attachment) return res.status(404).json({ error: 'Not found' });
      await announce(req.params.id);
      res.status(201).json({ attachment });
    } catch (error) {
      handleError(res, error, 'add the file');
    }
  }
);

router.get('/:id/attachments/:attachmentId', async (req, res) => {
  try {
    const file = await designDb.getAttachmentFile(req.params.id, req.params.attachmentId);
    if (!file) return res.status(404).json({ error: 'Not found' });
    const inline = req.query.inline === '1' && isPreviewableType(file.contentType);
    res.set({
      'Content-Type': inline ? file.contentType : 'application/octet-stream',
      'Content-Length': file.data.length,
      'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    });
    res.send(file.data);
  } catch (error) {
    handleError(res, error, 'load the file');
  }
});

router.delete('/:id/attachments/:attachmentId', async (req, res) => {
  try {
    const ok = await designDb.deleteAttachment(req.params.id, req.params.attachmentId, req.user.email, await isAdminReq(req));
    if (!ok) return res.status(404).json({ error: 'Not found' });
    await announce(req.params.id);
    res.json({ success: true });
  } catch (error) {
    handleError(res, error, 'remove the file');
  }
});

// A file over the limit is refused by express.raw before the handler runs.
// eslint-disable-next-line no-unused-vars
router.use((err, req, res, next) => {
  if (err && err.type === 'entity.too.large') {
    return res.status(413).json({ error: `Files can be up to ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB.` });
  }
  return next(err);
});

export default router;
