import type { ReactNode } from 'react'
import styles from './Modal.module.css'

export function Modal({
  title,
  onClose,
  children
}: {
  title: string
  onClose: () => void
  children: ReactNode
}) {
  return (
    <div
      className={styles.overlay}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className={styles.dialog} role="dialog" aria-modal="true" aria-label={title}>
        <h2 className={styles.title}>{title}</h2>
        {children}
      </div>
    </div>
  )
}
