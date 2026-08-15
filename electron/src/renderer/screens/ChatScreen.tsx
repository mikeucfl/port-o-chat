import { useEffect, useMemo, useState } from 'react'
import { Composer } from '../components/Composer'
import { EncryptionBadge } from '../components/EncryptionBadge'
import { FingerprintDialog } from '../components/FingerprintDialog'
import { KeyChangeWarningBanner } from '../components/KeyChangeWarningBanner'
import { MemberList } from '../components/MemberList'
import { MessageList } from '../components/MessageList'
import { Sidebar } from '../components/Sidebar'
import { useStore } from '../state/store'
import { conversationKey } from '../state/types'
import styles from './ChatScreen.module.css'

export function ChatScreen() {
  const { state, dispatch } = useStore()
  const [fingerprintTarget, setFingerprintTarget] = useState<{ userId: string; isSelf: boolean } | null>(
    null
  )
  const [toast, setToast] = useState<string | null>(null)

  useEffect(() => {
    if (!state.generalError) return
    setToast(state.generalError)
    dispatch({ type: 'CLEAR_GENERAL_ERROR' })
  }, [state.generalError, dispatch])

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), 5000)
    return () => clearTimeout(timer)
  }, [toast])

  useEffect(() => {
    window.portochat.requestChannelList()
  }, [])

  const active = state.activeConversation
  const activeKey = active ? conversationKey(active) : null
  const messages = activeKey ? (state.messages[activeKey] ?? []) : []

  const title = active
    ? active.type === 'channel'
      ? active.name
      : (state.users[active.userId]?.name ?? 'Unknown user')
    : null

  const encrypted = useMemo(() => {
    if (!active) return false
    if (active.type === 'channel') return state.channels[active.name]?.e2e ?? false
    return state.users[active.userId]?.e2eCapable ?? false
  }, [active, state.channels, state.users])

  const members = useMemo(() => {
    if (!active) return []
    if (active.type === 'channel') {
      const ids = state.channelMembers[active.name] ?? []
      return ids.map((id) => state.users[id]).filter((u): u is NonNullable<typeof u> => !!u)
    }
    const user = state.users[active.userId]
    return user ? [user] : []
  }, [active, state.channelMembers, state.users])

  const dmWarning =
    active?.type === 'dm' ? state.peerKeyWarnings[active.userId] : undefined

  return (
    <div className={styles.layout}>
      <Sidebar onOpenFingerprint={(userId, isSelf) => setFingerprintTarget({ userId, isSelf })} />

      <div className={styles.mainColumn}>
        {active && title ? (
          <>
            <div className={styles.header}>
              <span className={styles.headerTitle}>
                {active.type === 'channel' ? title : `@${title}`}
              </span>
              <div className={styles.headerSpacer} />
              <EncryptionBadge encrypted={encrypted} />
            </div>
            {dmWarning && (
              <KeyChangeWarningBanner
                userName={title}
                onViewFingerprint={() => setFingerprintTarget({ userId: active.type === 'dm' ? active.userId : '', isSelf: false })}
              />
            )}
            <MessageList messages={messages} users={state.users} myUserId={state.myUserId} />
            <Composer
              target={active}
              placeholder={active.type === 'channel' ? `Message ${title}` : `Message @${title}`}
            />
          </>
        ) : (
          <div className={styles.emptyState}>
            <div>👋 Pick a channel or a direct message to get started.</div>
          </div>
        )}
      </div>

      {active && (
        <MemberList
          members={members}
          peerKeyWarnings={state.peerKeyWarnings}
          onOpenFingerprint={(userId) => setFingerprintTarget({ userId, isSelf: userId === state.myUserId })}
        />
      )}

      {fingerprintTarget && (
        <FingerprintDialog
          userId={fingerprintTarget.userId}
          userName={state.users[fingerprintTarget.userId]?.name ?? state.myNickname}
          isSelf={fingerprintTarget.isSelf}
          warned={!!state.peerKeyWarnings[fingerprintTarget.userId]}
          onTrust={() => {
            window.portochat.trustPeerKey(fingerprintTarget.userId)
            dispatch({ type: 'TRUST_PEER', userId: fingerprintTarget.userId })
          }}
          onClose={() => setFingerprintTarget(null)}
        />
      )}

      {toast && (
        <div className={styles.toastStack}>
          <div className={styles.toast}>{toast}</div>
        </div>
      )}
    </div>
  )
}
