export function KeyChangeWarningBanner({
  userName,
  onViewFingerprint
}: {
  userName: string
  onViewFingerprint: () => void
}) {
  return (
    <div
      style={{
        background: 'rgba(240, 178, 50, 0.12)',
        borderBottom: '1px solid var(--warning)',
        color: 'var(--warning)',
        fontSize: 12,
        padding: '8px 20px',
        display: 'flex',
        alignItems: 'center',
        gap: 10
      }}
    >
      <span>
        ⚠ {userName}'s encryption key changed since you last saw it. Verify their safety number
        before trusting messages from them.
      </span>
      <button
        onClick={onViewFingerprint}
        style={{
          background: 'none',
          border: '1px solid var(--warning)',
          color: 'var(--warning)',
          borderRadius: 4,
          padding: '2px 8px',
          fontSize: 11,
          marginLeft: 'auto'
        }}
      >
        Verify
      </button>
    </div>
  )
}
