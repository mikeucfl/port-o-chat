import { useEffect, useRef } from 'react'
import type { ChatMessageDto, UserDto } from '@shared/protocolTypes'
import styles from './MessageList.module.css'

function initials(name: string): string {
  return name.slice(0, 2).toUpperCase() || '?'
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export function MessageList({
  messages,
  users,
  myUserId
}: {
  messages: ChatMessageDto[]
  users: Record<string, UserDto>
  myUserId: string | null
}) {
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [messages.length])

  return (
    <div className={styles.list}>
      {messages.map((message) => {
        const senderName =
          message.senderId === myUserId
            ? 'You'
            : (users[message.senderId]?.name ?? 'Unknown user')
        return (
          <div className={styles.message} key={message.clientMessageId}>
            <div className={styles.avatar}>{initials(senderName)}</div>
            <div className={styles.body}>
              <div className={styles.metaLine}>
                <span className={styles.sender}>{senderName}</span>
                <span className={styles.timestamp}>{formatTime(message.timestamp)}</span>
                {message.e2e && <span className={styles.lockGlyph}>🔒</span>}
              </div>
              {message.decryptFailed ? (
                <div className={styles.undecryptable}>🔒 Undecryptable message (missing or rotated key)</div>
              ) : (
                <div className={message.isAction ? styles.actionText : styles.text}>
                  {message.isAction ? `${senderName} ${message.message}` : message.message}
                </div>
              )}
            </div>
          </div>
        )
      })}
      <div ref={bottomRef} />
    </div>
  )
}
