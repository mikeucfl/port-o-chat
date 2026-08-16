/**
 * Browser-appropriate stand-ins for the two OS-integration methods
 * PortochatApi exposes. Neither has a real equivalent worth building yet:
 * a taskbar/dock badge has no web platform equivalent outside PWA-only,
 * still-uneven APIs, so the page title carries the unread count instead;
 * and there's no shell.openExternal in a browser — a plain new-tab open is
 * already sandboxed by the browser itself, and the renderer has already
 * shown its own "open this link?" confirmation before ever calling this.
 */
export function setUnreadBadge(count: number): void {
  document.title = count > 0 ? `(${count}) Port-O-Chat` : 'Port-O-Chat'
}

export function openExternalLink(url: string): void {
  if (!/^https?:\/\//i.test(url)) return
  window.open(url, '_blank', 'noopener,noreferrer')
}
