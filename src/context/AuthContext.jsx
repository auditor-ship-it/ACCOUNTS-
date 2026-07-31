// Re-exports the shared AuthProvider/useAuth (itself re-exported from
// frontend/) so pages ported from frontend/ can keep importing
// '../../context/AuthContext.jsx' unchanged. See ../shared/auth/README.md.
export { AuthProvider, useAuth } from '../shared/auth/index.js';
