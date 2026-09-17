/**
 * A dashboard-chat tool approval reaches the client as a `chat_message` frame
 * with `role: 'permission'`, not as an `approval` frame, so the attention
 * surfaces have to key off the permission row itself.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { createElement } from 'react'
import { Provider } from 'react-redux'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useWebSocket } from '../hooks/useWebSocket'
import { store } from '../store'
import { setActiveSlot, clearMessages, clearSlotState } from '../store/chatSlice'
import { MC_NOTIFICATION_EVENT, APPROVAL_KIND, type McNotificationDetail } from '../hooks/notificationEvent'
import { APPROVAL_NOTIFICATION_TAG } from '../hooks/approvalAttention'

vi.mock('../api/client', () => ({
  api: {
    chatSlots: vi.fn().mockResolvedValue([]),
    voiceConfig: vi.fn().mockResolvedValue({ autoSpeak: false }),
    voiceSynthesize: vi.fn().mockResolvedValue({}),
    approvals: vi.fn().mockResolvedValue([]),
    notifications: vi.fn().mockResolvedValue({ notifications: [], unread: 0 }),
    chatSlotDetail: vi.fn().mockResolvedValue({ messages: [], running: false, has_more: false, total: 0, queue: [] }),
  },
}))

const WS_INSTANCES: MockWebSocket[] = []

class MockWebSocket {
  static OPEN = 1
  static CONNECTING = 0
  readyState = MockWebSocket.CONNECTING
  onopen: ((ev: Event) => void) | null = null
  onmessage: ((ev: MessageEvent) => void) | null = null
  onclose: ((ev: CloseEvent) => void) | null = null
  onerror: ((ev: Event) => void) | null = null
  send = vi.fn()
  close = vi.fn()

  constructor() { WS_INSTANCES.push(this) }

  simulateOpen() {
    this.readyState = MockWebSocket.OPEN
    this.onopen?.(new Event('open'))
  }

  simulateMessage(data: object) {
    this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(data) }))
  }
}

const permissionRow = (extra: Record<string, unknown> = {}) => ({
  type: 'chat_message',
  data: {
    slot: 'slot-1',
    role: 'permission',
    content: 'execute_bash',
    ts: '10.0',
    meta: { request_id: 'req-1', tool_input: 'rm /tmp/x' },
    ...extra,
  },
})

describe('useWebSocket dashboard-chat permission row attention', () => {
  let queryClient: QueryClient
  let sounds: McNotificationDetail[]
  const onSound = (ev: Event) => { sounds.push((ev as CustomEvent<McNotificationDetail>).detail) }

  beforeEach(() => {
    vi.clearAllMocks()
    WS_INSTANCES.length = 0
    sounds = []
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    vi.stubGlobal('WebSocket', MockWebSocket)
    window.addEventListener(MC_NOTIFICATION_EVENT, onSound)
    store.dispatch(clearSlotState())
    store.dispatch(setActiveSlot('slot-1'))
  })

  afterEach(() => {
    window.removeEventListener(MC_NOTIFICATION_EVENT, onSound)
    vi.unstubAllGlobals()
    // Restore the prototype getter shadowed by a per-test own property.
    delete (document as { hidden?: boolean }).hidden
    store.dispatch(clearMessages())
    store.dispatch(clearSlotState())
    store.dispatch(setActiveSlot(null))
  })

  async function mount() {
    function wrapper({ children }: { children: React.ReactNode }) {
      return createElement(Provider, { store },
        createElement(QueryClientProvider, { client: queryClient }, children))
    }
    const hook = renderHook(() => useWebSocket(), { wrapper })
    const ws = WS_INSTANCES[0]
    act(() => { ws.simulateOpen() })
    await act(async () => {})
    return { hook, ws }
  }

  it('plays the approval sound when a pending permission row arrives', async () => {
    const { hook, ws } = await mount()

    act(() => { ws.simulateMessage(permissionRow()) })
    await act(async () => {})

    expect(sounds.map(s => s.kind)).toContain(APPROVAL_KIND)
    expect(store.getState().chat.messages.some(m => m.role === 'permission')).toBe(true)

    hook.unmount()
  })

  it('shows the native approval banner for a pending row when the tab is hidden', async () => {
    const created: Array<{ title: string; options?: NotificationOptions }> = []
    class RecordingNotification {
      static permission: NotificationPermission = 'granted'
      static requestPermission = vi.fn()
      constructor(title: string, options?: NotificationOptions) { created.push({ title, options }) }
    }
    vi.stubGlobal('Notification', RecordingNotification)
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true })
    const { hook, ws } = await mount()

    act(() => { ws.simulateMessage(permissionRow({ meta: { request_id: 'req-1', tool_title: 'rm /tmp/x' } })) })
    await act(async () => {})

    expect(created).toHaveLength(1)
    expect(created[0].options?.body).toBe('rm /tmp/x')
    expect(created[0].options?.tag).toBe(APPROVAL_NOTIFICATION_TAG)

    hook.unmount()
  })

  it('stays quiet for a permission row that is already resolved', async () => {
    const { hook, ws } = await mount()

    // A batch rejection cascades: rejecting one tool appends a row per
    // remaining tool, already resolved.
    act(() => {
      ws.simulateMessage(permissionRow({ meta: { request_id: 'req-1', resolved: 'rejected' } }))
    })
    await act(async () => {})

    expect(sounds.map(s => s.kind)).not.toContain(APPROVAL_KIND)

    hook.unmount()
  })

  it('stays quiet for a slot-less permission row', async () => {
    const { hook, ws } = await mount()

    act(() => { ws.simulateMessage(permissionRow({ slot: undefined })) })
    await act(async () => {})

    expect(sounds.map(s => s.kind)).not.toContain(APPROVAL_KIND)

    hook.unmount()
  })

  it('does not chime for an ordinary assistant row', async () => {
    const { hook, ws } = await mount()

    act(() => {
      ws.simulateMessage({
        type: 'chat_message',
        data: { slot: 'slot-1', role: 'assistant', content: 'done', ts: '11.0' },
      })
    })
    await act(async () => {})

    expect(sounds.map(s => s.kind)).not.toContain(APPROVAL_KIND)

    hook.unmount()
  })
})
