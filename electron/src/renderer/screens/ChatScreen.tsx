import { useEffect, useMemo, useState } from 'react'
import { ChannelTopicBar } from '../components/ChannelTopicBar'
import { Composer } from '../components/Composer'
import { EncryptionBadge } from '../components/EncryptionBadge'
import { FingerprintDialog } from '../components/FingerprintDialog'
import { KeyChangeWarningBanner } from '../components/KeyChangeWarningBanner'
import { MemberList } from '../components/MemberList'
import { MessageList } from '../components/MessageList'
import { Sidebar } from '../components/Sidebar'
import { VerifyNudgeBanner } from '../components/VerifyNudgeBanner'
import { useStore } from '../state/store'
import { conversationKey } from '../state/types'
import styles from './ChatScreen.module.css'

export function ChatScreen() {
  const { state, dispatch } = useStore()
  const [fingerprintTarget, setFingerprintTarget] = useState<{ userId: string; isSelf: boolean } | null>(
    null
  )
  const [toast, setToast] = useState<string | null>(null)
  // Session-only (never persisted, matching the app's zero-persistence
  // stance): which peers we've already nudged to verify their safety
  // number, so the prompt shows once per DM per session rather than every
  // time the conversation is reopened.
  const [nudgedUsers, setNudgedUsers] = useState<Set<string>>(new Set())

  function openFingerprint(userId: string, isSelf: boolean): void {
    setNudgedUsers((prev) => (prev.has(userId) ? prev : new Set(prev).add(userId)))
    setFingerprintTarget({ userId, isSelf })
  }

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

  // Reflects whether E2E is actually healthy right now for the active
  // conversation, not just whether it's flagged as E2E: a channel whose key
  // hasn't arrived yet, or any participant whose key changed and hasn't
  // been re-verified, shows as pending/unverified rather than a flat
  // "Encrypted" that would overstate the current state of things.
  const encryptionStatus = useMemo((): 'plain' | 'encrypted' | 'pending' | 'warning' => {
    if (!active) return 'plain'
    if (active.type === 'dm') {
      if (!state.users[active.userId]?.e2eCapable) return 'plain'
      if (dmWarning) return 'warning'
      return 'encrypted'
    }
    const channel = state.channels[active.name]
    if (!channel?.e2e) return 'plain'
    if (members.some((m) => state.peerKeyWarnings[m.id])) return 'warning'
    if (state.channelKeyEpochs[active.name] === undefined) return 'pending'
    return 'encrypted'
  }, [active, state.channels, state.users, state.peerKeyWarnings, state.channelKeyEpochs, members, dmWarning])

  return (
    <div className={styles.page}>
      {state.hostInfo && (
        <div className={styles.hostBanner}>
          <span className={styles.hostBannerStrong}>Hosting</span>
          <span>on port</span>
          <span className={styles.hostBannerAddr}>{state.hostInfo.port}</span>
          {state.hostInfo.lanAddresses.length > 0 ? (
            <>
              <span>— reachable on your LAN at</span>
              {state.hostInfo.lanAddresses.map((addr) => (
                <span className={styles.hostBannerAddr} key={addr}>
                  {addr}:{state.hostInfo?.port}
                </span>
              ))}
            </>
          ) : (
            <span>— no LAN network interface detected</span>
          )}
          <span className={styles.hostBannerHint}>
            LAN only — reaching this from the internet requires port forwarding, which
            Port-O-Chat does not set up for you.
          </span>
        </div>
      )}
      <div className={styles.layout}>
        <Sidebar onOpenFingerprint={openFingerprint} />

        <div className={styles.mainColumn}>
          {active && title ? (
            <>
              <div className={styles.header}>
                <span className={styles.headerTitle}>
                  {active.type === 'channel' ? title : `@${title}`}
                </span>
                <div className={styles.headerSpacer} />
                <EncryptionBadge status={encryptionStatus} />
                {active.type === 'channel' && (
                  <button
                    className={styles.leaveButton}
                    onClick={() => {
                      window.portochat.partChannel(active.name)
                      dispatch({ type: 'CLOSE_CONVERSATION', ref: active })
                    }}
                  >
                    Leave
                  </button>
                )}
              </div>
              {active.type === 'channel' && (
                <ChannelTopicBar
                  channel={active.name}
                  topic={state.channels[active.name]?.topic ?? ''}
                  canEdit={
                    !!state.myUserId && state.channels[active.name]?.creatorId === state.myUserId
                  }
                />
              )}
              {dmWarning ? (
                <KeyChangeWarningBanner
                  userName={title}
                  onViewFingerprint={() =>
                    openFingerprint(active.type === 'dm' ? active.userId : '', false)
                  }
                />
              ) : (
                active.type === 'dm' &&
                encryptionStatus === 'encrypted' &&
                !nudgedUsers.has(active.userId) && (
                  <VerifyNudgeBanner
                    userName={title}
                    onViewFingerprint={() => openFingerprint(active.userId, false)}
                    onDismiss={() =>
                      setNudgedUsers((prev) => new Set(prev).add(active.userId))
                    }
                  />
                )
              )}
              <MessageList
                messages={messages}
                users={state.users}
                myUserId={state.myUserId}
                firstUnreadMessageId={activeKey ? state.firstUnreadMessageId[activeKey] : undefined}
              />
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
            onOpenFingerprint={(userId) => openFingerprint(userId, userId === state.myUserId)}
          />
        )}
      </div>

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
