/* Shared availability helpers.

   A window now has three effective states, not two:

     open      — nobody has asked for it
     pending   — someone sent a booking request and it is being held for them
                 while the contract goes out, gets signed and countersigned
     booked    — the studio countersigned; the day is taken

   `booked` is still the plain boolean it always was, so records written by the
   old code keep working. The hold is additive: `hold = { id, until }`, where
   `id` is the booking holding it and `until` is when the hold lapses on its
   own. Expiry is evaluated at read time rather than swept by a cron — there is
   no scheduler here, and a hold that has quietly passed its date must not keep
   a window off the calendar. */

export const HOLD_DAYS = 7;

export const holdExpiry = (days = HOLD_DAYS) =>
  new Date(Date.now() + days * 86400000).toISOString();

/* A hold only counts while it is unexpired and still points at a booking. */
export const holdLive = (w, now = Date.now()) =>
  Boolean(w?.hold?.id && w.hold.until && Date.parse(w.hold.until) > now);

export function windowState(w, now = Date.now()) {
  if (w?.booked) return 'booked';
  if (holdLive(w, now)) return 'pending';
  return 'open';
}

/* Strips holds that have lapsed so callers never have to think about it.
   Returns a new array; the caller decides whether to persist it. */
export function withExpiredHoldsCleared(windows, now = Date.now()) {
  return (windows || []).map((w) =>
    w.hold && !holdLive(w, now) ? { ...w, hold: null } : w
  );
}

export const findWindow = (data, id, date) =>
  (data.windows || []).find((w) => w.id === String(id) && w.date === String(date));

/* Places a tentative hold. Refuses if the window is taken or already held by
   someone else, so two requests for the same slot cannot both succeed. */
export function placeHold(data, windowId, date, bookingId, until) {
  const w = findWindow(data, windowId, date);
  if (!w) return { ok: false, reason: 'not found' };
  if (w.booked) return { ok: false, reason: 'already booked' };
  if ((data.locked || []).includes(w.date)) return { ok: false, reason: 'day locked' };
  if (holdLive(w) && w.hold.id !== bookingId) return { ok: false, reason: 'already held' };
  w.hold = { id: bookingId, until };
  return { ok: true, window: w };
}

/* Releases a hold, but only the one belonging to this booking — a declined
   request must never free a slot that has since been re-held by someone else. */
export function releaseHold(data, bookingId) {
  let touched = false;
  for (const w of data.windows || []) {
    if (w.hold?.id === bookingId) {
      w.hold = null;
      touched = true;
    }
  }
  return touched;
}

/* Final commit: the studio countersigned, so the window is taken for good. */
export function commitHold(data, bookingId) {
  let touched = false;
  for (const w of data.windows || []) {
    if (w.hold?.id === bookingId) {
      w.booked = true;
      w.hold = null;
      touched = true;
    }
  }
  return touched;
}
