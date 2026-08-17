import { useState } from 'react'
import { MAX_CHANNEL_TOPIC_LENGTH } from '@shared/constants'
import styles from './ChannelTopicBar.module.css'

export function ChannelTopicBar({
  channel,
  topic,
  canEdit
}: {
  channel: string
  topic: string
  canEdit: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(topic)

  function submit(): void {
    if (draft.trim() !== topic) {
      window.portochat.setChannelTopic(channel, draft.trim())
    }
    setEditing(false)
  }

  if (editing) {
    return (
      <div className={styles.bar}>
        <input
          className={styles.input}
          autoFocus
          value={draft}
          maxLength={MAX_CHANNEL_TOPIC_LENGTH}
          placeholder="Set a topic for this channel…"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={submit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit()
            if (e.key === 'Escape') setEditing(false)
          }}
        />
      </div>
    )
  }

  if (!topic && !canEdit) return null

  return (
    <div
      className={`${styles.bar} ${canEdit ? styles.editable : ''}`}
      title={canEdit ? 'Click to edit the topic' : undefined}
      onClick={() => {
        if (!canEdit) return
        setDraft(topic)
        setEditing(true)
      }}
    >
      {topic ? `Topic: ${topic}` : canEdit ? 'No topic set — click to add one' : ''}
    </div>
  )
}
