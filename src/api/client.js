// Re-exports the shared axios client/token helpers so api/*.api.js files
// ported from frontend/ can keep importing './client.js' unchanged.
export {
  default,
  getStoredToken,
  setStoredToken,
  registerUnauthorizedHandler,
  apiErrorMessage,
  apiQuotaRetrySeconds
} from '../shared/auth/client.js';
