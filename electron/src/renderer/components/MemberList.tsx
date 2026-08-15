import type { UserDto } from '@shared/protocolTypes'
import { avatarColorForUserId, initials } from '../utils/avatarColor'
import styles from './MemberList.module.css'

export function MemberList({
  members,
  peerKeyWarnings,
  onOpenFingerprint
}: {
  members: UserDto[]
  peerKeyWarnings: Record<string, unknown>
  onOpenFingerprint: (userId: string) => void
}) {
  return (
    <aside className={styles.panel}>
      <div className={styles.header}>Members — {members.length}</div>
      {members.map((member) => (
        <button
          key={member.id}
          className={styles.member}
          onClick={() => onOpenFingerprint(member.id)}
          title="View safety number"
        >
          <span className={styles.avatar} style={{ background: avatarColorForUserId(member.id) }}>
            {initials(member.name)}
          </span>
          <span className={styles.name}>{member.name}</span>
          {peerKeyWarnings[member.id] ? (
            <span title="Key changed — unverified">⚠</span>
          ) : member.e2eCapable ? (
            <span title="E2E capable">🔒</span>
          ) : null}
        </button>
      ))}
    </aside>
  )
}
