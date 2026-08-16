import { useEffect, useState } from 'react'
import { MAX_NICKNAME_LENGTH } from '@shared/constants'
import { useStore } from '../state/store'
import styles from './AuthLayout.module.css'

/**
 * The browser build's join flow: password first (if the server has one),
 * then nickname — two separate steps, unlike the desktop form which
 * collects everything at once. Host/port are never shown (a browser tab
 * can only join the server that served its own page — see
 * PORTING-NOTES.md) and are pulled from config, which for the browser
 * build resolves to the page's own origin (web/config.ts).
 *
 * The password step can't just react to global passwordError state the
 * way the desktop form does, since that alone can't distinguish "no
 * response yet" from "succeeded" — it sets up its own one-shot listener
 * for the server's verdict instead.
 */
export function BrowserJoinScreen() {
  const { state } = useStore()
  const [step, setStep] = useState<'password' | 'nickname'>('password')
  const [password, setPassword] = useState('')
  const [nickname, setNickname] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Surfaces a nickname-in-use rejection back onto this screen — a
  // successful WS connect doesn't mean the server accepted the nickname.
  useEffect(() => {
    if (busy && step === 'nickname' && state.nameError) {
      setError(state.nameError)
      setBusy(false)
    }
  }, [state.nameError, busy, step])

  async function handlePasswordSubmit(): Promise<void> {
    setBusy(true)
    setError(null)
    const { lastHost, lastPort } = await window.portochat.getConfig()
    try {
      await window.portochat.clientConnect(lastHost ?? '', lastPort ?? 0, password)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not connect.')
      setBusy(false)
      return
    }
    const unsubscribe = window.portochat.onPasswordResult((result) => {
      unsubscribe()
      setBusy(false)
      if (result.success) {
        setStep('nickname')
      } else {
        setError('Incorrect password.')
      }
    })
  }

  async function handleNicknameSubmit(): Promise<void> {
    const trimmedName = nickname.trim()
    if (!trimmedName) {
      setError('Enter a nickname.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await window.portochat.setNickname(trimmedName)
      await window.portochat.setConfig({ lastNickname: trimmedName })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not join.')
      setBusy(false)
    }
    // A rejection (name in use) surfaces reactively via state.nameError,
    // watched below; success advances the whole app to the 'chat' phase
    // (see reducer.ts's NAME_RESULT case), unmounting this screen.
  }

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <h1 className={styles.title}>Join this chat</h1>

        {step === 'password' ? (
          <>
            <p className={styles.subtitle}>
              Enter the server's password, or leave blank if it doesn't have one.
            </p>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="join-password">
                Password
              </label>
              <input
                id="join-password"
                type="password"
                className={styles.input}
                value={password}
                placeholder="Leave blank if none"
                autoFocus
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handlePasswordSubmit()}
              />
            </div>
            <button className={styles.primaryButton} onClick={handlePasswordSubmit} disabled={busy}>
              {busy ? 'Connecting…' : 'Continue'}
            </button>
          </>
        ) : (
          <>
            <p className={styles.subtitle}>Pick a nickname to join.</p>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="join-nickname">
                Nickname
              </label>
              <input
                id="join-nickname"
                className={styles.input}
                value={nickname}
                maxLength={MAX_NICKNAME_LENGTH}
                autoFocus
                onChange={(e) => setNickname(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleNicknameSubmit()}
              />
            </div>
            <button className={styles.primaryButton} onClick={handleNicknameSubmit} disabled={busy}>
              {busy ? 'Joining…' : 'Join'}
            </button>
          </>
        )}
        <p className={styles.errorText}>{error}</p>
      </div>
    </div>
  )
}
