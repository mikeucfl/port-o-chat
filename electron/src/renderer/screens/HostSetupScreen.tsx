import { useEffect, useState } from 'react'
import { DEFAULT_SERVER_PORT, MAX_NICKNAME_LENGTH } from '@shared/constants'
import { useStore } from '../state/store'
import styles from './AuthLayout.module.css'

export function HostSetupScreen() {
  const { dispatch } = useStore()
  const [nickname, setNickname] = useState('')
  const [port, setPort] = useState(String(DEFAULT_SERVER_PORT))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    window.portochat.getConfig().then((config) => {
      if (config.lastNickname) setNickname(config.lastNickname)
      if (config.lastPort) setPort(String(config.lastPort))
    })
  }, [])

  async function handleStart(): Promise<void> {
    const trimmedName = nickname.trim()
    const portNumber = Number.parseInt(port, 10)
    if (!trimmedName) {
      setError('Enter a nickname.')
      return
    }
    if (!Number.isInteger(portNumber) || portNumber < 1 || portNumber > 65535) {
      setError('Enter a valid port (1-65535).')
      return
    }

    setBusy(true)
    setError(null)
    try {
      const result = await window.portochat.hostStart(portNumber)
      dispatch({ type: 'HOST_INFO', port: result.port, lanAddresses: result.lanAddresses })
      await window.portochat.clientConnect('127.0.0.1', result.port, trimmedName)
      await window.portochat.setConfig({ lastNickname: trimmedName, lastPort: result.port })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start the server.')
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
        <h1 className={styles.title}>Host a server</h1>
        <p className={styles.subtitle}>
          Starts a chat server on this machine and connects you to it. Other people on your LAN
          can join using this computer's address and the port below.
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
            onKeyDown={(e) => e.key === 'Enter' && handleStart()}
            autoFocus
          />
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="port">
            Port
          </label>
          <input
            id="port"
            className={styles.input}
            value={port}
            onChange={(e) => setPort(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleStart()}
          />
        </div>

        <button className={styles.primaryButton} onClick={handleStart} disabled={busy}>
          {busy ? 'Starting…' : 'Start hosting'}
        </button>
        <p className={styles.errorText}>{error}</p>
        <p className={styles.hint}>
          This only works for devices on the same local network. Reaching this server from the
          internet requires port forwarding on your router — Port-O-Chat does not do NAT
          traversal or relaying.
        </p>
      </div>
    </div>
  )
}
