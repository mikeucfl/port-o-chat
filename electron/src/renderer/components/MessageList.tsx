import { useEffect, useRef, useState } from 'react'
import type { ChatMessageDto, UserDto } from '@shared/protocolTypes'
import { avatarColorForUserId, initials } from '../utils/avatarColor'
import { linkify } from '../utils/linkify'
import { ConfirmDialog } from './ConfirmDialog'
import styles from './MessageList.module.css'

const GROUPING_WINDOW_MS = 5 * 60 * 1000

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function isGroupedWithPrevious(current: ChatMessageDto, previous: ChatMessageDto | undefined): boolean {
  if (!previous) return false
  if (current.senderId !== previous.senderId) return false
  return current.timestamp - previous.timestamp <= GROUPING_WINDOW_MS
}

function MessageBody({
  message,
  senderName,
  onLinkClick
}: {
  message: ChatMessageDto
  senderName: string
  onLinkClick: (url: string) => void
}) {
  if (message.decryptFailed) {
    return <div className={styles.undecryptable}>🔒 Undecryptable message (missing or rotated key)</div>
  }
  return (
    <div className={message.isAction ? styles.actionText : styles.text}>
      {message.isAction && `${senderName} `}
      {linkify(message.message, onLinkClick)}
    </div>
  )
}

export function MessageList({
  messages,
  users,
  myUserId,
  myNickname,
  firstUnreadMessageId
}: {
  messages: ChatMessageDto[]
  users: Record<string, UserDto>
  myUserId: string | null
  myNickname: string
  /** clientMessageId of the first unread message, if any — renders a "New Messages" divider right before it. */
  firstUnreadMessageId?: string
}) {
  const listRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  // Discord-style "stuck to bottom": true as long as the user hasn't
  // scrolled up to read history. Only auto-scrolls on new messages while
  // this holds, instead of always yanking the view down regardless of
  // where they were reading.
  const stickToBottomRef = useRef(true)
  const [pendingLink, setPendingLink] = useState<string | null>(null)

  function handleScroll(): void {
    const el = listRef.current
    if (!el) return
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    stickToBottomRef.current = distanceFromBottom < 80
  }

  useEffect(() => {
    if (stickToBottomRef.current) bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [messages.length])

  // A mobile on-screen keyboard opening/closing shrinks the *visual*
  // viewport (and so this list's available height) without any new
  // message arriving to trigger the effect above — left unhandled, a
  // "stuck to bottom" view silently stops being at the bottom the moment
  // the keyboard animates, and the next message looks like it scrolled
  // away until you scroll back down manually.
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    function onResize(): void {
      if (stickToBottomRef.current) bottomRef.current?.scrollIntoView({ block: 'end' })
    }
    vv.addEventListener('resize', onResize)
    return () => vv.removeEventListener('resize', onResize)
  }, [])

  return (
    <div className={styles.list} ref={listRef} onScroll={handleScroll}>
      {messages.map((message, i) => {
        const isMine = message.senderId === myUserId
        const senderName = isMine ? 'You' : (users[message.senderId]?.name ?? 'Unknown user')
        // Avatar initials/color always derive from the real name, even for
        // your own messages — "You" would otherwise render as the initials "YO".
        const avatarName = isMine ? myNickname || senderName : senderName
        const showsDivider = message.clientMessageId === firstUnreadMessageId
        // A divider always breaks message grouping — "New Messages" should
        // never sit in the middle of what looks like one continuous block.
        const grouped = !showsDivider && isGroupedWithPrevious(message, messages[i - 1])

        return (
          <div key={message.clientMessageId}>
            {showsDivider && (
              <div className={styles.unreadDivider}>
                <span className={styles.unreadDividerLabel}>New Messages</span>
              </div>
            )}
            {grouped ? (
              <div className={styles.groupedMessage}>
                <span className={styles.hoverTimestamp}>{formatTime(message.timestamp)}</span>
                <MessageBody message={message} senderName={senderName} onLinkClick={setPendingLink} />
              </div>
            ) : (
              <div className={styles.message}>
                <div
                  className={styles.avatar}
                  style={{ background: avatarColorForUserId(message.senderId) }}
                >
                  {initials(avatarName)}
                </div>
                <div className={styles.body}>
                  <div className={styles.metaLine}>
                    <span className={styles.sender}>{senderName}</span>
                    <span className={styles.timestamp}>{formatTime(message.timestamp)}</span>
                    {message.e2e && <span className={styles.lockGlyph}>🔒</span>}
                  </div>
                  <MessageBody message={message} senderName={senderName} onLinkClick={setPendingLink} />
                </div>
              </div>
            )}
          </div>
        )
      })}
      <div ref={bottomRef} />

      {pendingLink && (
        <ConfirmDialog
          title="Open link?"
          message={
            <>
              This will open the following link in your default browser:
              <br />
              <code className={styles.pendingLinkUrl}>{pendingLink}</code>
            </>
          }
          confirmLabel="Open"
          onConfirm={() => window.portochat.openExternalLink(pendingLink)}
          onClose={() => setPendingLink(null)}
        />
      )}
    </div>
  )
}
