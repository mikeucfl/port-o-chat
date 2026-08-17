import { useEffect, useState } from 'react'
import { DEFAULT_SERVER_PORT, MAX_NICKNAME_LENGTH } from '@shared/constants'
import { useStore } from '../state/store'
import styles from './AuthLayout.module.css'
import { BrowserJoinScreen } from './BrowserJoinScreen'

export function JoinSetupScreen() {
  const { state, dispatch } = useStore()
  // A browser tab can only ever join the server that served its own page —
  // it gets a structurally different (password-then-nickname) flow, since
  // it can't usefully show host/port fields at all. See PORTING-NOTES.md.
  if (!window.portochat.capabilities.canHost) {
    return <BrowserJoinScreen />
  }

  return <DesktopJoinForm state={state} dispatch={dispatch} />
}

function DesktopJoinForm({
  state,
  dispatch
}: Pick<ReturnType<typeof useStore>, 'state' | 'dispatch'>) {
  const [nickname, setNickname] = useState('')
  const [host, setHost] = useState('')
  const [port, setPort] = useState(String(DEFAULT_SERVER_PORT))
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    window.portochat.getConfig().then((config) => {
      if (config.lastNickname) setNickname(config.lastNickname)
      if (config.lastHost) setHost(config.lastHost)
      if (config.lastPort) setPort(String(config.lastPort))
    })
  }, [])

  // Surfaces a nickname-in-use or incorrect-password rejection back onto
  // this screen — a WS connect succeeding doesn't mean either was accepted.
  useEffect(() => {
    if (!busy) return
    if (state.passwordError) {
      setError(state.passwordError)
      setBusy(false)
    } else if (state.nameError) {
      setError(state.nameError)
      setBusy(false)
    }
  }, [state.nameError, state.passwordError, busy])

  async function handleJoin(): Promise<void> {
    const trimmedName = nickname.trim()
    const trimmedHost = host.trim()
    const portNumber = Number.parseInt(port, 10)
    if (!trimmedName) {
      setError('Enter a nickname.')
      return
    }
    if (!trimmedHost) {
      setError('Enter a server address.')
      return
    }
    if (!Number.isInteger(portNumber) || portNumber < 1 || portNumber > 65535) {
      setError('Enter a valid port (1-65535).')
      return
    }

    setBusy(true)
    setError(null)
    try {
      await window.portochat.clientConnect(trimmedHost, portNumber, password)
      dispatch({ type: 'SET_CONNECTION_INFO', host: trimmedHost, port: portNumber, password })
      await window.portochat.setNickname(trimmedName)
      await window.portochat.setConfig({
        lastNickname: trimmedName,
        lastHost: trimmedHost,
        lastPort: portNumber
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not connect.')
      setBusy(false)
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <button
          className={styles.backLink}
          onClick={() => dispatch({ type: 'SET_PHASE', phase: 'launch' })}
        >
          ← Back
        </button>
        <h1 className={styles.title}>Join a server</h1>
        <p className={styles.subtitle}>
          Connect to a Port-O-Chat server already running on your local network — one hosted by
          this app, or by the browser-based client.
        </p>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="nickname">
            Nickname
          </label>
          <input
            id="nickname"
            className={styles.input}
            value={nickname}
            maxLength={MAX_NICKNAME_LENGTH}
            onChange={(e) => setNickname(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
            autoFocus
          />
        </div>

        <div className={styles.row}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="host">
              Server address
            </label>
            <input
              id="host"
              className={styles.input}
              value={host}
              placeholder="192.168.1.42"
              onChange={(e) => setHost(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
            />
          </div>
          <div className={styles.field} style={{ maxWidth: 110 }}>
            <label className={styles.label} htmlFor="port">
              Port
            </label>
            <input
              id="port"
              className={styles.input}
              value={port}
              onChange={(e) => setPort(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
            />
          </div>
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="join-password">
            Password <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(if required)</span>
          </label>
          <input
            id="join-password"
            type="password"
            className={styles.input}
            value={password}
            placeholder="Leave blank if none"
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
          />
        </div>

        <button className={styles.primaryButton} onClick={handleJoin} disabled={busy}>
          {busy ? 'Connecting…' : 'Join'}
        </button>
        <p className={styles.errorText}>{error}</p>
      </div>
    </div>
  )
}
