import { useAuth } from '../context/AuthContext.jsx';

/**
 * Port of the original's canViewTab(id)/canActTab(id). Sidebar visibility is
 * authoritative only when the Roles & Access admin has an explicit opinion
 * (key present in `sidebar`) — an unmigrated email/tab falls back to visible,
 * matching the original's "no regression" default. Action permissions
 * (`perms`) fail closed: an unknown/absent key means "cannot act", matching
 * checkActionPermission's server-side deny-by-default.
 */
export function usePermission() {
  const { perms, sidebar } = useAuth();

  const canView = (tabKey) => (tabKey in sidebar ? !!sidebar[tabKey] : true);
  const canAct = (actionKey) => !!perms[actionKey];

  return { canView, canAct, perms, sidebar };
}
