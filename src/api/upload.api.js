import client from './client.js';

/**
 * Generic base64 -> Google Drive URL uploader, matching the original's
 * global uploadToDrive(base64Data, mimeType, fileName) RPC (no permission
 * check of its own — the write action that consumes the resulting URL is
 * separately permission-gated server-side). Session auth only.
 */
export const uploadFileToDrive = ({ base64Data, mimeType, fileName }) =>
  client.post('/uploads', { base64Data, mimeType, fileName }).then((r) => r.data.url);
