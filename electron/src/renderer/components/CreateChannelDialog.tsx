import { useState } from 'react'
import { MAX_CHANNEL_NAME_LENGTH } from '@shared/constants'
import authStyles from '../screens/AuthLayout.module.css'
import { Modal } from './Modal'

export function CreateChannelDialog({
  onCreate,
  onClose
}: {
  onCreate: (name: string, e2e: boolean) => void
  onClose: () => void
}) {
  const [name, setName] = useState('')
  const [e2e, setE2e] = useState(false)

  function submit(): void {
    const trimmed = name.trim().replace(/^#/, '')
    if (!trimmed) return
    onCreate(`#${trimmed}`, e2e)
    onClose()
  }

  return (
    <Modal title="Join or create a channel" onClose={onClose}>
      <div className={authStyles.field}>
        <label className={authStyles.label} htmlFor="channel-name">
          Channel name
        </label>
        <input
          id="channel-name"
          className={authStyles.input}
          value={name}
          maxLength={MAX_CHANNEL_NAME_LENGTH}
          placeholder="general"
          autoFocus
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
        />
      </div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
        <input type="checkbox" checked={e2e} onChange={(e) => setE2e(e.target.checked)} />
        End-to-end encrypted (only for clients that support it; cannot be changed later)
      </label>
      <div style={{ display: 'flex', gap: 8, marginTop: 20 }}>
        <button className={authStyles.secondaryButton} onClick={onClose}>
          Cancel
        </button>
        <button className={authStyles.primaryButton} onClick={submit}>
          Join / create
        </button>
      </div>
    </Modal>
  )
}
