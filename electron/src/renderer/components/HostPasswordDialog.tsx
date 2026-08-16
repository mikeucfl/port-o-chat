import { useState } from 'react'
import authStyles from '../screens/AuthLayout.module.css'
import { Modal } from './Modal'

/**
 * Lets the person hosting change (or clear) the join password while the
 * server is running — only reachable from the host's own UI, since it
 * calls hostSetPassword directly rather than going through the chat
 * protocol at all. A live change only gates *future* SetUserName attempts
 * on new connections; nobody already connected gets kicked or
 * re-challenged (see chatCore.ts/router.ts).
 */
export function HostPasswordDialog({ onClose }: { onClose: () => void }) {
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)

  async function handleSave(): Promise<void> {
    setBusy(true)
    try {
      await window.portochat.hostSetPassword(password)
      setSaved(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title="Server password" onClose={onClose}>
      <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5, marginTop: 0 }}>
        Changing this only affects new people trying to join from now on — anyone already
        connected stays connected.
      </p>
      <div className={authStyles.field}>
        <label className={authStyles.label} htmlFor="host-password">
          New password
        </label>
        <input
          id="host-password"
          type="password"
          className={authStyles.input}
          value={password}
          placeholder="Leave blank for no password"
          autoFocus
          onChange={(e) => {
            setPassword(e.target.value)
            setSaved(false)
          }}
          onKeyDown={(e) => e.key === 'Enter' && handleSave()}
        />
      </div>
      {saved && (
        <p style={{ fontSize: 13, color: 'var(--accent)', margin: '4px 0 0' }}>
          {password ? 'Password updated.' : 'Password cleared — anyone can join now.'}
        </p>
      )}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
        <button
          className={authStyles.secondaryButton}
          style={{ width: 'auto', margin: 0 }}
          onClick={onClose}
        >
          Done
        </button>
        <button
          className={authStyles.primaryButton}
          style={{ width: 'auto', margin: 0 }}
          disabled={busy}
          onClick={handleSave}
        >
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>
    </Modal>
  )
}
