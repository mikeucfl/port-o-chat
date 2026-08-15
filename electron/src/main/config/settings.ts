import { app } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AppConfig } from '@shared/protocolTypes'

// The ONLY thing ever persisted to disk by this app. Deliberately a narrow,
// explicit field set (window size, last nickname, last host/port) — never a
// generic "save arbitrary data" API, so chat content and key material have
// no path to disk by construction. See README.md's no-persistence guarantee.

const CONFIG_FILENAME = 'config.json'

function configPath(): string {
  return join(app.getPath('userData'), CONFIG_FILENAME)
}

let cache: AppConfig | null = null

export function loadConfig(): AppConfig {
  if (cache) return cache
  const path = configPath()
  if (!existsSync(path)) {
    cache = {}
    return cache
  }
  try {
    const raw = readFileSync(path, 'utf8')
    const parsed = JSON.parse(raw) as unknown
    cache = isAppConfig(parsed) ? parsed : {}
  } catch {
    cache = {}
  }
  return cache
}

export function saveConfigPatch(patch: Partial<AppConfig>): AppConfig {
  const current = loadConfig()
  cache = { ...current, ...patch }
  try {
    writeFileSync(configPath(), JSON.stringify(cache, null, 2), 'utf8')
  } catch {
    // Config persistence is a convenience, not a requirement — never let a
    // disk write failure crash the app.
  }
  return cache
}

function isAppConfig(value: unknown): value is AppConfig {
  return typeof value === 'object' && value !== null
}
