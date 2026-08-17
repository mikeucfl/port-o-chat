import { useLayoutEffect, useRef, useState } from 'react'
import { MAX_MESSAGE_TEXT_LENGTH } from '@shared/constants'
import { conversationKey, type ConversationRef } from '../state/types'
import { useStore } from '../state/store'
import styles from './Composer.module.css'

const MAX_TEXTAREA_HEIGHT_PX = 160

export function Composer({ target, placeholder }: { target: ConversationRef; placeholder: string }) {
  const { state, dispatch } = useStore()
  const [text, setText] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  // Sending while disconnected used to silently vanish — the transport
  // layer no-ops a send() when not connected (see net/wsClient.ts), with
  // no error surfaced. Blocking it here instead, with a visible reason,
  // rather than letting the text just disappear.
  const connected = state.connection === 'connected'

  // Auto-grows with content up to a cap, then scrolls — a plain <input>
  // can't hold a newline at all, so multi-line (Shift+Enter) messages
  // needed this to be a <textarea> in the first place.
  useLayoutEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, MAX_TEXTAREA_HEIGHT_PX)}px`
  }, [text])

  function handleSubmit(): void {
    const raw = text.trim()
    if (!raw) return

    if (raw === '/clear' || raw.startsWith('/clear ')) {
      dispatch({ type: 'CLEAR_MESSAGES', key: conversationKey(target) })
      setText('')
      textareaRef.current?.focus()
      return
    }

    if (!connected) return

    const isAction = raw === '/me' || raw.startsWith('/me ')
    const message = isAction ? raw.replace(/^\/me\s?/, '') : raw
    if (isAction && !message) {
      setText('')
      textareaRef.current?.focus()
      return
    }

    window.portochat.sendMessage({
      destinationId: target.type === 'channel' ? target.name : target.userId,
      isChannel: target.type === 'channel',
      text: message,
      isAction
    })
    setText('')
    // Tapping the Send button already avoids blurring (see its
    // onMouseDown below) — this is the fallback for anything that still
    // drops focus, so the mobile keyboard doesn't jarringly close and
    // reopen between messages.
    textareaRef.current?.focus()
  }

  return (
    <div className={styles.composer}>
      <div className={styles.inputRow}>
        <textarea
          ref={textareaRef}
          className={styles.input}
          rows={1}
          value={text}
          maxLength={MAX_MESSAGE_TEXT_LENGTH}
          placeholder={connected ? placeholder : "Disconnected — can't send right now"}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              handleSubmit()
            }
          }}
          autoFocus
        />
        <button
          className={styles.sendButton}
          // Tapping a button blurs whatever input was focused *before* the
          // click handler even runs — on mobile that's what closes the
          // keyboard on every send. Blocking the mousedown's default
          // action keeps focus on the textarea the whole time instead.
          onMouseDown={(e) => e.preventDefault()}
          onClick={handleSubmit}
          disabled={!text.trim() || !connected}
        >
          Send
        </button>
      </div>
    </div>
  )
}
