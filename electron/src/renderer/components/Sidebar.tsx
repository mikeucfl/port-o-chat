import { useMemo, useState } from 'react'
import { useStore } from '../state/store'
import { conversationKey, type ConversationRef } from '../state/types'
import { CreateChannelDialog } from './CreateChannelDialog'
import styles from './Sidebar.module.css'

export function Sidebar({
  onOpenFingerprint
}: {
  onOpenFingerprint: (userId: string, isSelf: boolean) => void
}) {
  const { state, dispatch } = useStore()
  const [showCreateChannel, setShowCreateChannel] = useState(false)

  const activeKey = state.activeConversation ? conversationKey(state.activeConversation) : null
  const channelNames = useMemo(() => Object.keys(state.channels).sort(), [state.channels])
  const otherUsers = useMemo(
    () =>
      Object.values(state.users)
        .filter((u) => u.id !== state.myUserId)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [state.users, state.myUserId]
  )

  function openChannel(name: string): void {
    const channel = state.channels[name]
    const alreadyMember = state.channelMembers[name]?.includes(state.myUserId ?? '')
    if (!alreadyMember) {
      window.portochat.joinChannel(name, channel?.e2e ?? false)
    }
    dispatch({ type: 'OPEN_CONVERSATION', ref: { type: 'channel', name } })
  }

  function openDm(userId: string): void {
    dispatch({ type: 'OPEN_CONVERSATION', ref: { type: 'dm', userId } })
  }

  function createChannel(name: string, e2e: boolean): void {
    window.portochat.joinChannel(name, e2e)
    dispatch({ type: 'OPEN_CONVERSATION', ref: { type: 'channel', name } })
  }

  return (
    <aside className={styles.sidebar}>
      <div className={styles.section} style={{ flex: '0 1 auto' }}>
        <div className={styles.sectionHeader}>
          <span>Channels</span>
          <button
            className={styles.addButton}
            title="Join or create a channel"
            onClick={() => setShowCreateChannel(true)}
          >
            +
          </button>
        </div>
        {channelNames.length === 0 && (
          <div className={`${styles.item} ${styles.itemMuted}`}>No channels yet</div>
        )}
        {channelNames.map((name) => {
          const ref: ConversationRef = { type: 'channel', name }
          const active = activeKey === conversationKey(ref)
          return (
            <button
              key={name}
              className={`${styles.item} ${active ? styles.itemActive : ''}`}
              onClick={() => openChannel(name)}
            >
              {state.channels[name]?.e2e && <span className={styles.lockIcon}>🔒</span>}
              <span className={styles.itemName}>{name}</span>
            </button>
          )
        })}
      </div>

      <div className={styles.section} style={{ flex: '1 1 auto' }}>
        <div className={styles.sectionHeader}>
          <span>Direct messages</span>
        </div>
        {otherUsers.length === 0 && (
          <div className={`${styles.item} ${styles.itemMuted}`}>No one else here yet</div>
        )}
        {otherUsers.map((user) => {
          const ref: ConversationRef = { type: 'dm', userId: user.id }
          const active = activeKey === conversationKey(ref)
          const warned = !!state.peerKeyWarnings[user.id]
          return (
            <button
              key={user.id}
              className={`${styles.item} ${active ? styles.itemActive : ''}`}
              onClick={() => openDm(user.id)}
            >
              <span className={styles.onlineDot} />
              <span className={styles.itemName}>{user.name}</span>
              {warned && <span title="Key changed — unverified">⚠</span>}
              {user.e2eCapable && !warned && <span className={styles.lockIcon}>🔒</span>}
            </button>
          )
        })}
      </div>

      <div className={styles.footer}>
        <div className={styles.footerName}>
          <div className={styles.footerNickname}>{state.myNickname}</div>
          <div className={styles.footerStatus}>
            {state.connection === 'connected' ? 'Connected' : state.connection}
          </div>
        </div>
        <button
          className={styles.iconButton}
          title="My safety number"
          onClick={() => state.myUserId && onOpenFingerprint(state.myUserId, true)}
        >
          🔑
        </button>
        <button
          className={styles.iconButton}
          title="Disconnect"
          onClick={() => {
            window.portochat.clientDisconnect()
            dispatch({ type: 'RESET_SESSION' })
          }}
        >
          ⏻
        </button>
      </div>

      {showCreateChannel && (
        <CreateChannelDialog onCreate={createChannel} onClose={() => setShowCreateChannel(false)} />
      )}
    </aside>
  )
}
