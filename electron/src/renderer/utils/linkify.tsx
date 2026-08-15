import type { ReactNode } from 'react'

// Matches the original Java client's `convertLinks` intent (http(s):// and
// www. text becomes a clickable link) without ever using
// dangerouslySetInnerHTML — each message is split into plain-text and
// clickable segments, so nothing a peer sends can inject arbitrary markup.
const URL_PATTERN = /(https?:\/\/[^\s<]+|www\.[^\s<]+)/gi

/**
 * Renders message text with URLs converted to clickable segments. Clicking
 * never navigates directly — it calls `onLinkClick` so the caller can show
 * an explicit "open this link?" confirmation (showing the real URL) before
 * anything actually opens, since a link's display text and its real target
 * are never guaranteed to match for text a peer sent.
 */
export function linkify(text: string, onLinkClick: (url: string) => void): ReactNode[] {
  const parts = text.split(URL_PATTERN)
  return parts.map((part, i) => {
    if (i % 2 === 1) {
      const href = part.startsWith('www.') ? `https://${part}` : part
      return (
        <a
          key={i}
          href={href}
          onClick={(e) => {
            e.preventDefault()
            onLinkClick(href)
          }}
        >
          {part}
        </a>
      )
    }
    return part
  })
}
