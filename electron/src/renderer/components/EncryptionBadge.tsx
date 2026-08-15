import styles from './EncryptionBadge.module.css'

export type EncryptionStatus = 'plain' | 'encrypted' | 'pending' | 'warning'

const LABELS: Record<EncryptionStatus, string> = {
  plain: 'Not encrypted',
  encrypted: '🔒 Encrypted',
  pending: '⏳ Establishing encryption…',
  warning: '⚠ Key unverified'
}

const CLASS: Record<EncryptionStatus, string> = {
  plain: styles.plain,
  encrypted: styles.encrypted,
  pending: styles.pending,
  warning: styles.warning
}

export function EncryptionBadge({ status }: { status: EncryptionStatus }) {
  return <span className={`${styles.badge} ${CLASS[status]}`}>{LABELS[status]}</span>
}
