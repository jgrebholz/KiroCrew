/**
 * The approval attention surfaces (sound, hidden-tab native banner) are one
 * helper shared by both approval deliveries. These tests pin the helper's own
 * policy so a receiver test only has to show that it calls the helper.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { announceApprovalPending, shouldAnnounceApproval, APPROVAL_NOTIFICATION_TAG } from '../hooks/approvalAttention'
import { MC_NOTIFICATION_EVENT, APPROVAL_KIND, type McNotificationDetail } from '../hooks/notificationEvent'

class RecordingNotification {
  static permission: NotificationPermission = 'granted'
  static requestPermission = vi.fn()
  static created: Array<{ title: string; options?: NotificationOptions }> = []
  constructor(title: string, options?: NotificationOptions) {
    RecordingNotification.created.push({ title, options })
  }
}

/** What Android Chrome does. */
class ThrowingNotification {
  static permission: NotificationPermission = 'granted'
  static requestPermission = vi.fn()
  constructor() {
    throw new TypeError('Illegal constructor')
  }
}

describe('shouldAnnounceApproval', () => {
  it('announces a live approval', () => {
    expect(shouldAnnounceApproval({ reconnecting: false })).toBe(true)
  })

  it('stays silent during reconnect catch-up replay', () => {
    expect(shouldAnnounceApproval({ reconnecting: true })).toBe(false)
  })
})

describe('announceApprovalPending', () => {
  let sounds: McNotificationDetail[]
  const onSound = (ev: Event) => { sounds.push((ev as CustomEvent<McNotificationDetail>).detail) }
  const hideTab = (hidden: boolean) => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden })
  }

  beforeEach(() => {
    sounds = []
    RecordingNotification.created = []
    RecordingNotification.permission = 'granted'
    window.addEventListener(MC_NOTIFICATION_EVENT, onSound)
    vi.stubGlobal('Notification', RecordingNotification)
  })

  afterEach(() => {
    window.removeEventListener(MC_NOTIFICATION_EVENT, onSound)
    vi.unstubAllGlobals()
    // Restore the prototype getter shadowed by the per-test own property.
    delete (document as { hidden?: boolean }).hidden
  })

  it('chimes and shows the banner naming the tool when the tab is hidden', () => {
    hideTab(true)
    announceApprovalPending({ tool: 'execute_bash', reconnecting: false })

    expect(sounds.map(s => s.kind)).toEqual([APPROVAL_KIND])
    expect(RecordingNotification.created).toHaveLength(1)
    expect(RecordingNotification.created[0].options?.body).toBe('execute_bash')
    expect(RecordingNotification.created[0].options?.tag).toBe(APPROVAL_NOTIFICATION_TAG)
  })

  it('chimes without a banner when the tab is visible', () => {
    hideTab(false)
    announceApprovalPending({ tool: 'execute_bash', reconnecting: false })

    expect(sounds.map(s => s.kind)).toEqual([APPROVAL_KIND])
    expect(RecordingNotification.created).toHaveLength(0)
  })

  it('chimes without a banner when notification permission is not granted', () => {
    hideTab(true)
    RecordingNotification.permission = 'default'
    announceApprovalPending({ tool: 'execute_bash', reconnecting: false })

    expect(sounds.map(s => s.kind)).toEqual([APPROVAL_KIND])
    expect(RecordingNotification.created).toHaveLength(0)
    // Permission is a user gesture owned by Settings, never requested here.
    expect(RecordingNotification.requestPermission).not.toHaveBeenCalled()
  })

  it('does nothing during reconnect catch-up replay', () => {
    hideTab(true)
    announceApprovalPending({ tool: 'execute_bash', reconnecting: true })

    expect(sounds).toHaveLength(0)
    expect(RecordingNotification.created).toHaveLength(0)
  })

  it('falls back to a generic body when the tool is unnamed', () => {
    hideTab(true)
    announceApprovalPending({ reconnecting: false })

    expect(RecordingNotification.created).toHaveLength(1)
    expect(RecordingNotification.created[0].options?.body).toBeTruthy()
  })

  it('survives a throwing Notification constructor after the chime', () => {
    hideTab(true)
    vi.stubGlobal('Notification', ThrowingNotification)

    expect(() => announceApprovalPending({ tool: 'execute_bash', reconnecting: false })).not.toThrow()
    expect(sounds.map(s => s.kind)).toEqual([APPROVAL_KIND])
  })

  it('chimes on a platform with no Notification API at all', () => {
    hideTab(true)
    vi.stubGlobal('Notification', undefined)

    expect(() => announceApprovalPending({ tool: 'execute_bash', reconnecting: false })).not.toThrow()
    expect(sounds.map(s => s.kind)).toEqual([APPROVAL_KIND])
  })
})
