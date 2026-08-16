import { useEffect, useState } from 'react'
import { DEFAULT_SERVER_PORT, MAX_NICKNAME_LENGTH } from '@shared/constants'
import { useStore } from '../state/store'
import styles from './AuthLayout.module.css'

export function JoinSetupScreen() {
  const { state, dispatch } = useStore()
  // A browser tab can only ever join the server that served its own page —
  // host/port are prefilled from the page's own origin (see web/config.ts)
  // and can't usefully be changed, so this screen doesn't show them there.
  const canHost = window.portochat.capabilities.canHost
  const [nickname, setNickname] = useState('')
  const [host, setHost] = useState('')
  const [port, setPort] = useState(String(DEFAULT_SERVER_PORT))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    window.portochat.getConfig().then((config) => {
      if (config.lastNickname) setNickname(config.lastNickname)
      if (config.lastHost) setHost(config.lastHost)
      if (config.lastPort) setPort(String(config.lastPort))
    })
  }, [])

  // Surfaces a nickname-in-use rejection back onto this screen — a TCP
  // connect succeeding doesn't mean the server accepted the nickname.
  useEffect(() => {
    if (busy && state.nameError) {
      setError(state.nameError)
      setBusy(false)
    }
  }, [state.nameError, busy])

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
      await window.portochat.clientConnect(trimmedHost, portNumber, trimmedName)
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
        {canHost && (
          <button
            className={styles.backLink}
            onClick={() => dispatch({ type: 'SET_PHASE', phase: 'launch' })}
          >
            ← Back
          </button>
        )}
        <h1 className={styles.title}>{canHost ? 'Join a server' : 'Join this chat'}</h1>
        <p className={styles.subtitle}>
          {canHost
            ? 'Connect to a Port-O-Chat server already running on your local network — one hosted by this app, or by the browser-based client.'
            : 'Pick a nickname to join.'}
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

        {canHost && (
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
        )}

        <button className={styles.primaryButton} onClick={handleJoin} disabled={busy}>
          {busy ? 'Connecting…' : 'Join'}
        </button>
        <p className={styles.errorText}>{error}</p>
      </div>
    </div>
  )
}
