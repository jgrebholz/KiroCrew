/**
 * Attention surfaces for a tool approval that has just started blocking a
 * turn: the approval sound, and a native OS banner while the tab is hidden.
 *
 * A pending approval reaches the dashboard through two frames that carry
 * different contracts. A coordinator approval arrives as an `approval`
 * frame, which writes the feed entry, registers the id for resolution
 * routing, and injects a card when it names an owning slot. A
 * dashboard-chat approval arrives as the transcript's own `permission` row,
 * which is the card. Those deliveries stay separate; what they share is the
 * user who has to notice. Both call this helper, so an attention surface
 * added here reaches every approval, whichever frame carried it.
 */
import { dispatchMcNotification, APPROVAL_KIND } from './notificationEvent'
import { i18nT } from '../i18n/t'

/** `Notification.tag` for approval banners; a repeat with the same tag
 *  replaces the banner instead of stacking a second one. */
export const APPROVAL_NOTIFICATION_TAG = 'kirocrew-approval'

/**
 * Reconnect catch-up replays what the server still holds; the user already
 * saw those prompts, or will find the card on the restored transcript, so
 * replaying the sound and banner would only alarm them about nothing new.
 */
export function shouldAnnounceApproval(opts: { reconnecting: boolean }): boolean {
  return !opts.reconnecting
}

/** Notification permission is never requested here. */
export function announceApprovalPending(opts: { tool?: string; reconnecting: boolean }): void {
  if (!shouldAnnounceApproval(opts)) return
  dispatchMcNotification(APPROVAL_KIND)
  if (typeof Notification === 'undefined' || !document.hidden || Notification.permission !== 'granted') return
  // Android Chrome throws "Illegal constructor" for a page-context
  // Notification even with permission granted; the banner is best-effort and
  // a throw here must not take the caller's frame handling down with it.
  try {
    new Notification(i18nT('hooks.useWebSocket.approval_required'), {
      body: opts.tool || i18nT('hooks.useWebSocket.a_task_needs_your_decision'),
      tag: APPROVAL_NOTIFICATION_TAG,
    })
  } catch {
    /* unsupported platform */
  }
}
