const twilio = require('twilio');

// Workspace EventCallbackUrl handler. See
// docs/tech-notes/taskrouter-capacity-routing-solution.md Section 7 for the
// overall design.
//
// PREVIOUS DESIGN (removed): maintained `totalAssignedTasks` and
// `channelActive` as running counters on Worker attributes, +1 on
// reservation.created and -1 on each terminal event. That drifted under
// concurrent events for the same worker — each webhook invocation did its
// own read-modify-write of the SAME worker attributes with no locking, so
// two overlapping deliveries could each read the same "before" value and
// one write would silently clobber the other's +1/-1. Confirmed in testing:
// a worker ended up with totalAssignedTasks=1 and channelActive={chat:1,
// email:1} (which already don't add up) while TaskRouter's own ground truth
// showed ZERO pending/accepted reservations for that worker — a permanent
// drift with no event left to correct it, since nothing re-synced the
// counter against reality. The worker's chat/voice/email capacity was stuck
// at 0 as a result, and no new reservation could ever be created for them
// again until manually repaired.
//
// NEW DESIGN: channelActive/totalAssignedTasks are no longer stored
// anywhere — they are recomputed FRESH, every time, directly from
// TaskRouter's own live Reservation list for the worker (see
// computeActiveChannelCounts). There is nothing to accumulate, so there is
// nothing that can drift. A given computation can still be a few hundred ms
// stale relative to a concurrent change, but the NEXT event recomputes from
// scratch rather than compounding an old error — the system is
// self-correcting instead of accumulating state no one re-verifies.
//
// The only thing still persisted on Worker attributes is `nativeCapacity` —
// the worker's REAL, Console-configured capacity per channel, captured from
// a live non-zero reading. This can't be recomputed from reservations (it's
// not reservation data), so it has to be remembered somewhere, but it's
// also self-healing on every read — see captureNativeCapacity.
const GUARDED_CHANNELS = new Set(['chat', 'voice', 'email']);
const ALL_GUARDED_CHANNELS = ['chat', 'voice', 'email'];

// Reservation statuses that still hold a worker's capacity. Matches
// TaskRouter's own definition of "available capacity" (pending, accepted, or
// wrapping) — see the Multitasking docs' available_capacity_percentage
// formula, which this mirrors deliberately.
const ACTIVE_RESERVATION_STATUSES = ['pending', 'accepted', 'wrapping'];

// Events after which the worker's active-reservation set may have changed —
// i.e. a reservation entered or left ACTIVE_RESERVATION_STATUSES. Nothing
// else needs to trigger a recompute: `accepted` moves a reservation from
// pending to accepted, but both are "active", so the count doesn't change.
const RECOMPUTE_EVENTS = new Set([
  'reservation.created',
  'reservation.rejected',
  'reservation.timeout',
  'reservation.canceled',
  'reservation.rescinded', // multi-reservation loser; also frees capacity
  'reservation.completed',
]);

// Give the task a chance to come back to the same worker if nobody else has
// accepted it, per the "give it back" (P2) rule — Section 7 step 7.
const GIVE_BACK_EVENTS = new Set(['reservation.rejected', 'reservation.timeout']);

// Matches assignment-callback.js's TOTAL_TASK_CAP. Duplicated rather than
// shared because these are independent Twilio Functions with no shared
// module in this project — keep both files in sync if this value changes.
const TOTAL_TASK_CAP = 2;

// Fallback ONLY if we've never captured this worker's real capacity for a
// channel AND its current live reading is already 0 (so there's nothing
// genuine left to capture — e.g. someone set it to 0 in Console before this
// worker ever interacted with this system). Matches the original
// requirements table (Email 1 / Chat 2 / Phone 1); a captured real value
// always takes precedence over this.
const FALLBACK_CHANNEL_CAPACITY = { chat: 2, email: 1, voice: 1 };

async function fetchTask(client, workspaceSid, taskSid) {
  if (!taskSid) return null;
  try {
    return await client.taskrouter.v1.workspaces(workspaceSid).tasks(taskSid).fetch();
  } catch (err) {
    console.warn('[tr-event] failed to fetch task', taskSid, err.message);
    return null;
  }
}

// Ground truth for "what is this worker actively holding right now,
// per guarded channel" — queried directly from TaskRouter's own Reservation
// list, never from our own stored counters (see header comment for why).
// `excludeReservationSid` lets a caller ask "what does the worker hold
// EXCLUDING this one reservation" — assignment-callback.js needs that to
// evaluate a reservation that already exists (pending) at the moment it's
// deciding on it, without counting it against itself.
async function computeActiveChannelCounts(client, workspaceSid, workerSid, excludeReservationSid) {
  const lists = await Promise.all(
    ACTIVE_RESERVATION_STATUSES.map((status) =>
      client.taskrouter.v1
        .workspaces(workspaceSid)
        .workers(workerSid)
        .reservations.list({ reservationStatus: status, limit: 50 })
    )
  );

  const reservations = lists.flat().filter((r) => r.sid !== excludeReservationSid);
  const taskSids = [...new Set(reservations.map((r) => r.taskSid))];
  const tasks = await Promise.all(taskSids.map((sid) => fetchTask(client, workspaceSid, sid)));

  const channelActive = {};
  for (const t of tasks) {
    if (!t) continue;
    const channelName = t.taskChannelUniqueName;
    if (!GUARDED_CHANNELS.has(channelName)) continue;
    channelActive[channelName] = (channelActive[channelName] || 0) + 1;
  }

  const totalAssignedTasks = Object.values(channelActive).reduce((a, b) => a + b, 0);
  return { channelActive, totalAssignedTasks };
}

// Reads this worker's live WorkerChannel capacities and refreshes
// nativeCapacity from any currently non-zero reading — not just the first
// time it's seen. Self-healing by design: if someone changes a worker's
// capacity in Console after we've already cached a baseline for them (e.g.
// bumping voice from 1 to 10), the next non-zero read picks that up, so our
// restore logic tracks Console going forward instead of fighting a stale
// cached number. A reading of 0 is deliberately left untouched — that's
// expected to be our own enforcement at work (a channel we zeroed for a
// rule), not a real "0 capacity" Console setting, so it must never overwrite
// a previously known-good baseline. Mutates and returns `nativeCapacity`;
// also returns the raw channel list so the caller doesn't need a second
// workerChannels.list() call to decide what to write when reconciling.
async function captureNativeCapacity(client, workspaceSid, workerSid, nativeCapacity) {
  const channels = await client.taskrouter.v1.workspaces(workspaceSid).workers(workerSid).workerChannels.list();
  const currentByChannel = new Map(channels.map((wc) => [wc.taskChannelUniqueName, wc.configuredCapacity]));

  for (const channelName of ALL_GUARDED_CHANNELS) {
    const current = currentByChannel.get(channelName);
    if (current > 0) nativeCapacity[channelName] = current;
  }

  return currentByChannel;
}

// Computes the capacity each guarded channel SHOULD have right now, from the
// live channelActive/totalAssignedTasks counts and the captured native
// baseline — never from TaskRouter's own live availableCapacityPercentage.
// This is deliberate: once this file starts writing WorkerChannel.Capacity
// itself, that live percentage stops being a trustworthy read of "does this
// channel have real occupancy" (a channel we've zeroed to enforce a rule
// reads differently than one at its natural capacity).
//
// Hard rules encoded here (see Section 1/7):
//   - No Phone (voice) if Chat is already active       -> chatActive zeroes voice
//   - No Chat/Email if Phone (voice) is already active -> voiceActive zeroes chat+email
//   - Phone IS allowed if Email is already active       -> emailActive zeroes nothing
//   - Total active reservations >= cap zeroes every guarded channel
function computeDesiredCapacity(channelActive, totalAssignedTasks, nativeCapacity) {
  const chatActive = (channelActive.chat || 0) > 0;
  const voiceActive = (channelActive.voice || 0) > 0;
  const atCap = totalAssignedTasks >= TOTAL_TASK_CAP;

  const baseline = (channelName) => nativeCapacity[channelName] ?? FALLBACK_CHANNEL_CAPACITY[channelName];

  return {
    chat: (voiceActive || atCap) ? 0 : baseline('chat'),
    voice: (chatActive || atCap) ? 0 : baseline('voice'),
    email: (voiceActive || atCap) ? 0 : baseline('email'),
  };
}

// Applies computeDesiredCapacity's result, skipping any channel already at
// its desired value. Best-effort per channel: a single failed update should
// not stop the others — the assignment-callback guard remains the backstop
// either way, AND the next recompute event will simply try again from a
// fresh live read rather than inheriting this attempt's failure.
async function reconcileCapacity(client, workspaceSid, workerSid, currentByChannel, desired) {
  for (const channelName of ALL_GUARDED_CHANNELS) {
    const desiredCapacity = desired[channelName];
    if (currentByChannel.get(channelName) === desiredCapacity) continue;
    try {
      await client.taskrouter.v1
        .workspaces(workspaceSid)
        .workers(workerSid)
        .workerChannels(channelName)
        .update({ capacity: desiredCapacity });
      console.log(`[tr-event] ${channelName} capacity -> ${desiredCapacity} for ${workerSid}`);
    } catch (err) {
      console.warn(`[tr-event] failed to set ${channelName} capacity for ${workerSid}`, err.message);
    }
  }
}

// Writes task.attributes.last_rejected_by = workerSid, preserving every other
// attribute, reusing the already-fetched task to avoid a second GET. Best
// effort: a failed write here only weakens the "give it back" (P2)
// preference, which is itself only a soft preference, not a hard guarantee.
async function writeLastRejectedBy(client, workspaceSid, task, workerSid) {
  try {
    let attributes = {};
    try {
      attributes = JSON.parse(task.attributes || '{}');
    } catch (e) {
      attributes = {};
    }
    attributes.last_rejected_by = workerSid;
    await client.taskrouter.v1
      .workspaces(workspaceSid)
      .tasks(task.sid)
      .update({ attributes: JSON.stringify(attributes) });
    console.log(`[tr-event] ${task.sid}: last_rejected_by -> ${workerSid}`);
  } catch (err) {
    console.warn(`[tr-event] failed to write last_rejected_by for task ${task.sid}`, err.message);
  }
}

exports.handler = async function (context, event, callback) {
  const response = new Twilio.Response();
  response.appendHeader('Content-Type', 'application/json');

  const eventType = event.EventType;
  const workerSid = event.WorkerSid;
  const taskSid = event.TaskSid;

  const isRecomputeEvent = RECOMPUTE_EVENTS.has(eventType);
  const isGiveBackEvent = GIVE_BACK_EVENTS.has(eventType);

  // Not an event this handler cares about (or no worker on the event) — ack
  // and move on. TaskRouter expects a fast 2xx; skipping the API round-trip
  // keeps this cheap on the high-volume events we don't care about (notably
  // `reservation.accepted`, which doesn't change the active-reservation set
  // — see RECOMPUTE_EVENTS comment).
  if (!isRecomputeEvent && !isGiveBackEvent) {
    response.setStatusCode(204);
    return callback(null, response);
  }
  if (!workerSid) {
    response.setStatusCode(204);
    return callback(null, response);
  }

  try {
    const client = twilio(context.ACCOUNT_SID, context.AUTH_TOKEN);

    const task = await fetchTask(client, context.WORKSPACE_SID, taskSid);
    const taskChannel = task ? task.taskChannelUniqueName : null;

    // --- Give-back preference (P2, Section 7 step 7) ---
    if (isGiveBackEvent && task) {
      await writeLastRejectedBy(client, context.WORKSPACE_SID, task, workerSid);
    }

    // Out-of-scope channel (e.g. `default`) — nothing about chat/voice/email
    // occupancy changed, so there's nothing to recompute. The give-back
    // write above still runs regardless of channel; this does not.
    if (isRecomputeEvent && GUARDED_CHANNELS.has(taskChannel)) {
      const { channelActive, totalAssignedTasks } = await computeActiveChannelCounts(
        client,
        context.WORKSPACE_SID,
        workerSid,
        null // nothing to exclude — by the time this event fires, the triggering
             // reservation's own status already reflects the transition (e.g. a
             // just-rejected reservation is no longer 'pending', so it's
             // naturally absent from the active set without needing exclusion).
      );

      const worker = await client.taskrouter.v1
        .workspaces(context.WORKSPACE_SID)
        .workers(workerSid)
        .fetch();

      let attributes = {};
      try {
        attributes = JSON.parse(worker.attributes || '{}');
      } catch (e) {
        console.warn(`[tr-event] ${workerSid}: attributes not valid JSON, resetting nativeCapacity base`);
        attributes = {};
      }

      const nativeCapacity = { ...attributes.nativeCapacity };
      const currentByChannel = await captureNativeCapacity(client, context.WORKSPACE_SID, workerSid, nativeCapacity);

      attributes.nativeCapacity = nativeCapacity;
      await client.taskrouter.v1
        .workspaces(context.WORKSPACE_SID)
        .workers(workerSid)
        .update({ attributes: JSON.stringify(attributes) });

      console.log(`[tr-event] ${eventType} ${workerSid}: live totalAssignedTasks=${totalAssignedTasks} channelActive=${JSON.stringify(channelActive)}`);

      const desired = computeDesiredCapacity(channelActive, totalAssignedTasks, nativeCapacity);
      await reconcileCapacity(client, context.WORKSPACE_SID, workerSid, currentByChannel, desired);
    }

    response.setStatusCode(204);
    return callback(null, response);
  } catch (err) {
    console.error('[tr-event]', eventType, workerSid, err.message);
    // Non-2xx so the failure surfaces in the Twilio debugger rather than being
    // recorded as a successful delivery.
    response.setStatusCode(500);
    response.setBody({ error: err.message });
    return callback(null, response);
  }
};
