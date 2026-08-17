import { useMemo, useState } from 'react'
import { MAX_NICKNAME_LENGTH } from '@shared/constants'
import { useStore } from '../state/store'
import { conversationKey, type ConversationRef } from '../state/types'
import { ConfirmDialog } from './ConfirmDialog'
import { CreateChannelDialog } from './CreateChannelDialog'
import styles from './Sidebar.module.css'

function UnreadBadge({ count }: { count: number }) {
  if (count <= 0) return null
  return <span className={styles.unreadBadge}>{count > 9 ? '9+' : count}</span>
}

export function Sidebar({
  onOpenFingerprint
}: {
  onOpenFingerprint: (userId: string, isSelf: boolean) => void
}) {
  const { state, dispatch } = useStore()
  const [showCreateChannel, setShowCreateChannel] = useState(false)
  const [confirmDisconnect, setConfirmDisconnect] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [renameDraft, setRenameDraft] = useState('')

  function submitRename(): void {
    const trimmed = renameDraft.trim()
    if (trimmed && trimmed !== state.myNickname) {
      window.portochat.setNickname(trimmed)
    }
    setRenaming(false)
  }

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
          const key = conversationKey(ref)
          const active = activeKey === key
          const topic = state.channels[name]?.topic
          const isMember = state.channelMembers[name]?.includes(state.myUserId ?? '') ?? false
          const unread = state.unreadCounts[key] ?? 0
          return (
            <button
              key={name}
              className={`${styles.item} ${active ? styles.itemActive : ''} ${
                isMember ? styles.itemJoined : styles.itemNotJoined
              } ${unread > 0 ? styles.itemUnread : ''}`}
              onClick={() => openChannel(name)}
            >
              {isMember && <span className={styles.joinedDot} title="You're in this channel" />}
              {state.channels[name]?.e2e && <span className={styles.lockIcon}>🔒</span>}
              <span className={styles.itemTextGroup}>
                <span className={styles.itemName}>{name}</span>
                {topic && <span className={styles.itemTopic}>{topic}</span>}
              </span>
              <UnreadBadge count={unread} />
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
          const key = conversationKey(ref)
          const active = activeKey === key
          const warned = !!state.peerKeyWarnings[user.id]
          const unread = state.unreadCounts[key] ?? 0
          const offline = !!state.offlineUserIds[user.id]
          return (
            <button
              key={user.id}
              className={`${styles.item} ${active ? styles.itemActive : ''} ${
                unread > 0 ? styles.itemUnread : ''
              }`}
              onClick={() => openDm(user.id)}
            >
              <span className={offline ? styles.offlineDot : styles.onlineDot} />
              <span className={`${styles.itemName} ${offline ? styles.itemOffline : ''}`}>
                {user.name}
                {offline && ' (disconnected)'}
              </span>
              {warned && <span title="Key changed — unverified">⚠</span>}
              {user.e2eCapable && !warned && <span className={styles.lockIcon}>🔒</span>}
              <UnreadBadge count={unread} />
            </button>
          )
        })}
      </div>

      <div className={styles.footer}>
        <div className={styles.footerName}>
          {renaming ? (
            <input
              className={styles.renameInput}
              autoFocus
              value={renameDraft}
              maxLength={MAX_NICKNAME_LENGTH}
              onChange={(e) => setRenameDraft(e.target.value)}
              onBlur={submitRename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submitRename()
                if (e.key === 'Escape') setRenaming(false)
              }}
            />
          ) : (
            <div
              className={styles.footerNickname}
              title="Click to change your nickname"
              onClick={() => {
                setRenameDraft(state.myNickname)
                setRenaming(true)
              }}
            >
              {state.myNickname}
            </div>
          )}
          <div className={styles.footerStatus}>
            {state.nameError ?? (state.connection === 'connected' ? 'Connected' : state.connection)}
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
          onClick={() => setConfirmDisconnect(true)}
        >
          ⏻
        </button>
      </div>

      {showCreateChannel && (
        <CreateChannelDialog onCreate={createChannel} onClose={() => setShowCreateChannel(false)} />
      )}

      {confirmDisconnect && (
        <ConfirmDialog
          title="Disconnect?"
          message={
            state.hostInfo
              ? "You're hosting this server — disconnecting will also shut it down and disconnect everyone else in it."
              : "You'll be disconnected from the server and returned to the launch screen."
          }
          confirmLabel="Disconnect"
          danger
          onConfirm={() => {
            window.portochat.clientDisconnect()
            dispatch({ type: 'RESET_SESSION' })
          }}
          onClose={() => setConfirmDisconnect(false)}
        />
      )}
    </aside>
  )
}
