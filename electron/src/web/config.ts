import { DEFAULT_SERVER_PORT } from '@shared/constants'
import type { AppConfig } from '@shared/protocolTypes'

const NICKNAME_KEY = 'portochat:lastNickname'

/**
 * AppConfig backed by localStorage instead of a config file — only the
 * nickname is actually worth remembering here. Window size is meaningless
 * in a browser tab, and host/port need no persistence at all: the page's
 * own origin already tells you which server you're on.
 */
export function getConfig(): AppConfig {
  return {
    lastNickname: localStorage.getItem(NICKNAME_KEY) ?? undefined,
    lastHost: location.hostname,
    lastPort: Number(location.port) || DEFAULT_SERVER_PORT
  }
}

export function setConfig(patch: Partial<AppConfig>): void {
  if (patch.lastNickname !== undefined) {
    localStorage.setItem(NICKNAME_KEY, patch.lastNickname)
  }
}
