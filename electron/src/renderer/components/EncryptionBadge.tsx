import styles from './EncryptionBadge.module.css'

export function EncryptionBadge({ encrypted }: { encrypted: boolean }) {
  return (
    <span className={`${styles.badge} ${encrypted ? styles.encrypted : styles.plain}`}>
      {encrypted ? '🔒 Encrypted' : 'Not encrypted'}
    </span>
  )
}
