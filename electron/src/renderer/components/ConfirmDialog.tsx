import type { ReactNode } from 'react'
import authStyles from '../screens/AuthLayout.module.css'
import { Modal } from './Modal'

export function ConfirmDialog({
  title,
  message,
  confirmLabel = 'Confirm',
  danger,
  onConfirm,
  onClose
}: {
  title: string
  message: ReactNode
  confirmLabel?: string
  danger?: boolean
  onConfirm: () => void
  onClose: () => void
}) {
  return (
    <Modal title={title} onClose={onClose}>
      <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5, marginTop: 0 }}>
        {message}
      </p>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
        <button className={authStyles.secondaryButton} style={{ width: 'auto', margin: 0 }} onClick={onClose}>
          Cancel
        </button>
        <button
          className={authStyles.primaryButton}
          style={{ width: 'auto', margin: 0, background: danger ? 'var(--danger)' : undefined }}
          onClick={() => {
            onConfirm()
            onClose()
          }}
        >
          {confirmLabel}
        </button>
      </div>
    </Modal>
  )
}
