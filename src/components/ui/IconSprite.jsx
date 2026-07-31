/**
 * Crystal Design System icon sprite — outline only, 1.7px stroke, 24px grid,
 * round caps/joins. Subset ported from crystal-design-system.html's <defs>;
 * only the symbols this app actually uses. Mount once near the app root.
 */
export function IconSprite() {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true">
      <defs>
        <symbol id="i-search" viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4.5 4.5" /></symbol>
        <symbol id="i-list" viewBox="0 0 24 24"><path d="M4 6.5h16M4 12h16M4 17.5h16" /></symbol>
        <symbol id="i-bell" viewBox="0 0 24 24"><path d="M18 16V10a6 6 0 1 0-12 0v6l-1.5 2.5h15z" /><path d="M10 20a2 2 0 0 0 4 0" /></symbol>
        <symbol id="i-user" viewBox="0 0 24 24"><circle cx="12" cy="8.5" r="3.8" /><path d="M4.5 20c0-3.6 3.4-5.8 7.5-5.8s7.5 2.2 7.5 5.8" /></symbol>
        <symbol id="i-doc" viewBox="0 0 24 24"><path d="M6 2.5h7l5 5v14H6z" /><path d="M13 2.5v5h5M9 13h6M9 16.5h6" /></symbol>
        <symbol id="i-clock" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5" /><path d="M12 7v5.2l3.2 2" /></symbol>
        <symbol id="i-inbox" viewBox="0 0 24 24"><path d="M3.5 13.5h5l1.5 3h4l1.5-3h5" /><path d="M5.6 4.5h12.8l3.1 9v6.5a1.5 1.5 0 0 1-1.5 1.5H4a1.5 1.5 0 0 1-1.5-1.5V13.5z" /></symbol>
        <symbol id="i-calendar" viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="16" rx="2" /><path d="M3.5 10h17M8 3v4M16 3v4" /></symbol>
        <symbol id="i-eye" viewBox="0 0 24 24"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" /><circle cx="12" cy="12" r="2.8" /></symbol>
        <symbol id="i-container" viewBox="0 0 24 24"><rect x="2.5" y="7" width="19" height="10" rx="1.2" /><path d="M6 7v10M9.5 7v10M13 7v10M16.5 7v10" /></symbol>
        <symbol id="i-chart" viewBox="0 0 24 24"><path d="M3.5 20.5h17" /><path d="M6.5 20.5V12M11 20.5V6.5M15.5 20.5v-5M20 20.5V9" /></symbol>
        <symbol id="i-check" viewBox="0 0 24 24"><path d="M4.5 12.5 9.5 17.5 19.5 6.5" /></symbol>
        <symbol id="i-check-circle" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5" /><path d="M8 12.2l2.8 2.8L16 9.5" /></symbol>
        <symbol id="i-x" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" /></symbol>
        <symbol id="i-x-circle" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5" /><path d="M9.2 9.2l5.6 5.6M14.8 9.2l-5.6 5.6" /></symbol>
        <symbol id="i-alert" viewBox="0 0 24 24"><path d="M12 4 2.8 20h18.4z" /><path d="M12 10v4.5M12 17.3v.2" /></symbol>
        <symbol id="i-info" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5" /><path d="M12 11v5.5M12 7.8v.2" /></symbol>
        <symbol id="i-refresh" viewBox="0 0 24 24"><path d="M20 12a8 8 0 1 1-2.6-5.9" /><path d="M20 3.5V8h-4.5" /></symbol>
        <symbol id="i-sun" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4.5" /><path d="M12 2.5v2.4M12 19.1v2.4M21.5 12h-2.4M4.9 12H2.5M18.7 5.3l-1.7 1.7M7 17l-1.7 1.7M18.7 18.7 17 17M7 7 5.3 5.3" /></symbol>
        <symbol id="i-moon" viewBox="0 0 24 24"><path d="M20 13.8A8.5 8.5 0 1 1 10.2 4a7 7 0 0 0 9.8 9.8z" /></symbol>
        <symbol id="i-chev-down" viewBox="0 0 24 24"><path d="M6 9.5l6 6 6-6" /></symbol>
        <symbol id="i-chev-left" viewBox="0 0 24 24"><path d="M14.5 6l-6 6 6 6" /></symbol>
        <symbol id="i-chev-right" viewBox="0 0 24 24"><path d="M9.5 6l6 6-6 6" /></symbol>
        <symbol id="i-arrow-right" viewBox="0 0 24 24"><path d="M4.5 12h15M19.5 12 14 6.5M19.5 12 14 17.5" /></symbol>
        <symbol id="i-download" viewBox="0 0 24 24"><path d="M12 3.5v11M12 14.5 8 10.5M12 14.5l4-4M4.5 17v3.5h15V17" /></symbol>
        <symbol id="i-upload" viewBox="0 0 24 24"><path d="M12 20.5v-11M12 9.5l-4 4M12 9.5l4 4M4.5 7V3.5h15V7" /></symbol>
        <symbol id="i-edit" viewBox="0 0 24 24"><path d="M4.5 19.5h4l10-10-4-4-10 10z" /><path d="M14.5 5.5l4 4" /></symbol>
        <symbol id="i-filter" viewBox="0 0 24 24"><path d="M3.5 5.5h17l-6.5 8v6l-4 2v-8z" /></symbol>
        <symbol id="i-lock" viewBox="0 0 24 24"><rect x="4.5" y="10.5" width="15" height="10" rx="2" /><path d="M8 10.5V7.8a4 4 0 0 1 8 0v2.7" /></symbol>
        <symbol id="i-external" viewBox="0 0 24 24"><path d="M13.5 4.5H19.5v6" /><path d="M19.5 4.5 11 13" /><path d="M18 14v5.5H4.5V6H10" /></symbol>
      </defs>
    </svg>
  );
}
