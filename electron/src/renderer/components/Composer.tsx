import { useState } from 'react'
import { MAX_MESSAGE_TEXT_LENGTH } from '@shared/constants'
import { conversationKey, type ConversationRef } from '../state/types'
import { useStore } from '../state/store'
import styles from './Composer.module.css'

export function Composer({ target, placeholder }: { target: ConversationRef; placeholder: string }) {
  const { dispatch } = useStore()
  const [text, setText] = useState('')

  function handleSubmit(): void {
    const raw = text.trim()
    if (!raw) return

    if (raw === '/clear' || raw.startsWith('/clear ')) {
      dispatch({ type: 'CLEAR_MESSAGES', key: conversationKey(target) })
      setText('')
      return
    }

    const isAction = raw === '/me' || raw.startsWith('/me ')
    const message = isAction ? raw.replace(/^\/me\s?/, '') : raw
    if (isAction && !message) {
      setText('')
      return
    }

    window.portochat.sendMessage({
      destinationId: target.type === 'channel' ? target.name : target.userId,
      isChannel: target.type === 'channel',
      text: message,
      isAction
    })
    setText('')
  }

  return (
    <div className={styles.composer}>
      <div className={styles.inputRow}>
        <input
          className={styles.input}
          value={text}
          maxLength={MAX_MESSAGE_TEXT_LENGTH}
          placeholder={placeholder}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSubmit()
          }}
          autoFocus
        />
        <button className={styles.sendButton} onClick={handleSubmit} disabled={!text.trim()}>
          Send
        </button>
      </div>
    </div>
  )
}
