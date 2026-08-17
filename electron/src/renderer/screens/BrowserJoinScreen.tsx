import { useEffect, useState } from 'react'
import { MAX_NICKNAME_LENGTH } from '@shared/constants'
import { useStore } from '../state/store'
import styles from './AuthLayout.module.css'

/**
 * The browser build's join flow. Host/port are never shown (a browser tab
 * can only join the server that served its own page — see
 * PORTING-NOTES.md) and are pulled from config, which for the browser
 * build resolves to the page's own origin (web/config.ts).
 *
 * On mount, it silently probes the server with an empty password before
 * showing anything — most servers have none set, so this skips the
 * password prompt entirely for the common case. The prompt only appears if
 * that probe actually comes back IncorrectPassword, i.e. the server really
 * does require one.
 *
 * Can't just react to global passwordError state the way the desktop form
 * does, since that alone can't distinguish "no response yet" from
 * "succeeded" — it sets up its own one-shot listener for the server's
 * verdict instead, both for the silent probe and for a manual retry.
 */
export function BrowserJoinScreen() {
  const { state, dispatch } = useStore()
  const [step, setStep] = useState<'connecting' | 'password' | 'nickname'>('connecting')
  const [password, setPassword] = useState('')
  const [nickname, setNickname] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void attemptPassword('', { silent: true })
    return () => {
      cancelled = true
    }

    async function attemptPassword(attempt: string, opts: { silent: boolean }): Promise<void> {
      if (!opts.silent) {
        setBusy(true)
        setError(null)
      }
      const { lastHost, lastPort } = await window.portochat.getConfig()
      const host = lastHost ?? ''
      const port = lastPort ?? 0
      try {
        await window.portochat.clientConnect(host, port, attempt)
      } catch (err) {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Could not connect.')
        setStep('password')
        setBusy(false)
        return
      }
      const unsubscribe = window.portochat.onPasswordResult((result) => {
        unsubscribe()
        if (cancelled) return
        setBusy(false)
        if (result.success) {
          dispatch({ type: 'SET_CONNECTION_INFO', host, port, password: attempt })
          setStep('nickname')
        } else {
          // The silent blank-password probe came back rejected — this
          // server genuinely requires one, so *now* ask for it.
          if (opts.silent) setError(null)
          else setError('Incorrect password.')
          setStep('password')
        }
      })
    }
    // handlePasswordSubmit below reuses this same logic non-silently.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
    const host = lastHost ?? ''
    const port = lastPort ?? 0
    try {
      await window.portochat.clientConnect(host, port, password)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not connect.')
      setBusy(false)
      return
    }
    const unsubscribe = window.portochat.onPasswordResult((result) => {
      unsubscribe()
      setBusy(false)
      if (result.success) {
        dispatch({ type: 'SET_CONNECTION_INFO', host, port, password })
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

  if (step === 'connecting') {
    return (
      <div className={styles.page}>
        <div className={styles.card}>
          <h1 className={styles.title}>Join this chat</h1>
          <p className={styles.subtitle}>Connecting…</p>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <h1 className={styles.title}>Join this chat</h1>

        {step === 'password' ? (
          <>
            <p className={styles.subtitle}>This server requires a password to join.</p>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="join-password">
                Password
              </label>
              <input
                id="join-password"
                type="password"
                className={styles.input}
                value={password}
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
