import { useEffect, useRef, useState } from 'react'
import type { ChatMessageDto, UserDto } from '@shared/protocolTypes'
import { avatarColorForUserId, initials } from '../utils/avatarColor'
import { linkify } from '../utils/linkify'
import { ConfirmDialog } from './ConfirmDialog'
import styles from './MessageList.module.css'

const GROUPING_WINDOW_MS = 5 * 60 * 1000

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
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
  firstUnreadMessageId
}: {
  messages: ChatMessageDto[]
  users: Record<string, UserDto>
  myUserId: string | null
  /** clientMessageId of the first unread message, if any — renders a "New Messages" divider right before it. */
  firstUnreadMessageId?: string
}) {
  const bottomRef = useRef<HTMLDivElement>(null)
  const [pendingLink, setPendingLink] = useState<string | null>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [messages.length])

  return (
    <div className={styles.list}>
      {messages.map((message, i) => {
        const senderName =
          message.senderId === myUserId ? 'You' : (users[message.senderId]?.name ?? 'Unknown user')
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
                  {initials(senderName)}
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
