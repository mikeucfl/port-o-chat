import { useStore } from '../state/store'
import styles from './AuthLayout.module.css'

export function LaunchScreen() {
  const { dispatch } = useStore()
  // A browser tab can never bind a listening socket for others to connect
  // to — that's categorical, not a missing feature — so the browser build
  // reports canHost: false and this screen just never offers it, rather
  // than letting someone pick "Host" and then explaining why it failed.
  const canHost = window.portochat.capabilities.canHost

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <h1 className={styles.title}>Port-O-Chat</h1>
        <p className={styles.subtitle}>
          A small LAN chat client and server, with opt-in end-to-end encryption for channels
          and direct messages.
        </p>
        <div className={styles.choiceRow}>
          {canHost && (
            <button
              className={styles.choiceButton}
              onClick={() => dispatch({ type: 'SET_PHASE', phase: 'hostSetup' })}
            >
              <span className={styles.choiceTitle}>Host</span>
              <span className={styles.choiceDesc}>
                Start a server on this machine and connect to it.
              </span>
            </button>
          )}
          <button
            className={styles.choiceButton}
            onClick={() => dispatch({ type: 'SET_PHASE', phase: 'joinSetup' })}
          >
            <span className={styles.choiceTitle}>Join</span>
            <span className={styles.choiceDesc}>Connect to a server already running on your LAN.</span>
          </button>
        </div>
      </div>
    </div>
  )
}
