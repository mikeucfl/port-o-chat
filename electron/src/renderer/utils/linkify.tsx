import type { ReactNode } from 'react'

// Matches the original Java client's `convertLinks` intent (http(s):// and
// www. text becomes a clickable link) without ever using
// dangerouslySetInnerHTML — each message is split into plain-text and
// React <a> segments, so nothing a peer sends can inject arbitrary markup.
const URL_PATTERN = /(https?:\/\/[^\s<]+|www\.[^\s<]+)/gi

/**
 * Renders message text with URLs converted to clickable links. Links are
 * plain same-window `<a href>` (no target="_blank") so that main/index.ts's
 * existing `will-navigate` handler intercepts the click and opens it in the
 * user's default browser — the same mechanism that already blocks the
 * renderer from navigating anywhere else, reused rather than duplicated.
 */
export function linkify(text: string): ReactNode[] {
  const parts = text.split(URL_PATTERN)
  return parts.map((part, i) => {
    if (i % 2 === 1) {
      const href = part.startsWith('www.') ? `https://${part}` : part
      return (
        <a key={i} href={href} rel="noreferrer">
          {part}
        </a>
      )
    }
    return part
  })
}
