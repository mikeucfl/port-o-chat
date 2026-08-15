export function VerifyNudgeBanner({
  userName,
  onViewFingerprint,
  onDismiss
}: {
  userName: string
  onViewFingerprint: () => void
  onDismiss: () => void
}) {
  return (
    <div
      style={{
        background: 'rgba(88, 101, 242, 0.12)',
        borderBottom: '1px solid var(--accent)',
        color: 'var(--text-primary)',
        fontSize: 12,
        padding: '8px 20px',
        display: 'flex',
        alignItems: 'center',
        gap: 10
      }}
    >
      <span>
        🔒 This conversation with {userName} is end-to-end encrypted. Verify their safety number
        so you know the server isn't in the middle.
      </span>
      <div style={{ display: 'flex', gap: 8, marginLeft: 'auto', flexShrink: 0 }}>
        <button
          onClick={onViewFingerprint}
          style={{
            background: 'none',
            border: '1px solid var(--accent)',
            color: 'var(--accent)',
            borderRadius: 4,
            padding: '2px 8px',
            fontSize: 11
          }}
        >
          Verify
        </button>
        <button
          onClick={onDismiss}
          title="Dismiss"
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--text-muted)',
            fontSize: 13,
            padding: '2px 4px'
          }}
        >
          ✕
        </button>
      </div>
    </div>
  )
}
