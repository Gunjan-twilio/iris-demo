const twilio = require('twilio');
const Airtable = require('airtable');

// Capacity guard — see docs/tech-notes/taskrouter-capacity-routing-solution.md Section 7.
//
// Workflow Target Worker Expressions (owned by the Workflow this project points at, not
// this file) already encode the Email/Chat/Phone exclusivity + total-cap rules using
// worker.channel.<x>.available_capacity_percentage and a worker.total_active_tasks-style
// attribute. But TaskRouter evaluates each Task Channel's queue independently, so with
// Email and Chat tasks always backlogged, two reservations for the same worker can still
// be created in the same instant, before either's capacity consumption is visible to the
// other's expression evaluation. This guard re-checks the same rules synchronously, at
// the one point guaranteed to run before the reservation ever reaches the associate's
// UI — closing the race the Workflow expressions alone cannot.
//
// Computes channel occupancy LIVE from TaskRouter's own Reservation list for the worker
// (same approach as taskrouter-event-callback.js's live-computation design — duplicated
// rather than shared, since these are independent Twilio Functions with no shared module
// in this project). An earlier version stored running counters on Worker attributes
// instead; those drifted under concurrent events for the same worker and could
// permanently stick a worker's capacity at 0 with no event left to correct it. Live
// computation has nothing to accumulate, so there's nothing to drift — see
// taskrouter-event-callback.js's header comment for the full incident.
//
// PRIORITY-BASED EVICTION: when a violation is found, this does NOT automatically reject
// whichever reservation triggered this callback (i.e. always the newest arrival). It
// first checks whether the worker is currently holding a lower-priority PENDING
// reservation that could be evicted instead, so a high-priority task doesn't lose out to
// low-priority ones that merely arrived first. Eviction only ever targets `pending`
// reservations — never `accepted`/`wrapping`, since that work is already underway and
// cannot be interrupted. See decideEviction for the exact rules.
//
// Only chat/voice/email TaskChannels are in scope (per the Email/Chat/Phone requirement).
// Tasks on any other TaskChannel (e.g. the generic `default` channel used by
// email_forwarded, call_now, and the plain phone-callback placeholder) are intentionally
// left untouched — this guard does not apply to them.
const GUARDED_CHANNELS = new Set(['chat', 'voice', 'email']);
const TOTAL_TASK_CAP = 2;
const ACTIVE_RESERVATION_STATUSES = ['pending', 'accepted', 'wrapping'];

async function fetchTask(client, workspaceSid, taskSid) {
  return client.taskrouter.v1.workspaces(workspaceSid).tasks(taskSid).fetch();
}

// Ground truth for "what does this worker hold right now, per guarded channel,
// EXCLUDING the reservation currently being decided on" — the reservation that
// triggered this very callback already exists in `pending` status by the time
// we're asked to accept/reject it, so it must be excluded or the worker would
// always appear to be holding one more reservation than it actually held
// before this one arrived. Returns one entry per active reservation:
// { reservationSid, taskSid, channel, priority, status }.
async function listActiveReservationDetails(client, workspaceSid, workerSid, excludeReservationSid) {
  const lists = await Promise.all(
    ACTIVE_RESERVATION_STATUSES.map((status) =>
      client.taskrouter.v1
        .workspaces(workspaceSid)
        .workers(workerSid)
        .reservations.list({ reservationStatus: status, limit: 50 })
    )
  );

  const reservations = lists.flat().filter((r) => r.sid !== excludeReservationSid);
  const tasks = await Promise.all(reservations.map((r) => fetchTask(client, workspaceSid, r.taskSid)));

  return reservations
    .map((r, i) => ({
      reservationSid: r.sid,
      taskSid: r.taskSid,
      channel: tasks[i].taskChannelUniqueName,
      priority: tasks[i].priority,
      status: r.reservationStatus,
    }))
    .filter((d) => GUARDED_CHANNELS.has(d.channel));
}

// Pairwise exclusivity, mirroring the Workflow's own expressions:
//   - No Phone (voice) if Chat is already active
//   - No Chat/Email if Phone (voice) is already active
//   - Phone IS allowed if Email is already active (not checked here)
function findExclusivityBlockers(taskChannel, details) {
  if (taskChannel === 'voice') return details.filter((d) => d.channel === 'chat');
  if (taskChannel === 'chat' || taskChannel === 'email') return details.filter((d) => d.channel === 'voice');
  return [];
}

// Decides which of the worker's currently-held PENDING reservations (if any)
// should be evicted to admit the incoming reservation, instead of rejecting
// the incoming one. Returns the list of { reservationSid, taskSid, priority }
// to evict, or null if the incoming reservation must be rejected because no
// safe eviction exists.
//
// Two independent conditions both have to clear for eviction to happen:
//
//   1. Exclusivity: if the incoming channel is blocked by active chat/voice
//      occupancy, EVERY blocking reservation must be evicted — exclusivity is
//      zero-tolerance, so leaving even one blocker in place still blocks the
//      incoming task. This only works if every blocker is `pending` (nothing
//      accepted/wrapping — that work is already underway) AND every
//      blocker's task priority is strictly lower than the incoming task's.
//      A single higher-or-equal-priority blocker, or any accepted/wrapping
//      blocker, means eviction cannot resolve exclusivity — reject incoming.
//
//   2. Total cap: after any exclusivity evictions above, if the worker would
//      still be at/over TOTAL_TASK_CAP once the incoming task is admitted,
//      more PENDING reservations must be evicted to make room — picking the
//      lowest-priority ones first (ties broken by list order, not a strict
//      creation-time guarantee, but acceptable for this edge case). Same
//      rule: a candidate is only evicted if its priority is strictly lower
//      than the incoming task's, and only if enough pending candidates exist
//      at all — otherwise reject incoming.
function decideEviction({ taskChannel, incomingPriority, details, totalAssignedTasks }) {
  const requiredRemovals = new Map(); // reservationSid -> detail

  const exclusivityBlockers = findExclusivityBlockers(taskChannel, details);
  for (const b of exclusivityBlockers) {
    if (b.status !== 'pending' || b.priority >= incomingPriority) return null;
    requiredRemovals.set(b.reservationSid, b);
  }

  const remainingAfterExclusivity = totalAssignedTasks - requiredRemovals.size;
  const capExcess = remainingAfterExclusivity - (TOTAL_TASK_CAP - 1);
  if (capExcess > 0) {
    const pendingCandidates = details
      .filter((d) => d.status === 'pending' && !requiredRemovals.has(d.reservationSid))
      .sort((a, b) => a.priority - b.priority); // lowest priority first

    if (pendingCandidates.length < capExcess) return null;

    const toEvict = pendingCandidates.slice(0, capExcess);
    if (!toEvict.every((d) => d.priority < incomingPriority)) return null;
    for (const d of toEvict) requiredRemovals.set(d.reservationSid, d);
  }

  return requiredRemovals.size > 0 ? [...requiredRemovals.values()] : null;
}

// Writes task.attributes.last_rejected_by SYNCHRONOUSLY, before actually
// rejecting the reservation — not in taskrouter-event-callback.js's async
// reservation.rejected handler. Rejecting a reservation re-evaluates the
// Workflow immediately, in the same transaction. With a single eligible
// worker, TaskRouter can re-offer the same task to the same worker before the
// async Workspace Event Callback has even started running, so the Workflow's
// own `worker.sid != task.last_rejected_by` exclusion isn't in effect yet —
// producing an instant reject-reoffer-reject loop (confirmed in logs: the
// same TaskSid cycling every ~2s). Writing it here closes that gap: by the
// time TaskRouter re-evaluates, the attribute is already set. Applies to
// BOTH the "reject incoming" path and each evicted reservation below.
async function rejectReservation(client, workspaceSid, taskSid, reservationSid, workerSid) {
  try {
    const task = await fetchTask(client, workspaceSid, taskSid);
    let attrs = {};
    try {
      attrs = JSON.parse(task.attributes || '{}');
    } catch (e) {
      attrs = {};
    }
    attrs.last_rejected_by = workerSid;
    await client.taskrouter.v1.workspaces(workspaceSid).tasks(taskSid).update({ attributes: JSON.stringify(attrs) });
  } catch (err) {
    console.warn(`[assignment-callback guard] failed to write last_rejected_by for task ${taskSid}`, err.message);
  }

  await client.taskrouter.v1
    .workspaces(workspaceSid)
    .tasks(taskSid)
    .reservations(reservationSid)
    .update({ reservationStatus: 'rejected' });
}

exports.handler = async function (context, event, callback) {
  const response = new Twilio.Response();
  response.appendHeader('Content-Type', 'application/json');

  const { TaskSid, WorkerSid, ReservationSid } = event;

  try {
    const client = twilio(context.ACCOUNT_SID, context.AUTH_TOKEN);

    if (TaskSid && WorkerSid) {
      const task = await fetchTask(client, context.WORKSPACE_SID, TaskSid);
      const taskChannel = task.taskChannelUniqueName;

      if (GUARDED_CHANNELS.has(taskChannel)) {
        const details = await listActiveReservationDetails(client, context.WORKSPACE_SID, WorkerSid, ReservationSid);
        const totalAssignedTasks = details.length;
        const exclusivityBlockers = findExclusivityBlockers(taskChannel, details);
        const hasViolation = exclusivityBlockers.length > 0 || totalAssignedTasks >= TOTAL_TASK_CAP;

        if (hasViolation) {
          const eviction = decideEviction({
            taskChannel,
            incomingPriority: task.priority,
            details,
            totalAssignedTasks,
          });

          if (eviction) {
            console.warn(
              `[assignment-callback guard] evicting ${eviction.length} lower-priority reservation(s) for worker ${WorkerSid} to admit task ${TaskSid} (priority ${task.priority}, ${taskChannel})`
            );
            for (const d of eviction) {
              try {
                await rejectReservation(client, context.WORKSPACE_SID, d.taskSid, d.reservationSid, WorkerSid);
                console.warn(`  evicted task ${d.taskSid} (priority ${d.priority})`);
              } catch (err) {
                // Expected under concurrency: a second reservation created in
                // the same instant can independently decide to evict this
                // SAME victim before this call lands — whichever gets there
                // first wins, the other's reject 400s with "not in expected
                // state". That's fine on its own (the slot still got freed by
                // the winner); what's NOT fine is BOTH incoming reservations
                // then assuming they personally freed a slot and proceeding —
                // that was the actual bug (confirmed in logs: two incoming
                // tasks both targeted the same victim, only one eviction
                // succeeded, but totalAssignedTasks still reached 3 against a
                // cap of 2). The re-check below after this loop is what
                // actually prevents that, not this catch.
                console.warn(`  failed to evict task ${d.taskSid}`, err.message);
              }
            }

            // Do NOT assume the eviction loop above actually freed enough
            // capacity — re-derive live state and re-run the same checks
            // used to decide a violation existed in the first place. Only
            // fall through to admit the incoming reservation if that
            // re-check now passes; otherwise reject it, even though eviction
            // was attempted. This is what makes concurrent evictions of the
            // same victim safe: at most one of them actually frees a slot,
            // and only that one's re-check will pass.
            const recheck = await listActiveReservationDetails(client, context.WORKSPACE_SID, WorkerSid, ReservationSid);
            const recheckTotal = recheck.length;
            const recheckBlockers = findExclusivityBlockers(taskChannel, recheck);
            if (recheckBlockers.length > 0 || recheckTotal >= TOTAL_TASK_CAP) {
              console.warn(`[assignment-callback guard] rejecting reservation for worker ${WorkerSid} on task ${TaskSid} (${taskChannel}): eviction did not free enough capacity (recheck: ${recheckTotal} active, ${recheckBlockers.length} exclusivity blocker(s))`);

              try {
                let attrs = {};
                try {
                  attrs = JSON.parse(task.attributes || '{}');
                } catch (e) {
                  attrs = {};
                }
                attrs.last_rejected_by = WorkerSid;
                await client.taskrouter.v1.workspaces(context.WORKSPACE_SID).tasks(TaskSid).update({ attributes: JSON.stringify(attrs) });
              } catch (err) {
                console.warn(`[assignment-callback guard] failed to write last_rejected_by for task ${TaskSid}`, err.message);
              }

              response.setBody({ instruction: 'reject' });
              return callback(null, response);
            }
            // Re-check passed — fall through and let the incoming reservation proceed normally below.
          } else {
            const violation = exclusivityBlockers.length > 0
              ? 'exclusivity conflict with no lower-priority reservation to evict'
              : `worker already holds ${totalAssignedTasks} active reservations (cap ${TOTAL_TASK_CAP}) with no lower-priority reservation to evict`;
            console.warn(`[assignment-callback guard] rejecting reservation for worker ${WorkerSid} on task ${TaskSid} (${taskChannel}): ${violation}`);

            // The incoming reservation is rejected via the Assignment Callback
            // response instruction (not a REST call like evicted reservations
            // need) — this callback's response IS the authoritative outcome
            // for THIS reservation. Still write last_rejected_by synchronously
            // first; see rejectReservation's header comment for why.
            try {
              let attrs = {};
              try {
                attrs = JSON.parse(task.attributes || '{}');
              } catch (e) {
                attrs = {};
              }
              attrs.last_rejected_by = WorkerSid;
              await client.taskrouter.v1.workspaces(context.WORKSPACE_SID).tasks(TaskSid).update({ attributes: JSON.stringify(attrs) });
            } catch (err) {
              console.warn(`[assignment-callback guard] failed to write last_rejected_by for task ${TaskSid}`, err.message);
            }

            response.setBody({ instruction: 'reject' });
            return callback(null, response);
          }
        }
      }
    }

    const taskAttrs = JSON.parse(event.TaskAttributes || '{}');

    // Store the pending reservation in Airtable so the browser can poll for it
    const base = new Airtable({ apiKey: context.AIRTABLE_API_KEY }).base(context.AIRTABLE_BASE_ID);

    // Update the matching case with the reservation SID
    if (taskAttrs.case_id) {
      const records = await base('Cases')
        .select({ filterByFormula: `{case_id} = '${taskAttrs.case_id}'` })
        .firstPage();

      if (records.length > 0) {
        const updates = {
          task_sid: event.TaskSid,
          reservation_sid: event.ReservationSid,
          status: 'new',
        };
        // Interactions API sets conversation_sid in task attributes for email channel
        if (taskAttrs.conversation_sid) {
          updates.conversation_sid = taskAttrs.conversation_sid;
        }
        await base('Cases').update(records[0].id, updates);
      }
    }

    // Return no instruction — let the associate UI handle accept/reject
    response.setBody({});
    return callback(null, response);
  } catch (err) {
    console.error(err);
    response.setBody({ instruction: 'reject' });
    return callback(null, response);
  }
};
