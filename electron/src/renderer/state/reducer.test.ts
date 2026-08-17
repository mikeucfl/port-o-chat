import { describe, expect, it } from 'vitest'
import type { ChatMessageDto, UserDto } from '@shared/protocolTypes'
import { reducer } from './reducer'
import { conversationKey, initialState, type AppState } from './types'

function baseState(overrides: Partial<AppState> = {}): AppState {
  return { ...initialState, myUserId: 'me', phase: 'chat', connection: 'connected', ...overrides }
}

function userDto(overrides: Partial<UserDto> = {}): UserDto {
  return { id: 'u1', name: 'mike', host: '127.0.0.1', e2eCapable: false, ...overrides }
}

function msg(overrides: Partial<ChatMessageDto> = {}): ChatMessageDto {
  return {
    clientMessageId: 'm1',
    senderId: 'other',
    destinationId: '#general',
    isChannel: true,
    isAction: false,
    message: 'hi',
    timestamp: Date.now(),
    e2e: false,
    decryptFailed: false,
    ...overrides
  }
}

describe('unread tracking', () => {
  it('increments unread and sets the divider on the first unread message for a conversation that is not open', () => {
    const state = baseState()
    const next = reducer(state, { type: 'CHAT_MESSAGE', message: msg({ clientMessageId: 'm1' }) })

    const key = conversationKey({ type: 'channel', name: '#general' })
    expect(next.unreadCounts[key]).toBe(1)
    expect(next.firstUnreadMessageId[key]).toBe('m1')
  })

  it('does not move the divider to a later message once one unread message has already set it', () => {
    let state = baseState()
    state = reducer(state, { type: 'CHAT_MESSAGE', message: msg({ clientMessageId: 'm1' }) })
    state = reducer(state, { type: 'CHAT_MESSAGE', message: msg({ clientMessageId: 'm2' }) })

    const key = conversationKey({ type: 'channel', name: '#general' })
    expect(state.unreadCounts[key]).toBe(2)
    expect(state.firstUnreadMessageId[key]).toBe('m1')
  })

  it('does not count a message as unread while its conversation is the focused, active one', () => {
    const state = baseState({
      activeConversation: { type: 'channel', name: '#general' },
      windowFocused: true
    })
    const next = reducer(state, { type: 'CHAT_MESSAGE', message: msg() })

    const key = conversationKey({ type: 'channel', name: '#general' })
    expect(next.unreadCounts[key] ?? 0).toBe(0)
    expect(next.firstUnreadMessageId[key]).toBeUndefined()
  })

  it('does count a message as unread when the conversation is active but the window is unfocused', () => {
    const state = baseState({
      activeConversation: { type: 'channel', name: '#general' },
      windowFocused: false
    })
    const next = reducer(state, { type: 'CHAT_MESSAGE', message: msg() })

    const key = conversationKey({ type: 'channel', name: '#general' })
    expect(next.unreadCounts[key]).toBe(1)
  })

  it('regaining window focus clears unread for the currently active conversation', () => {
    let state = baseState({
      activeConversation: { type: 'channel', name: '#general' },
      windowFocused: false
    })
    state = reducer(state, { type: 'CHAT_MESSAGE', message: msg() })
    const key = conversationKey({ type: 'channel', name: '#general' })
    expect(state.unreadCounts[key]).toBe(1)

    state = reducer(state, { type: 'WINDOW_FOCUS_CHANGED', focused: true })
    expect(state.unreadCounts[key] ?? 0).toBe(0)
  })

  it('opening a conversation clears its unread badge but keeps its divider, and clears the divider of the one left behind', () => {
    let state = baseState()
    state = reducer(state, { type: 'CHAT_MESSAGE', message: msg({ clientMessageId: 'm1' }) })
    const generalKey = conversationKey({ type: 'channel', name: '#general' })
    expect(state.unreadCounts[generalKey]).toBe(1)

    // Open #general: badge clears, divider (from before opening) stays.
    state = reducer(state, { type: 'OPEN_CONVERSATION', ref: { type: 'channel', name: '#general' } })
    expect(state.unreadCounts[generalKey] ?? 0).toBe(0)
    expect(state.firstUnreadMessageId[generalKey]).toBe('m1')

    // Navigate away to a different conversation: #general's divider is dropped.
    state = reducer(state, { type: 'OPEN_CONVERSATION', ref: { type: 'dm', userId: 'other' } })
    expect(state.firstUnreadMessageId[generalKey]).toBeUndefined()
  })
})

describe('reconnect', () => {
  it('remembers connection info so a later unexpected drop can be retried without re-prompting', () => {
    const state = baseState()
    const next = reducer(state, {
      type: 'SET_CONNECTION_INFO',
      host: '192.168.1.5',
      port: 3456,
      password: 'hunter2'
    })
    expect(next.connectionInfo).toEqual({ host: '192.168.1.5', port: 3456, password: 'hunter2' })
  })

  it('tracks reconnect attempts and clears back to idle on success', () => {
    let state = baseState()
    state = reducer(state, { type: 'RECONNECT_STATUS', status: 'reconnecting', attempt: 2 })
    expect(state.reconnectStatus).toBe('reconnecting')
    expect(state.reconnectAttempt).toBe(2)

    state = reducer(state, { type: 'RECONNECT_STATUS', status: 'idle', attempt: 0 })
    expect(state.reconnectStatus).toBe('idle')
    expect(state.reconnectAttempt).toBe(0)
  })

  it('MANUAL_RECONNECT bumps a nonce the store watches to kick off a fresh attempt', () => {
    const state = baseState({ reconnectNonce: 0 })
    const next = reducer(state, { type: 'MANUAL_RECONNECT' })
    expect(next.reconnectNonce).toBe(1)
  })

  it('RESET_SESSION (an intentional disconnect) clears connection info and reconnect state', () => {
    const state = baseState({
      connectionInfo: { host: 'x', port: 1, password: '' },
      reconnectStatus: 'exhausted',
      reconnectAttempt: 5
    })
    const next = reducer(state, { type: 'RESET_SESSION' })
    expect(next.connectionInfo).toBeNull()
    expect(next.reconnectStatus).toBe('idle')
    expect(next.reconnectAttempt).toBe(0)
    expect(next.phase).toBe('launch')
  })
})

describe('user connection status', () => {
  it('tracks a disconnected user as offline without dropping them from the list', () => {
    const state = baseState({ users: { u1: userDto({ id: 'u1' }) } })
    const next = reducer(state, {
      type: 'USER_CONNECTION_STATUS',
      event: { user: userDto({ id: 'u1' }), connected: false }
    })
    expect(next.users['u1']).toBeDefined()
    expect(next.offlineUserIds['u1']).toBe(true)
  })

  it('reconnecting under a new id drops the old offline entry for the same name (no duplicate "mike"s)', () => {
    let state = baseState({ users: { u1: userDto({ id: 'u1', name: 'mike' }) } })
    state = reducer(state, {
      type: 'USER_CONNECTION_STATUS',
      event: { user: userDto({ id: 'u1', name: 'mike' }), connected: false }
    })
    expect(state.offlineUserIds['u1']).toBe(true)

    // Server restart: same person reconnects and gets a fresh id.
    const next = reducer(state, {
      type: 'USER_CONNECTION_STATUS',
      event: { user: userDto({ id: 'u2', name: 'mike' }), connected: true }
    })
    expect(next.users['u1']).toBeUndefined()
    expect(next.offlineUserIds['u1']).toBeUndefined()
    expect(next.users['u2']).toBeDefined()
    expect(next.offlineUserIds['u2']).toBeUndefined()
    expect(Object.keys(next.users)).toEqual(['u2'])
  })

  it('does not touch a same-named entry that is still online (server already guarantees uniqueness, so this should never happen, but stay conservative)', () => {
    const state = baseState({ users: { u1: userDto({ id: 'u1', name: 'mike' }) } })
    const next = reducer(state, {
      type: 'USER_CONNECTION_STATUS',
      event: { user: userDto({ id: 'u2', name: 'mike' }), connected: true }
    })
    expect(next.users['u1']).toBeDefined()
    expect(next.users['u2']).toBeDefined()
  })
})

describe('leaving a channel', () => {
  it('removes the local user from that channel\'s member cache (the server never echoes our own part back to us)', () => {
    const state = baseState({ channelMembers: { '#general': ['me', 'other'] } })
    const next = reducer(state, { type: 'CLOSE_CONVERSATION', ref: { type: 'channel', name: '#general' } })

    expect(next.channelMembers['#general']).toEqual(['other'])
  })

  it('leaves other channels\' member lists untouched', () => {
    const state = baseState({
      channelMembers: { '#general': ['me', 'other'], '#random': ['me', 'someone-else'] }
    })
    const next = reducer(state, { type: 'CLOSE_CONVERSATION', ref: { type: 'channel', name: '#general' } })

    expect(next.channelMembers['#random']).toEqual(['me', 'someone-else'])
  })
})
