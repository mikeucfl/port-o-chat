export function StuckKeyBanner({ onReset }: { onReset: () => void }) {
  return (
    <div
      style={{
        background: 'rgba(240, 178, 50, 0.12)',
        borderBottom: '1px solid var(--warning)',
        color: 'var(--text-primary)',
        fontSize: 12,
        padding: '8px 20px',
        display: 'flex',
        alignItems: 'center',
        gap: 10
      }}
    >
      <span>
        ⚠ Still waiting on this channel's encryption key. If the member you were expecting it from
        is actually gone, this may never arrive on its own.
      </span>
      <button
        onClick={onReset}
        title="Generates a brand-new key and shares it with everyone currently in the channel"
        style={{
          background: 'none',
          border: '1px solid var(--warning)',
          color: 'var(--warning)',
          borderRadius: 4,
          padding: '2px 8px',
          fontSize: 11,
          marginLeft: 'auto',
          flexShrink: 0,
          whiteSpace: 'nowrap'
        }}
      >
        Start a fresh key
      </button>
    </div>
  )
}
