import { useEffect, useState } from 'react'
import authStyles from '../screens/AuthLayout.module.css'
import { Modal } from './Modal'

export function FingerprintDialog({
  userId,
  userName,
  isSelf,
  warned,
  onTrust,
  onClose
}: {
  userId: string
  userName: string
  isSelf: boolean
  warned: boolean
  onTrust: () => void
  onClose: () => void
}) {
  const [fingerprint, setFingerprint] = useState<string | null>(null)

  useEffect(() => {
    const load = isSelf ? window.portochat.getMyFingerprint() : window.portochat.getFingerprint(userId)
    load.then(setFingerprint)
  }, [userId, isSelf])

  return (
    <Modal title={isSelf ? 'Your safety number' : `${userName}'s safety number`} onClose={onClose}>
      <p style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5, marginTop: 0 }}>
        {isSelf
          ? 'Share this with contacts over a trusted channel (in person, voice call) so they can verify messages from you are genuinely end-to-end encrypted to your device.'
          : "Compare this with the number shown on their device, over a channel you trust, before relying on encryption with them."}
      </p>
      <div
        style={{
          fontFamily: 'ui-monospace, monospace',
          fontSize: 16,
          letterSpacing: '0.05em',
          background: 'var(--bg-input)',
          border: '1px solid var(--border)',
          borderRadius: 6,
          padding: '14px 16px',
          textAlign: 'center'
        }}
      >
        {fingerprint ?? 'Not available yet'}
      </div>
      {warned && !isSelf && (
        <p style={{ fontSize: 12, color: 'var(--warning)', marginTop: 12 }}>
          ⚠ This key changed since you last saw it. Only trust it again once you've confirmed
          the new number with {userName} directly.
        </p>
      )}
      <div className={authStyles.field} style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
        {warned && !isSelf && (
          <button
            className={authStyles.primaryButton}
            style={{ width: 'auto', margin: 0 }}
            onClick={() => {
              onTrust()
              onClose()
            }}
          >
            Trust this key
          </button>
        )}
        <button className={authStyles.secondaryButton} style={{ width: 'auto', margin: 0 }} onClick={onClose}>
          Close
        </button>
      </div>
    </Modal>
  )
}
