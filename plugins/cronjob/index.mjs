// Cronjob plugin: recurring prompts for the brain, sized for Elowen.
// Jobs persist in the plugin's data dir; a lightweight scheduler (platform adapter) ticks every 30 s
// and feeds due prompts back into the brain via the host's channel handler.
//
// A job either belongs to the INSTANCE (no ownerUserId — runs with owner powers and reports through the
// notification channel, exactly as every job did before ownership existed) or to ONE account: that job
// runs as its owner (`access.actAsUserId`, so the host applies that account's project policy, tool deny-list
// and plugin grants), reports into that person's own conversation, and may not run a shell guard or address
// a notification channel. CronAdd may create instance jobs only for the operator; the legacy HTTP route
// retains its existing admin authorization.
import { defineTool, loadSkillsFromDir } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { executionRef, projectCheck } from './execution.mjs';
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runtimeFooter, imageRefName } from 'elowen-plugin-shared/format';
import { readJsonSafe, writeJsonAtomic } from 'elowen-plugin-shared/atomicJson';
import { openRunJournal } from './lib/runJournal.mjs';

/** This plugin's own manifest name — the key an account's grant is stored under. */
const PLUGIN_NAME = 'cronjob';

// `exec` runs the command through the PLATFORM default shell (/bin/sh -c on POSIX, cmd.exe /d /s /c on
// Windows), so a job's check collector works cross-platform — hardcoding /bin/sh broke every cron on
// Windows, which has no /bin/sh. Checks are an instance-job capability; CronAdd exposes them owner-only.
const execAsync = promisify(exec);
// Scheduler defaults — user-overridable via configSchema (see register()); these are the values used
// when a key is unset, and stay the source of truth the existing tests rely on.
const DEFAULT_CHECK_TIMEOUT_MS = 60_000; // a guard shell must finish fast; a hung check never blocks the tick loop
const CHECK_MAX_BUFFER = 1024 * 1024; // 1 MB of stdout is plenty of "what's new" to hand the brain
// How much of a guard's stdout is fed into the brain turn. A collector that aggregates real data (a full
// debtor list, a daily digest) easily runs past a few KB, so the cap is generous; it only trims runaway output.
const DEFAULT_CHECK_OUTPUT_CHARS = 32_000;
// Cheap ceilings on what ONE non-admin account may schedule. Without them, per-user cron is an open
// invitation to occupy the instance: every fire is a model call the operator pays for.
const DEFAULT_MAX_JOBS_PER_USER = 20;
const DEFAULT_MIN_INTERVAL_MINUTES = 15;
const DEFAULT_CRON_TURN_ATTEMPTS = 2; // one retry on a request-time failure (a transient relay/gateway/network blip)
const DEFAULT_CRON_RETRY_BACKOFF_MS = 3_000; // brief pause before the retry so the transient condition can clear
const RUN_JOURNAL_MAINTENANCE_MS = 24 * 60 * 60_000;
// How many undelivered results may wait for a retry at once. A delivery sink that is down for good (a
// revoked bot token, a deleted channel) must not grow this file forever — past the cap, the OLDEST
// pending delivery is dropped (and logged) to make room for the next one.
const MAX_PENDING_DELIVERIES = 50;
// How long an adapter generation owns a pending delivery it is sending (see DeliveryStore.claim). The
// lease EXPIRES because the holder can die mid-send — a daemon crash would otherwise leave the result
// claimed forever and never delivered. It is deliberately long relative to a send: re-delivering after a
// falsely expired lease is exactly the duplicate the claim exists to prevent.
const DELIVERY_LEASE_MS = 5 * 60_000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** The owner-chat conversation a recurring personal job reports in. Deterministic so a job keeps ONE
 *  conversation across runs and restarts without storing a pointer that could go stale; the host owns
 *  its creation. */
const jobSessionId = (ownerUserId, jobId) => `brain-${ownerUserId}-job-${jobId}`;
/** The Automation page, where a job's settings and run history live. Owner alerts link here. */
const AUTOMATION_PAGE = '/p/cronjob/settings/jobs';

/** WHERE A JOB'S TURNS RUN, in one place, because two callers ask it and they must never disagree: the
 *  scheduler, which routes the run itself, and the navigation seam, which tells a conversation listing
 *  where following a schedule should land.
 *
 *  - `origin`    — a one-shot wake-up returns to the conversation it was scheduled from, and a recurring
 *                  job created in a direct platform chat keeps reporting into that chat through its
 *                  delivery target. That is the whole promise of "remind me here".
 *  - `dedicated` — every other OWNED recurring job runs in a conversation of its own, named after the
 *                  job, where its run history accumulates. Binding it to the conversation it happened to
 *                  be created in put every report into whatever the owner was working on at the time, so
 *                  an owner-chat origin recorded before 0.4.1 is deliberately ignored here.
 *  - `channel`   — an instance job, and any job with an explicit notification channel, runs in the job's
 *                  own cron channel and reports there. An explicit channel WINS over ownership: those
 *                  jobs exist to post into a specific room, and quietly redirecting them into the owner's
 *                  own conversation would stop every one of those reports. */
function jobRunLocation(job, ownerUserId) {
  const deliveryTarget = typeof job.originDeliveryTarget === 'string' ? job.originDeliveryTarget : undefined;
  if (job.originSessionId && job.originUserId != null && (job.runAt || deliveryTarget !== undefined)) {
    return {
      kind: 'origin',
      sessionId: job.originSessionId,
      userId: job.originUserId,
      ...(deliveryTarget !== undefined ? { deliveryTarget } : {}),
    };
  }
  if (ownerUserId !== null && !(typeof job.notifyChannelId === 'string' && job.notifyChannelId.trim())) {
    return { kind: 'dedicated', sessionId: jobSessionId(ownerUserId, job.id), userId: ownerUserId, title: job.name };
  }
  return { kind: 'channel', channelId: `job-${job.id}` };
}

/** Identifier for a job, a pending delivery or an adapter generation — short, sortable-ish, collision-free
 *  enough for records that live in one small JSON file. */
const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** Read a number config field, falling back to `def` when unset/invalid, then clamp to [min, max]. */
const clampConfig = (value, def, min, max) => Math.min(Math.max(Number(value) || def, min), max);

import {
  DEFAULT_CRON_LOOKBACK_MS, DEFAULT_TICK_MS,
  systemZone, zonedTimeToMs, slotKey,
  parseOneShot, parseSchedule, hoursAreValid, dueSlot,
  resolveLocalDateTime, planOccurrences,
  sortOccurrences, summarizeJobDay, localDateLabel, localTimeLabel,
  CALENDAR_CANDIDATE_BUDGET,
} from './schedule.mjs';
// The engine moved to schedule.mjs so the scheduler and every preview endpoint share one compiled
// schedule representation; these names keep their exports here so existing imports stay working.
export {
  systemZone, zonedParts, zonedTimeToMs, slotKey, parseOneShot, parseCronField,
  parseCron, parseSchedule, cronMatches, lastCronOccurrence, inHours, dueSlot, isDue,
} from './schedule.mjs';
/** Run a job's optional cheap guard command and classify the outcome, so the scheduler can decide
 *  whether the (expensive) brain turn is even worth running. Managed jobs supply their prepared runtime
 *  runner; legacy instance guards retain the platform default shell. Returns:
 *   - { skip:true }  → nothing to do (empty stdout) or the check errored → DON'T spend an LLM turn.
 *   - { skip:false, output } → fresh data on stdout → run the brain turn and feed it this output. */
export async function runCheck(command, logger, timeoutMs = DEFAULT_CHECK_TIMEOUT_MS, preparedRunner) {
  try {
    const { stdout } = await (preparedRunner ? preparedRunner() : execAsync(command, {
      timeout: timeoutMs, maxBuffer: CHECK_MAX_BUFFER, encoding: 'utf-8',
    }));
    const output = String(stdout ?? '').trim();
    if (!output) return { skip: true, reason: 'nothing new' };
    return { skip: false, output };
  } catch (e) {
    // A non-zero exit or timeout means the guard couldn't confirm new work — skip rather than run the
    // brain on a broken signal (and never crash the tick loop).
    logger?.warn?.(`cron check failed: ${e?.message ?? e}`);
    return { skip: true, reason: `check failed: ${e?.message ?? e}` };
  }
}
const ok = (text) => ({ content: [{ type: 'text', text }], details: {} });
const fail = (e) => ok(`Error: ${e instanceof Error ? e.message : String(e)}`);

/** The subtext markup a delivered cron result's runtime footer is wrapped in. Cron pushes land on the
 *  notification channel (Discord), so it is Discord's own subtext fence — see plugins/discord/lib/format.mjs. */
const FOOTER_FENCE = { open: '-# ', close: '' };

// ── The per-job brain model, in ONE place ───────────────────────────────────
// A brain model is a PAIR, never half of one. Core resolves the PROVIDER first and only then the model
// id, and model ids are not globally unique — two configured providers may both expose `gpt-5`. So a
// half-filled selection does not mean "close enough": with no model id core runs that provider's DEFAULT
// model, and with no provider it runs the FIRST configured provider's credentials
// (resolveBrainModelRoute). Both look like an ordinary run, bill like one, and report the model they
// actually used — which is how a job pinned to one model quietly ran on another. Every boundary here
// therefore asks these two readers and nothing else: a selection is either a complete pair or it is
// refused, and nothing in between is ever stored, forwarded or run.

/** Both halves, trimmed, or null — the one place that decides whether a selection is complete. */
const modelPair = (provider, model) => {
  const p = typeof provider === 'string' ? provider.trim() : '';
  const m = typeof model === 'string' ? model.trim() : '';
  return p && m ? { provider: p, model: m } : null;
};

/** The pair a STORED job names, or null when its `model` field does not name a complete one. The stored
 *  shape is the object `{provider, model}` — the wire shape the settings page saves and the only one the
 *  scheduler runs. A string is not "nearly right" here: it would round-trip through jobs.json as a shape
 *  no reader understands, so it is refused like any other partial. */
export function storedModel(job) {
  const m = job?.model;
  return typeof m === 'object' && m !== null ? modelPair(m.provider, m.model) : null;
}

/** The pair a tool argument names as "provider/model", or null when the string does not name both. */
export function parseModelSpec(spec) {
  if (typeof spec !== 'string') return null;
  const slash = spec.indexOf('/');
  return slash > 0 ? modelPair(spec.slice(0, slash), spec.slice(slash + 1)) : null;
}

/** Whether a job reply means "nothing to say". Older prompts answer `[SILENT]`, ours say
 *  `NOTHING_TO_REPORT` — and models love wrapping either in backticks/bold, so match leniently. */
export function isQuietReply(reply) {
  return /^[`*_\s]*(NOTHING_TO_REPORT|\[SILENT\])[`*_\s]*$/i.test(String(reply ?? '').trim());
}

class CronAdapter {
  name = 'cron';
  // The outbound sink is stored as `deliver`, NOT `notify`: the host broadcasts host-initiated
  // messages to every platform adapter exposing a `notify` method — if this adapter carried one,
  // the broadcast would call back into itself (host → cron → host → …) until the stack blew,
  // multiplying every cron echo into dozens of Discord messages.
  // `timezone` is a LIVE getter, not a captured string: the operator can change the zone in Settings and
  // the very next tick must schedule against it, without a plugin reload.
  constructor(store, deliveryStore, journal, logger, deliver, config = {}, timezone = systemZone, ownerIsAdmin = () => true, ownerMaySchedule = () => true, projectRuntime, alerts) {
    this.projectRuntime = projectRuntime;
    // The host's bell (ctx.alerts): how an owned job's owner learns that a run failed or never reached them.
    this.alerts = alerts;
    this.journal = journal;
    this.checkAbort = new AbortController();
    this.store = store; this.deliveryStore = deliveryStore; this.log = logger; this.deliver = deliver;
    // Re-asked at every fire, never captured: a job's shell guard is allowed by WHO owns it, and rights
    // can be taken away between the write that stored the guard and the tick that would run it.
    this.ownerIsAdmin = ownerIsAdmin;
    // Asked at every fire for the same reason: scheduling is a granted capability, and taking the grant
    // away has to actually stop the schedules it allowed.
    this.ownerMaySchedule = ownerMaySchedule;
    this.relay = null; this.running = false;
    // A durable manual request is queued ON THE JOB ROW (manualRequest) and the dedupe token lands in
    // `lastManualRequestId` after the claim. A manual request never rewrites the schedule; the tick
    // claims the OLDEST of them before the natural due work and runs it through the exact same
    // authority, guard, brain and delivery path as a scheduled fire.
    this.runningJobId = null; this.runningSince = null;
    // Set by disconnect(): this adapter generation has been torn down (a plugin reload) and must not
    // start any further work — see disconnect() and the tick loop.
    this.stopped = false;
    // Identifies THIS adapter generation as the holder of a pending-delivery lease, so a generation only
    // ever releases a lease it still owns — see attemptDelivery and DeliveryStore.claim.
    this.deliveryOwner = newId();
    this.timezone = timezone;
    // Scheduler limits, resolved once from plugin config (see orca-plugin.json's "Scheduler" section) and
    // clamped to sane bounds — unset config reproduces the previous hardcoded defaults exactly.
    this.tickMs = clampConfig(config.tickMs, DEFAULT_TICK_MS, 10_000, 120_000);
    this.turnAttempts = clampConfig(config.retryAttempts, DEFAULT_CRON_TURN_ATTEMPTS, 1, 5);
    this.retryBackoffMs = clampConfig(config.retryBackoffMs, DEFAULT_CRON_RETRY_BACKOFF_MS, 1_000, 30_000);
    this.checkTimeoutMs = clampConfig(config.checkTimeoutMs, DEFAULT_CHECK_TIMEOUT_MS, 10_000, 300_000);
    this.checkOutputMaxChars = clampConfig(config.checkOutputChars, DEFAULT_CHECK_OUTPUT_CHARS, 2_000, 200_000);
    this.cronLookbackMs = clampConfig(config.cronLookbackMs, DEFAULT_CRON_LOOKBACK_MS, 3_600_000, 604_800_000);
  }
  // The host wires its ordinary inbound handler here. This adapter has no inbound traffic and never turns
  // one into work: a scheduled or manual run enters through `control().relay` below, the only entry that
  // carries host-relay provenance — and therefore the only one that files the job's transcript under the
  // account that scheduled it. The callback is deliberately not kept, so nothing can call it by accident.
  listen() {}
  // The host's out-of-band control surface. `relay` is the ONLY entry a synthetic turn may use now: it is
  // what stamps host-relay provenance, so an owned job's own room is filed under the account that
  // scheduled it, and a job can never claim more than its owner holds because the host re-resolves the
  // account's policy, Project and tool authority on every call. Calling a saved listen handler instead
  // would run the turn but leave its transcript on the operator.
  control(api) { this.relay = api.relay; }
  async connect() {
    this.journal.prune(Date.now());
    this.maintenanceTimer = setInterval(() => {
      try { this.journal.prune(Date.now()); }
      catch (error) { this.log.error(`run journal maintenance failed: ${error?.message ?? error}`); }
    }, RUN_JOURNAL_MAINTENANCE_MS);
    this.maintenanceTimer.unref?.();
    this.timer = setInterval(() => void this.tick().catch((e) => this.log.error(`tick failed: ${e?.message ?? e}`)), this.tickMs);
  }
  // Clearing the interval only stops FUTURE ticks — a tick already in flight is parked on a (slow) brain
  // turn and would happily carry on running the rest of its due jobs long after the host replaced this
  // adapter with a fresh one built from the reloaded registry. That orphan generation writes to the same
  // jobs.json and delivers through the same sink as its replacement, so it is marked stopped here: the
  // tick loop finishes delivering the result it already paid for, then abandons the remaining jobs to the
  // live adapter. Synchronous on purpose — the host's stopAll() cannot await, and a reload must not block
  // for the minutes an LLM turn can take.
  disconnect() {
    this.stopped = true;
    this.checkAbort.abort();
    clearInterval(this.timer);
    clearInterval(this.maintenanceTimer);
  }
  async send() { /* cron has no outbound channel; results land in the job's conversation */ }

  runClaim(job, { manual = false, slot, now, timezone, skipReason = null }) {
    const parsed = typeof job.runAt === 'string' ? { kind: 'oneShot' } : parseSchedule(job.schedule);
    const manualId = manual && typeof job.manualRequest?.id === 'string' ? job.manualRequest.id : null;
    const scheduledMs = manual
      ? null
      : typeof job.runAt === 'string' && Number.isFinite(Date.parse(job.runAt))
        ? Date.parse(job.runAt)
        : parsed?.kind !== 'interval' && typeof slot === 'string'
          ? (() => {
            const [date, time] = slot.split('T');
            const [year, month, day] = date.split('-').map(Number);
            const [hour, minute] = time.split(':').map(Number);
              return zonedTimeToMs(timezone, year, month, day, hour, minute);
            })()
          : null;
    const wallMs = scheduledMs ?? now;
    const localDate = localDateLabel(wallMs, timezone);
    const localTime = localTimeLabel(wallMs, timezone);
    const trigger = manual ? 'manual'
      : parsed?.kind !== 'interval' && slot !== slotKey(now, timezone) ? 'catchUp'
        : 'schedule';
    // An interval has no wall-clock slot. Its durable identity is the scheduled instant made due by the
    // PRE-CLAIM lastRun snapshot, so two adapter generations holding that snapshot collide, while a later
    // legitimate run in the same wall minute does not. The jobs-store claim advances lastRun before this
    // insert, which keeps the crash window loss-only rather than duplicate-prone.
    const intervalClaimSlot = parsed?.kind === 'interval'
      ? (() => {
          const previous = typeof job.lastRun === 'string' ? Date.parse(job.lastRun) : Number.NaN;
          return Number.isFinite(previous)
            ? String(previous + parsed.ms)
            : `initial:${typeof job.createdAt === 'string' ? job.createdAt : slot}`;
        })()
      : null;
    const claimKey = manualId
      ? `manual:${job.id}:${manualId}`
      : intervalClaimSlot !== null
        ? `schedule:${job.id}:interval:${intervalClaimSlot}`
        : `schedule:${job.id}:${slot}`;
    return this.journal.claim({
      claimKey: `${claimKey}${skipReason ? `:skip:${skipReason}` : ''}`,
      jobId: job.id,
      jobName: job.name,
      ownerUserId: typeof job.ownerUserId === 'number' ? job.ownerUserId : null,
      lifecycle: job.runAt ? 'oneShot' : 'recurring',
      schedule: job.runAt ? null : job.schedule,
      trigger,
      slotMs: parsed?.kind === 'interval' || manual ? null : scheduledMs,
      localDate,
      localTime,
      timezone,
      startedMs: now,
    });
  }

  recordSkip(job, details, skipReason, message) {
    const receipt = this.runClaim(job, { ...details, skipReason });
    if (receipt.created) {
      this.journal.close(receipt.id, {
        outcome: 'skipped',
        skipReason,
        preview: message,
        finishedMs: details.now,
      });
    }
  }

  async tick() {
    // One tick at a time. Jobs run sequentially and each is a (slow) LLM turn, so a due-cluster — e.g. the
    // morning batch of daily reports — can exceed the 30s interval; without this guard the next interval
    // overlaps, double-fires a job and hammers the relay with concurrent turns (a source of transient 400s).
    if (!this.relay || this.running || this.stopped) return;
    this.running = true;
    try {
    // Retry any result a previous tick prepared but failed to deliver — a re-send only, never a re-run
    // of the (expensive, possibly side-effecting) model turn that produced it.
    await this.flushPendingDeliveries();
    const now = Date.now();
    const tz = this.timezone();
    // A manual run goes FIRST, then the ordinary due set. The OLDEST durable manual request is
    // claimed at most one per tick and routed through the exact same authority, guard, brain and
    // delivery path as a scheduled fire; every further request keeps waiting for a later tick, and a
    // job with a still-queued manual request stays out of the natural loop (it runs as the manual one).
    const allJobs = this.store.all();
    const pendingManual = allJobs
      .filter((job) => !job.runAt && job.manualRequest && typeof job.manualRequest.id === 'string')
      .sort((a, b) => (Date.parse(a.manualRequest.requestedAt ?? '') || 0) - (Date.parse(b.manualRequest.requestedAt ?? '') || 0));
    const waitingManualIds = new Set(pendingManual.slice(1).map((job) => job.id));
    const manualSnapshot = pendingManual[0];
    const snapshots = manualSnapshot ? [manualSnapshot, ...allJobs.filter((job) => job.id !== manualSnapshot.id)] : allJobs;
    for (const snapshot of snapshots) {
      // Torn down mid-tick (plugin reload): the job just delivered is settled, so hand the rest over to
      // the adapter that replaced us instead of running them from a generation the host has dropped.
      if (this.stopped) break;
      const manual = snapshot.id === manualSnapshot?.id;
      // A job with a still-queued manual request runs as a manual claim on a LATER tick, never twice
      // in one pass — and its natural due slot waits rather than firing a second time.
      if (!manual && waitingManualIds.has(snapshot.id)) continue;
      // Cheap pre-filter on the snapshot — claiming re-reads the file, so only pay that for a due job.
      const due = manual ? `manual:${snapshot.manualRequest.id}` : dueSlot(snapshot, now, tz, this.cronLookbackMs);
      if (due === null) continue;
      const runDetails = { manual, slot: due, now, timezone: tz };
      // WHOSE job this is. No owner = an instance job: admin powers, notification-channel delivery —
      // exactly the behaviour every job had before ownership existed.
      const owner = typeof snapshot.ownerUserId === 'number' ? snapshot.ownerUserId : null;
      // An owned job exists only because its owner was allowed to schedule. Revoking that grant has to
      // stop the schedule too — otherwise the one lever an operator would reach for leaves the jobs
      // running (as that person, spending model budget) with nothing to show for it. Skipped, never
      // deleted: re-granting brings the schedule back untouched.
      //
      // Asked BEFORE claiming, and that ordering is load-bearing rather than tidiness. Claiming a ONE-SHOT
      // does not mark it, it DELETES it — the removal is what stops the next tick firing it again. A gate
      // placed after the claim therefore destroys the very wake-up it means to merely skip, and the
      // `lastResult` note it writes lands on a row that no longer exists, so it is silently dropped too.
      // What the user sees then is the worst possible shape for a schedule somebody is waiting on: no job
      // in CronList, no note, and no log line — a wake-up that vanishes is indistinguishable from one that
      // was never created. Keeping every pre-run gate above the claim is what makes "skipped, never
      // deleted" true for one-shots as well as for recurring jobs.
      if (owner !== null && !this.ownerMaySchedule(owner)) {
        const message = 'the owner is no longer allowed to schedule jobs';
        this.store.patch(snapshot.id, { lastResult: `⏭️ skipped: ${message}` });
        this.recordSkip(snapshot, runDetails, 'owner_not_allowed', message);
        this.log.warn(`cron job ${snapshot.id} (${snapshot.name}) skipped — its owner may no longer schedule jobs`);
        continue;
      }
      // A job that NAMES a model must run on THAT model. Both write paths refuse a half-written pair, so
      // one can only reach here from a hand-edited jobs.json or a record older than that validation — and
      // running it anyway is the worst of the options: core would resolve the missing half to the
      // provider's default model (or to the first configured provider's credentials), spend a real turn
      // there and report the substitute in the run's footer, which is exactly the "it ran on the wrong
      // model" this gate exists to stop. Skipped, never deleted: correcting the model in the settings page
      // runs the job on its next slot. Above the claim like the gate before it — claiming a one-shot
      // DELETES it, so a gate below would consume the very wake-up it means to merely postpone.
      if (snapshot.model !== undefined && storedModel(snapshot) === null) {
        const message = 'the job names an incomplete model — set both a provider and a model';
        this.store.patch(snapshot.id, { lastResult: `⏭️ skipped: ${message}` });
        this.recordSkip(snapshot, runDetails, 'incomplete_model', message);
        this.log.warn(`cron job ${snapshot.id} (${snapshot.name}) skipped — its model selection names no complete provider/model pair`);
        continue;
      }
      try {
        const ref = executionRef(snapshot.projectRef);
        if (ref?.projectId) {
          if (!this.projectRuntime) throw new Error('project environment unavailable');
          await this.projectRuntime.authorize(snapshot);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.store.patch(snapshot.id, { lastResult: `skipped: ${message}` });
        this.recordSkip(snapshot, runDetails, 'project_unavailable', message);
        continue;
      }
      // Claim the authoritative jobs store before inserting the journal row. A crash in the narrow window
      // between these writes can lose this one execution, but it cannot duplicate it: the jobs-store claim
      // has already advanced the recurring slot or consumed the one-shot. Reversing the order would leave a
      // journal claim without the authoritative claim and let a replacement generation execute ambiguously.
      const job = manual ? this.claimManualRequest(snapshot, now, tz) : this.claimDueJob(snapshot.id, now, tz);
      if (!job) continue;
      const receipt = this.runClaim(snapshot, runDetails);
      // A prior generation already journalled this exact durable claim. The jobs store and the unique
      // claim key agree that it must not run or settle twice.
      if (!receipt.created) continue;
      // Cheap guard gate: if the job has a `check` command, run it FIRST (no LLM). Only spend a brain
      // turn when the guard surfaces fresh work — an "every 5m" poll that finds nothing costs a shell
      // exec, not a model call. The guard's output is fed into the turn so the brain acts on real data.
      //
      // Guards belong to recurring jobs. Managed authorization is checked before the claim so a missing
      // provider or revoked membership cannot consume a one-shot. Checks themselves own execution leases.
      let checkOutput = null;
      if (typeof job.check === 'string' && job.check.trim()) {
        // A shell guard runs on the daemon host with the daemon's rights, so only an admin's job may carry
        // one. Re-checked HERE and not only at write time: the owner may have lost admin since. Skipping
        // (rather than deleting, or running the job without its guard) keeps a temporary demotion
        // recoverable and never turns a gated poll into an ungated one.
        if (job.projectRef?.kind !== 'managed' && !this.ownerIsAdmin(owner)) {
          const message = 'a shell check may only run on an admin-owned job';
          this.store.patch(job.id, { lastResult: `⏭️ skipped: ${message}` });
          this.journal.close(receipt.id, { outcome: 'skipped', skipReason: 'admin_only_check', preview: message });
          continue;
        }
        const res = await runCheck(job.check, this.log, this.checkTimeoutMs, job.projectRef?.projectId ? () => this.projectRuntime.check(job, this.checkTimeoutMs, this.checkAbort.signal) : undefined);
        if (res.skip) {
          this.store.patch(job.id, { lastResult: `⏭️ ${res.reason}` });
          this.journal.close(receipt.id, {
            outcome: 'skipped',
            skipReason: String(res.reason).startsWith('check failed:') ? 'check_failed' : 'check_empty',
            preview: res.reason,
          });
          continue; // nothing new (or the guard errored) → skip the brain turn entirely
        }
        checkOutput = res.output;
      }
      if (this.stopped) break;
      this.journal.start(receipt.id, Date.now());
      this.log.info(`running job ${job.id} (${job.name})`);
      // Publish what the calendar may state truthfully: WHICH job the adapter is running RIGHT NOW.
      // A pause/delete of that job after this point still says nothing about the claimed turn.
      this.runningJobId = job.id;
      this.runningSince = new Date(now).toISOString();
      // Capture the turn's idle event (model + context usage) so the proactive push can carry the same
      // runtime footer a streamed reply gets — the handler forwards this onEvent into the brain session.
      let idle = null;
      // Whether the host confirmed delivery into the recorded origin. Direct platform chats are confirmed
      // only by the host's `delivery` event, emitted after the platform adapter accepts the result. Owner-chat
      // bound sends retain their session-route confirmation because the conversation itself is the sink.
      let boundDelivery = false;
      // Did the turn emit real output (a tool call, assistant text or a diff)? If it did before failing,
      // the run had side effects and must NOT be retried; only a failure that produced nothing is safe.
      let sawWork = false;
      let sharedImages = [];
      // Hand the brain the guard's fresh output (if any) so it acts on it directly instead of re-running
      // the collector via a tool — the whole point of the gate is one cheap check, not a check + a re-fetch.
      let userText = checkOutput
        ? `${job.prompt}\n\n--- Check output (fresh data to act on) ---\n${checkOutput.slice(0, this.checkOutputMaxChars)}`
        : job.prompt;
      // Where the reply belongs — see jobRunLocation, which is also what the navigation seam reads, so
      // the row a reader follows and the conversation the job actually runs in can never disagree. The
      // channel case carries no origin at all: the source's own channelId routes it, exactly as before.
      // Mirrors the write-time rule in conversationOrigin({ directOnly }) — change both together.
      const location = jobRunLocation(job, owner);
      const origin = location.kind === 'origin'
        ? {
            sessionId: location.sessionId,
            userId: location.userId,
            ...(location.deliveryTarget !== undefined ? { deliveryTarget: location.deliveryTarget } : {}),
          }
        : location.kind === 'dedicated'
          ? { userId: location.userId, sessionId: location.sessionId, dedicated: { title: location.title } }
          : undefined;
      // A bound run replays INTO a real conversation, so frame the prompt: without this the model reads
      // its own schedule as the user speaking just now. (The channel fallback keeps its wake-up context
      // via access.prompt; this framing reads fine there too.)
      if (origin) userText = `[Scheduled ${job.runAt ? 'wake-up' : 'job'} "${job.name}" fires now — you set it earlier. Do the task and reply now.]\n${userText}`;
      const src = {
        platform: 'cron', userId: 'cron', roleIds: [], channelId: `job-${job.id}`,
        origin,
        access: {
          projectIds: [], admin: owner === null,
          ...(job.projectRef ? { projectRef: executionRef(job.projectRef) } : {}),
          // An owned job runs AS its owner: the host resolves the account and applies its project policy,
          // tool deny-list and plugin grants — the job can never do more than the person who scheduled it.
          ...(owner !== null ? { actAsUserId: owner } : {}),
          // A timer-driven turn: the host swaps the coding-agent base for the focused `scheduled` system
          // prompt (unattended, channel-only delivery, report the outcome not the progress). Core stays
          // agnostic to which plugin fired it — it keys only off this generic flag.
          scheduled: true,
          // Just identifies THIS job — the `scheduled` prompt carries how to run and report it.
          prompt: `This scheduled ${job.runAt ? 'wake-up' : 'job'} is "${job.name}". Do its task now.`,
          // Optional per-job model — the channel session respawns on it (else the server default runs).
          // Gated above, so this forwards the job's EXACT pair or nothing at all: core never receives a
          // partial it would silently complete with a different provider's or model's identity.
          model: storedModel(job) ?? undefined,
        },
      };
      const onEvent = (e) => {
        if (e?.type === 'session' && typeof e.sessionId === 'string') {
          this.journal.note(receipt.id, { sessionId: e.sessionId });
        }
        if (e?.type === 'idle') {
          idle = { ...(idle ?? {}), ...e };
          this.journal.note(receipt.id, {
            ...(typeof e.messageId === 'string' ? { messageId: e.messageId } : {}),
            ...(typeof e.model === 'string' ? { model: e.model } : {}),
            ...(Number.isSafeInteger(e.usage?.totalTokens) ? { tokensTotal: e.usage.totalTokens } : {}),
            ...(Number.isFinite(e.usage?.cost) && e.usage.cost >= 0 ? { costUsd: e.usage.cost } : {}),
          });
        }
        if (origin?.deliveryTarget !== undefined && e?.type === 'delivery') {
          boundDelivery = true;
          this.journal.note(receipt.id, { delivered: true, deliveryTarget: origin.deliveryTarget });
        }
        if (origin !== undefined && origin.deliveryTarget === undefined && e?.type === 'session'
          && (origin.sessionId === undefined || e.sessionId === origin.sessionId)) {
          boundDelivery = true;
          this.journal.note(receipt.id, { delivered: true });
        }
        if (e?.type === 'image' && !e.preview && imageRefName(e.ref)) {
          sharedImages.push({ type: 'image', ref: e.ref, ...(typeof e.caption === 'string' ? { caption: e.caption } : {}) });
          sawWork = true;
        }
        if (e?.type === 'tool' || e?.type === 'text' || e?.type === 'diff') sawWork = true;
      };
      // Bounded retry: a request-time failure — a transient relay/gateway/network blip that threw before
      // the turn produced any tool or text output — is re-run once after a short backoff, so a momentary
      // upstream hiccup doesn't cost the whole scheduled report. If the turn already did work, deliver the
      // error instead of repeating side effects. Recurring jobs only: a one-shot wake-up is already
      // consumed (deleted) before running, so re-running a spent schedule isn't meaningful. Reset the
      // per-turn accumulators each attempt.
      let reply;
      for (let attempt = 1; ; attempt++) {
        idle = null; boundDelivery = false; sawWork = false; sharedImages = [];
        try { reply = await this.relay(src, userText, { onEvent }); break; }
        catch (e) {
          if (attempt < this.turnAttempts && !sawWork && !job.runAt) {
            this.log.warn(`cron job ${job.id} attempt ${attempt} failed (${e?.message ?? e}) — retrying in ${this.retryBackoffMs}ms`);
            await sleep(this.retryBackoffMs);
            continue;
          }
          reply = `Error: ${e?.message ?? e}`;
          break;
        }
      }
      // One-shots were already removed before running; recurring jobs record their last result.
      if (!job.runAt) this.store.patch(job.id, { lastResult: String(reply ?? '').slice(0, 500) });
      this.runningJobId = null;
      const trimmed = String(reply ?? '').trim();
      const failed = trimmed.startsWith('Error:');
      const errorMessage = failed ? trimmed.slice('Error:'.length).trim() || 'scheduled turn failed' : null;
      this.journal.close(receipt.id, {
        outcome: failed ? 'error' : 'ok',
        preview: String(reply ?? ''),
        ...(failed ? { errorMessage } : {}),
        ...(Number.isSafeInteger(idle?.durationMs) ? { durationMs: idle.durationMs } : {}),
        ...(typeof idle?.completedAt === 'string' && Number.isFinite(Date.parse(idle.completedAt))
          ? { finishedMs: Date.parse(idle.completedAt) }
          : {}),
      });
      // An owned job's owner was promised the result. A failed run, or a result with something to say
      // that no conversation of theirs confirmed receiving, reaches them on the bell instead; every other
      // outcome clears that alert, because the job works again.
      if (owner !== null) {
        const undelivered = !failed && origin !== undefined && !boundDelivery
          && ((trimmed !== '' && !isQuietReply(trimmed)) || sharedImages.length > 0);
        await this.alertOwner(job, owner, failed ? { kind: 'runFailed', params: { error: errorMessage } }
          : undelivered ? { kind: 'runUndelivered', params: {} }
            : null);
      }
      // Origin-bound delivery: a successful result already landed in the originating conversation, so the
      // generic notification sink must not send it a second time. Direct platform origins are confirmed only
      // after adapter delivery; owner-chat bound sends keep their existing session confirmation. A failed
      // turn emits neither confirmation, so instance wake-ups can still fall back to the notification channel.
      if (boundDelivery && (origin?.deliveryTarget !== undefined || !trimmed.startsWith('Error:'))) continue;
      // An owned job does not echo to the operator's DEFAULT notification channel: that channel belongs
      // to the operator and this result belongs to somebody else. When the bound delivery could not land
      // (the owner has no conversation yet, or it changed hands) the outcome stays in the run history
      // and the owner was alerted above.
      //
      // A job that names its OWN channel is the exception, because that is an explicit destination
      // chosen for this job rather than the operator's catch-all — and only an operator-level account is
      // allowed to set one. Without this, giving an existing reporting job an owner would silently
      // switch off the report the room depends on.
      if (owner !== null && !(typeof job.notifyChannelId === 'string' && job.notifyChannelId.trim())) {
        if (!boundDelivery) this.log.error(`cron job ${job.id} (${job.name}) could not reach its owner's conversation — result kept in the run history`);
        continue;
      }
      // Echo the outcome to the notification channel (Discord) so it reaches the user proactively.
      // A job with nothing to say answers with a quiet marker (isQuietReply) and stays silent.
      if ((trimmed && !isQuietReply(trimmed)) || sharedImages.length > 0) {
        const footer = runtimeFooter(idle, FOOTER_FENCE);
        // `plain` jobs deliver the reply as-is (persona messages in a dedicated channel don't want
        // the "⏰ job name" banner); the footer subtext stays — it matches streamed replies.
        const header = job.plain ? '' : `⏰ **${job.name}**\n`;
        // Deliver the full reply: the platform sink chunks anything past one message's limit
        // (Discord splits on line boundaries), so a long report — e.g. a 60-item debtor list —
        // arrives complete across several messages instead of being clipped mid-list.
        // A quiet run that still shared images sends the images alone, never the quiet marker.
        const text = trimmed && !isQuietReply(trimmed) ? String(reply) : '';
        const body = `${header}${text}${footer ? `${text ? '\n\n' : ''}${footer}` : ''}`;
        if (await this.deliverOrQueue(job, body, sharedImages)) {
          this.journal.note(receipt.id, { delivered: true, deliveryTarget: job.notifyChannelId ?? null });
        }
      }
    }
    } finally {
      this.running = false;
    }
  }

  /** The scheduler status a calendar response carries: whether the adapter would accept work, and
   *  WHICH job (if any) is currently running. Absence says nothing about a recovered external turn —
   *  one handed to the host before this generation exists may still be running there. */
  status() {
    return {
      ready: !!(this.relay && !this.stopped),
      ...(this.runningJobId ? { runningJobId: this.runningJobId, runningSince: this.runningSince } : {}),
    };
  }

  /** Claim ONE durable manual request and return the FRESH record to run, or null when the claim is
   *  gone (a reload took the job away, or another claim won it). The dedupe id survives the claim in
   *  `lastManualRequestId`, so a retried POST /run finds its answer instead of running twice.
   *  `lastRun` records what the UI means by "ran", while `lastSlot` is touched only when the natural
   *  slot is ALREADY due — a manual run never consumes the job's ordinary future fire. */
  claimManualRequest(snapshot, now, tz) {
    const job = this.store.all().find((entry) => entry.id === snapshot.id);
    if (!job || !job.manualRequest || job.runAt) return null;
    const requestId = job.manualRequest.id;
    const slot = dueSlot({ ...job, manualRequest: undefined }, now, tz, this.cronLookbackMs);
    this.store.patch(job.id, {
      lastRun: new Date(now).toISOString(),
      ...(slot !== null ? { lastSlot: slot } : {}),
      lastResult: '▶ running manually…',
      lastManualRequestId: requestId,
      manualRequest: undefined,
    });
    return { ...job, manualRequest: undefined };
  }


  /** Take ownership of job `id`'s due slot and return the FRESH record to run, or null when it is no
   *  longer due (another tick already claimed it), or gone.
   *
   *  The check is re-done against the CURRENT persisted state rather than the snapshot the tick started
   *  from, because that snapshot goes stale the moment a job's turn is awaited: a torn-down adapter
   *  generation parked on a slow turn — and the fresh one the host started in its place after a plugin
   *  reload — read and stamp the same jobs.json, and the in-memory `running` guard only covers one of
   *  them. Read-check-write runs synchronously here, so the two can never both win a slot and double-fire
   *  the job.
   *
   *  One-shot (runAt) jobs are consumed by deletion BEFORE the (long) turn so a daemon crash mid-run can't
   *  strand a zombie — a job left with lastRun set but never deleted would neither re-fire (isDue for
   *  runAt needs `!lastRun`) nor ever get cleaned up. Deletion IS the dedup, so at-most-once holds even if
   *  the turn crashes (a wake-up that starts running is spent — acceptable). Recurring jobs stamp lastRun
   *  so a slow turn doesn't re-fire them next tick; they fire again on their next natural slot. `lastSlot`
   *  records WHICH wall-clock slot that was, so the repeated hour of an autumn DST change cannot run the
   *  same 02:30 twice. */
  claimDueJob(id, now, tz) {
    const jobs = this.store.all();
    const job = jobs.find((j) => j.id === id);
    if (!job) return null;
    const slot = dueSlot(job, now, tz, this.cronLookbackMs);
    if (slot === null) return null;
    if (job.runAt) this.store.save(jobs.filter((j) => j.id !== job.id));
    else this.store.patch(job.id, { lastRun: new Date(now).toISOString(), lastSlot: slot });
    return job;
  }

  /** Raise or clear the owner's bell alert for one owned job. ONE key per job, so the host's alert store
   *  keeps a single row for it: a recurring job that keeps failing refreshes that row (latest error) and
   *  rings the owner's phone only when the alert is new or returns after a run that worked, and an alert
   *  the owner dismissed stays dismissed while the failure lasts. A one-shot's id is unique, so each
   *  wake-up gets its own alert. A bell that cannot be reached is logged and never stops the tick: the
   *  run itself is already settled in the journal. */
  async alertOwner(job, owner, problem) {
    const key = `run:${job.id}`;
    try {
      if (!problem) {
        await this.alerts.clear(key);
        return;
      }
      await this.alerts.raise({
        key,
        scope: { user: owner },
        severity: 'warning',
        message: { titleKey: `${problem.kind}.title`, bodyKey: `${problem.kind}.body`, params: { job: job.name, ...problem.params } },
        // A one-shot is deleted before it runs, so only a recurring job can still be opened.
        url: job.runAt ? AUTOMATION_PAGE : `${AUTOMATION_PAGE}?job=${encodeURIComponent(job.id)}`,
      });
    } catch (e) {
      this.log.error(`could not update the owner alert of cron job ${job.id} (${job.name}): ${e?.message ?? e}`);
    }
  }

  /** Persist the prepared payload as a PENDING delivery before attempting to send it — so a delivery
   *  failure never loses a result the model already produced (and, for a one-shot job, already paid the
   *  turn for). The pending record survives independently of the job: a one-shot's own row is gone by the
   *  time this runs (consumed before the turn, see the tick loop), so the record here is the only place
   *  left holding the result until it is actually delivered. */
  async deliverOrQueue(job, body, images) {
    const entry = {
      id: newId(),
      jobId: job.id, jobName: job.name, channelId: job.notifyChannelId, body, images, createdAt: new Date().toISOString(),
    };
    this.deliveryStore.add(entry);
    return this.attemptDelivery(entry);
  }

  /** Send one pending delivery, after claiming it so no other adapter generation sends the same result
   *  while this send is in flight (see DeliveryStore.claim). On success it is removed from the store; on
   *  failure the lease is released and it is LOGGED, left in place for the next tick's
   *  {@link flushPendingDeliveries} — never silently dropped. */
  async attemptDelivery(entry) {
    const claimed = this.deliveryStore.claim(entry.id, this.deliveryOwner, Date.now());
    if (!claimed) return false; // another generation is delivering it right now
    try {
      await this.deliver(claimed.body, claimed.channelId, claimed.images);
      this.deliveryStore.remove(claimed.id);
      return true;
    } catch (e) {
      this.deliveryStore.release(claimed.id, this.deliveryOwner);
      this.log.error(`cron delivery failed for job ${claimed.jobId} (${claimed.jobName}) — will retry next tick: ${e?.message ?? e}`);
      return false;
    }
  }

  /** Re-attempt every delivery still pending from an earlier tick, oldest first. Each is a plain re-send
   *  of the ALREADY-PRODUCED result — it never touches the model or the job's schedule. */
  async flushPendingDeliveries() {
    for (const entry of this.deliveryStore.all()) await this.attemptDelivery(entry);
  }
}

/** Parsing only proves the file was JSON, not that it holds what this plugin stores. A hand-edited or
 *  half-migrated state file can be `{}` instead of an array, or an array with a null in it — and iterating
 *  that threw inside the tick. Since the corruption is persistent, EVERY later tick failed the same way and
 *  no job ran again. So the shape is validated here: well-formed entries are kept, the rest are dropped
 *  with a log rather than allowed to take the scheduler down. */
function validEntries(value, isValid, onInvalid) {
  if (!Array.isArray(value)) {
    onInvalid('the file does not contain a JSON array');
    return [];
  }
  return value.filter((entry, index) => {
    if (isValid(entry)) return true;
    onInvalid(`entry #${index} is malformed`);
    return false;
  });
}

/** A record this plugin can safely iterate, patch and filter — anything else is not one of ours. */
const isRecord = (entry) => typeof entry === 'object' && entry !== null && !Array.isArray(entry) && typeof entry.id === 'string';

/** A bounded CREATION-RECEIPT store beside jobs.json: an HTTP retry with the same requestId lands as
 *  exactly one creation even across a plugin reload, including for a one-shot whose own row fired and
 *  deleted itself long before the retry arrives. Key: actor scope + client requestId; value: the jobId,
 *  the payload's canonical hash and when the row was minted. Retention: 24 hours, at most 1,000 rows —
 *  expired and oldest rows are pruned on every write AND at boot. */
const RECEIPTS_RETENTION_MS = 24 * 3_600_000;
const MAX_RECEIPTS = 1000;
class CreationReceiptStore {
  constructor(file, logger) { this.file = file; this.log = logger; }
  all() {
    const parsed = readJsonSafe(this.file, {}, (e) =>
      this.log?.error?.(`cron: corrupt creation-receipts file ${this.file} — treating as empty: ${e?.message ?? e}`));
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed)
      .filter(([, value]) => typeof value === 'object' && value !== null && typeof value.jobId === 'string'
        && typeof value.payloadHash === 'string'));
  }
  save(rows) {
    try { writeJsonAtomic(this.file, rows); }
    catch (e) { this.log?.error?.(`cron: failed to persist ${this.file}: ${e?.message ?? e}`); throw e; }
  }
  find(receiptKey) {
    const entry = this.all()[receiptKey];
    return typeof entry === 'object' && entry !== null ? entry : null;
  }
  /** Mint ONE receipt row; expired rows go first and the cap keeps the NEWEST, oldest dropped. */
  put(receiptKey, value, now) {
    const rows = Object.entries(this.all())
      .filter(([, entry]) => (Date.parse(entry.createdAt ?? '') || 0) > now - RECEIPTS_RETENTION_MS)
      .sort((a, b) => (Date.parse(a[1].createdAt ?? '') || 0) - (Date.parse(b[1].createdAt ?? '') || 0))
      .slice(-(MAX_RECEIPTS - 1));
    rows.push([receiptKey, value]);
    this.save(Object.fromEntries(rows));
  }
  /** Re-apply retention at boot: a receipt whose 24h passed must never answer a retry twice. */
  pruneExpired(now) {
    const rows = Object.entries(this.all())
      .filter(([, entry]) => (Date.parse(entry.createdAt ?? '') || 0) > now - RECEIPTS_RETENTION_MS)
      .sort((a, b) => (Date.parse(a[1].createdAt ?? '') || 0) - (Date.parse(b[1].createdAt ?? '') || 0))
      .slice(-MAX_RECEIPTS);
    const before = this.all();
    const after = Object.fromEntries(rows);
    if (JSON.stringify(Object.keys(after).sort()) !== JSON.stringify(Object.keys(before).sort())) this.save(after);
  }
}

class JobStore {
  constructor(file, logger) { this.file = file; this.log = logger; }
  all() {
    const parsed = readJsonSafe(this.file, [], (e) =>
      this.log?.error?.(`cron: corrupt jobs file ${this.file} — treating as empty: ${e?.message ?? e}`));
    return validEntries(parsed, isRecord, (reason) =>
      this.log?.error?.(`cron: skipping malformed job in ${this.file} — ${reason}`))
      .map((job) => ({ ...job, revision: Number.isSafeInteger(job.revision) && job.revision >= 0 ? job.revision : 0 }));
  }
  save(jobs) {
    try { writeJsonAtomic(this.file, jobs); }
    catch (e) { this.log?.error?.(`cron: failed to persist ${this.file}: ${e?.message ?? e}`); throw e; }
  }
  patch(id, fields) { this.save(this.all().map((j) => (j.id === id ? { ...j, ...fields } : j))); }
}

/** Results a tick prepared to deliver but could not send yet — a separate file from jobs.json because a
 *  one-shot job's own record is already gone (consumed before it ran) by the time delivery is attempted,
 *  so the pending record here is the only surviving copy of that result until it lands. */
class DeliveryStore {
  constructor(file, logger) {
    this.file = file; this.log = logger;
    this.migrateImages();
  }
  /** Add empty image lists to pre-image delivery records once, before any delivery attempt reads them. */
  migrateImages() {
    if (!existsSync(this.file)) return;
    let parsed;
    try { parsed = JSON.parse(readFileSync(this.file, 'utf8')); }
    catch (error) {
      this.log?.error?.(`cron: cannot migrate pending deliveries in ${this.file} — ${error?.message ?? error}`);
      return; // preserve the unreadable file for repair
    }
    if (!Array.isArray(parsed)) return; // all() reports malformed state without replacing it
    let changed = false;
    for (const entry of parsed) {
      if (isRecord(entry) && typeof entry.body === 'string' && entry.images === undefined) {
        entry.images = [];
        changed = true;
      }
    }
    if (changed) this.save(parsed);
  }
  all() {
    const parsed = readJsonSafe(this.file, [], (e) =>
      this.log?.error?.(`cron: corrupt pending-deliveries file ${this.file} — treating as empty: ${e?.message ?? e}`));
    return validEntries(parsed, (entry) => isRecord(entry) && typeof entry.body === 'string'
      && Array.isArray(entry.images) && entry.images.every((image) =>
        image?.type === 'image' && typeof image.ref === 'string' && imageRefName(image.ref)
        && (image.caption === undefined || typeof image.caption === 'string')), (reason) =>
      this.log?.error?.(`cron: skipping malformed pending delivery in ${this.file} — ${reason}`));
  }
  save(entries) {
    try { writeJsonAtomic(this.file, entries); }
    catch (e) { this.log?.error?.(`cron: failed to persist ${this.file}: ${e?.message ?? e}`); throw e; }
  }
  add(entry) {
    const entries = this.all();
    entries.push(entry);
    while (entries.length > MAX_PENDING_DELIVERIES) {
      const dropped = entries.shift();
      this.log?.error?.(`cron: pending delivery queue full — dropping oldest undelivered result for job ${dropped.jobId} (${dropped.jobName})`);
    }
    this.save(entries);
  }
  remove(id) {
    const entries = this.all();
    const next = entries.filter((e) => e.id !== id);
    if (next.length !== entries.length) this.save(next);
  }
  /** Take exclusive ownership of entry `id` for `owner` and return the claimed record, or null when it is
   *  gone or another owner holds an unexpired lease.
   *
   *  A pending delivery must be claimed before it is sent, for the same reason a due job is claimed before
   *  it is run (see CronAdapter.claimDueJob): this file is shared with any other adapter generation, and a
   *  plugin reload leaves the old one parked inside a slow deliver() with the entry still queued — the
   *  replacement's flush would pick it up and send the very same result a second time. Read-check-write is
   *  synchronous here, so the two can never both win the entry. */
  claim(id, owner, now) {
    const entries = this.all();
    const entry = entries.find((e) => e.id === id);
    if (!entry) return null;
    if (entry.leaseOwner && entry.leaseOwner !== owner && Number(entry.leaseUntil) > now) return null;
    const claimed = { ...entry, leaseOwner: owner, leaseUntil: now + DELIVERY_LEASE_MS };
    this.save(entries.map((e) => (e.id === id ? claimed : e)));
    return claimed;
  }
  /** Drop `owner`'s lease so the next tick can retry the entry immediately instead of waiting the lease
   *  out. A lease that has since been taken over by another owner is left alone. */
  release(id, owner) {
    const entries = this.all();
    const entry = entries.find((e) => e.id === id);
    if (!entry || entry.leaseOwner !== owner) return;
    const free = { ...entry };
    delete free.leaseOwner;
    delete free.leaseUntil;
    this.save(entries.map((e) => (e.id === id ? free : e)));
  }
}

export function register(ctx) {
  const store = new JobStore(join(ctx.dataDir(), 'jobs.json'), ctx.logger);
  const deliveryStore = new DeliveryStore(join(ctx.dataDir(), 'pending-deliveries.json'), ctx.logger);
  const receipts = new CreationReceiptStore(join(ctx.dataDir(), 'creation-receipts.json'), ctx.logger);
  const journal = openRunJournal(ctx.db());
  receipts.pruneExpired(Date.now());
  /** Assigned before register() returns; API handlers run later and can queue work on this live generation. */
  let adapter = null;
  const maxJobsPerUser = clampConfig(ctx.config?.maxJobsPerUser, DEFAULT_MAX_JOBS_PER_USER, 1, 200);
  const minIntervalMs = clampConfig(ctx.config?.minIntervalMinutes, DEFAULT_MIN_INTERVAL_MINUTES, 1, 1440) * 60_000;

  /** Whether the account owning a job may run its shell guard. Fail CLOSED: when the host cannot answer
   *  (a process with no store seam), the guard does not run — a shell command is the one thing here that
   *  must never execute on an assumption. An instance job has no account owner and is privileged by scope:
   *  CronAdd creation is operator-only, while the legacy HTTP route keeps its existing admin authorization. */
  const ownerIsAdmin = (userId) => {
    if (userId === null || userId === undefined) return true;
    try { return ctx.host.stores().usersRead.isAdmin(userId) === true; }
    catch (e) { ctx.logger.warn(`could not read whether user ${userId} is an admin (${e instanceof Error ? e.message : e}) — treating as not`); return false; }
  };
  /** Whether the account owning a job may still schedule at all — i.e. still holds this plugin's grant.
   *  Fail CLOSED like the shell guard: a host that cannot answer must not keep running somebody's
   *  unattended automation on an assumption. */
  const ownerMaySchedule = (userId) => {
    if (userId === null || userId === undefined) return true;
    try { return ctx.host.stores().usersRead.mayUsePlugin(userId, PLUGIN_NAME) === true; }
    catch (e) { ctx.logger.warn(`could not read whether user ${userId} may still schedule (${e instanceof Error ? e.message : e}) — treating as not`); return false; }
  };

  /** WHO owns a job: an account id, or null for an instance job. */
  const ownerOf = (job) => (typeof job?.ownerUserId === 'number' ? job.ownerUserId : null);

  /** The account behind the current turn, or null (an unlinked sender, a cron-of-cron turn). */
  const callerId = () => ctx.currentIdentity()?.elowenUserId ?? null;

  /** Why this account may not store this personal job, or null when it may. Instance jobs keep every
   *  privileged capability they always had; CronAdd's instance scope is operator-only. A personal job is
   *  deliberately narrower because it runs unattended on the operator's machine at its owner's schedule. */
  const ownedJobError = (job, jobs) => {
    // An OPERATOR keeps every privileged capability on a job they own. These four limits exist so an
    // ordinary account cannot schedule something that outruns its own authority while running unattended
    // on the operator's machine — but the operator's authority already IS the instance's, so applying
    // them to their jobs protects nothing. It only forces those jobs to stay ownerless, which is the
    // worse outcome: an instance job runs under no account at all, cannot be attributed in the activity
    // feed, and survives forever because there is no owner whose removal would clean it up.
    // The per-account job count below still applies to everyone — that one is about resources.
    //
    // Whose authority this is depends on WHO ends up owning the job. Writing your own job, the caller and
    // the owner are the same person, so the turn's identity answers it directly. HANDING one over they are
    // not: the operator's authority must not ride onto the recipient's record and leave them owning a
    // shell check they could never have written themselves, so the destination account is asked instead
    // — through the same predicate the scheduler re-checks before it runs that guard.
    const owner = ownerOf(job);
    const privileged = owner === callerId()
      ? ctx.currentIdentity()?.owner === true
      : ownerIsAdmin(owner);
    const parsed = parseSchedule(job.schedule);
    if (!privileged) {
      if (typeof job.check === 'string' && job.check.trim() && job.projectRef?.kind !== 'managed') {
        return 'a shell check requires an instance job; CronAdd instance scope is operator-only';
      }
      if (typeof job.notifyChannelId === 'string' && job.notifyChannelId.trim()) {
        return 'a personal job reports in its own conversation; a destination channel needs an instance job or an administrator owner';
      }
      // A 5-field cron expression can express "every minute" in ways a simple bound cannot catch, so the
      // plain forms — which the interval floor below fully covers — are the ones offered per account.
      if (parsed?.kind === 'cron') return 'cron expressions require operator-only instance scope — use "every 30m", "daily 07:30" or "weekly mon 09:00"';
      if (parsed?.kind === 'interval' && parsed.ms < minIntervalMs) {
        return `the shortest interval you can schedule is every ${Math.round(minIntervalMs / 60_000)}m`;
      }
    }
    const mine = jobs.filter((j) => ownerOf(j) === ownerOf(job) && j.id !== job.id).length;
    if (mine >= maxJobsPerUser) return `you already have ${maxJobsPerUser} scheduled jobs — remove one first`;
    return null;
  };

  // An account is gone: its jobs go with it. A job left behind has no owner to run as and no conversation
  // to report into, yet the scheduler would keep paying for its turns on every slot, forever.
  ctx.registerUserRemoved((userId) => {
    const jobs = store.all();
    const rest = jobs.filter((j) => ownerOf(j) !== userId);
    if (rest.length !== jobs.length) store.save(rest);
    journal.removeUser(userId);
  });

  // The teardown above only runs when THIS plugin happens to be loaded at the moment the account is
  // deleted. Disable cronjob, delete an account, enable it again and its jobs are still in the file —
  // firing forever for a person who no longer exists. So the same rule is re-applied at every load, from
  // the account list rather than from an event. A list read that throws leaves the file untouched: an
  // unreadable user table must never be read as "nobody exists".
  ctx.registerBootReconcile(() => {
    let ids;
    try { ids = new Set(ctx.host.stores().usersRead.list().map((u) => u.id)); }
    catch { return; }
    if (ids.size === 0) return;
    journal.removeMissingUsers(ids);
    const jobs = store.all();
    const rest = jobs.filter((j) => ownerOf(j) === null || ids.has(ownerOf(j)));
    if (rest.length === jobs.length) return;
    ctx.logger.info(`dropped ${jobs.length - rest.length} scheduled job(s) whose owning account no longer exists`);
    store.save(rest);
  });

  // ── Admin jobs API (root mounts, grandfathered core URLs): jobs.json is a SHARED list — the
  // scheduler stamps runs into it, CronAdd/ScheduleWakeup/CronRemove write it, and the settings deck edits it here.
  // So a write names exactly ONE job and the file is read-modify-written around it: taking the whole
  // array from a client whose snapshot predates someone else's new job would delete that job on save.
  // The scheduler re-reads the file every tick, so an edit applies live — no restart. ──
  const jobsFile = join(ctx.dataDir(), 'jobs.json');
  /** The jobs on disk, STRICT: throws when the file is present but unreadable. A caller about to
   *  write the list back must abort, not rebuild it from an empty base — a truncated read must never
   *  be mistaken for "there are no jobs". Only the read-only GET may treat that as empty (the
   *  scheduler's own JobStore stays tolerant for ticks; every route or tool about to write uses this). */
  const readJobsStrict = () => {
    if (!existsSync(jobsFile)) return [];
    const parsed = JSON.parse(readFileSync(jobsFile, 'utf-8'));
    if (!Array.isArray(parsed)) throw new Error('jobs.json is not an array');
    return parsed;
  };
  /** The fields a client owns. Everything else a job carries on disk is the SCHEDULER's (lastRun,
   *  lastSlot, lastResult, wake-up origin) and is merged back from the file — writing a stale lastRun
   *  back would make an interval job due again on the next tick, and a dropped lastSlot would re-fire
   *  a slot already run. */
  const CRON_FIELDS = ['id', 'name', 'schedule', 'prompt', 'check', 'hours', 'notifyChannelId', 'plain', 'model', 'enabled', 'runAt', 'createdAt', 'ownerUserId', 'projectRef'];
  /** Why this job is not storable, or null when it is. */
  const cronJobError = (j) => {
    for (const k of ['id', 'name', 'schedule', 'prompt']) {
      if (typeof j[k] !== 'string' || j[k].trim() === '') return `a job needs a non-empty "${k}"`;
    }
    const oneShot = j.runAt !== undefined;
    if (oneShot ? typeof j.runAt !== 'string' || Number.isNaN(Date.parse(j.runAt)) : !parseSchedule(j.schedule)) {
      return `invalid schedule "${String(j.schedule)}" — use "every 15m", "every 2h", "daily 07:30", "weekly sun 20:00" or a 5-field cron expression`;
    }
    if (j.check !== undefined && typeof j.check !== 'string') return 'check must be omitted or a string';
    if (j.notifyChannelId !== undefined && (typeof j.notifyChannelId !== 'string' || !j.notifyChannelId.trim())) {
      return 'notifyChannelId must be omitted or a non-empty string';
    }
    if (j.plain !== undefined && typeof j.plain !== 'boolean') return 'plain must be omitted or a boolean';
    if (j.model !== undefined && storedModel(j) === null) {
      return 'model must be omitted or an object with non-empty provider and model';
    }
    if (j.ownerUserId !== undefined && j.ownerUserId !== null && !Number.isInteger(j.ownerUserId)) {
      return 'ownerUserId must be omitted, null or an account id';
    }
    // Blank is REFUSED rather than read as "detach": an editor that clears the field by accident, or one
    // that sends an empty string where it means "unchanged", must not silently unfile a live job.
    if (j.conversationSessionId !== undefined && (typeof j.conversationSessionId !== 'string' || !j.conversationSessionId.trim())) {
      return 'conversationSessionId must be omitted or name a conversation';
    }
    return null;
  };
  const jsonRes = (body, status = 200) => ({ status, body });
  /** THE shared creation validation the POST route and the CronAdd / ScheduleWakeup tools call:
   *  the common job shape, the schedule/local runAt bounds (a one-shot at least five seconds ahead of
   *  NOW) and the per-account ceilings. Returns null when the draft is storable, or WHY it is not,
   *  with the machine-readable code the wire answer carries. */
  const creationError = (job, jobs) => {
    const shape = cronJobError(job);
    if (shape) return { error: shape, code: shape.startsWith('invalid schedule') ? 'invalid_schedule' : 'invalid_request' };
    if (job.runAt !== undefined && Date.parse(job.runAt) < Date.now() + ONESHOT_MIN_AHEAD_MS) {
      return { error: 'a one-shot wake-up must be at least five seconds ahead', code: 'invalid_request', field: 'localRunAt' };
    }
    const denied = ownerOf(job) !== null ? ownedJobError(job, jobs) : null;
    if (denied) return { error: denied, code: 'invalid_request', field: 'limits' };
    return null;
  };
  /** The canonical payload fingerprint an idempotency receipt stores: every field that decides the
   *  stored row, in one fixed order — a retry must answer the SAME row or a conflict. */
  const creationFingerprint = (body) => {
    const picked = {};
    for (const k of ['lifecycle', 'scope', 'name', 'schedule', 'prompt', 'conversationSessionId', 'enabled', 'hours', 'check', 'plain', 'model', 'notifyChannelId', 'localRunAt', 'projectRef']) {
      if (body[k] !== undefined) picked[k] = body[k];
    }
    return createHash('sha256').update(JSON.stringify(picked)).digest('base64url');
  };
  /** The actor scope a receipt row is filed under: instance jobs are ownerless, personal jobs belong
   *  to their one account — a client retry must find the receipt ONLY as the same account. */
  const receiptScope = (owner) => owner === null ? 'instance' : `u${owner}`;
  /** Build the storable one-shot row from the HTTP create body: the server resolves the local wall
   *  clock in the runtime timezone (never the browser), with the default `earlier` repeated-hour
   *  disambiguation and a spring-gap rejection. */
  const buildOneShotJob = (body, { owner, enabled }) => {
    const resolved = resolveLocalDateTime(ctx.timezone(), body.localRunAt.date, body.localRunAt.time, body.localRunAt.disambiguation ?? 'earlier');
    if (resolved.error === 'nonexistent') {
      return { error: 'that wall-clock time does not exist in the runtime timezone — it is skipped by the spring DST change', code: 'nonexistent_local_time', field: 'localRunAt' };
    }
    if (resolved.error) {
      return { error: 'localRunAt must be a valid local date and time', code: 'invalid_request', field: 'localRunAt' };
    }
    let model;
    if (typeof body.model === 'string' && body.model.trim()) {
      const parsed = parseModelSpec(body.model.trim());
      if (!parsed) return { error: `model "${body.model}" must name a provider AND a model as "provider/model"`, code: 'invalid_request', field: 'model' };
      model = parsed;
    } else if (body.model !== undefined) {
      if (typeof body.model !== 'object' || body.model === null) {
        return { error: 'model must be omitted or an object with non-empty provider and model', code: 'invalid_request', field: 'model' };
      }
      model = body.model;
    }
    return { job: {
      id: newId(),
      name: body.name,
      schedule: 'one-shot',
      runAt: new Date(resolved.ms).toISOString(),
      prompt: body.prompt,
      ...(model !== undefined ? { model } : {}),
      ...(enabled !== undefined ? { enabled } : {}),
      ...(owner !== null ? { ownerUserId: owner } : {}),
      ...(body.projectRef !== undefined ? { projectRef: body.projectRef } : {}),
      createdAt: new Date().toISOString(),
      // Optimistic concurrency starts with creation itself: a one-shot's first PUT races on 1.
      revision: 1,
    } };
  };
  /** Build the storable RECURRING row from the HTTP create body. Filing is REQUIRED, in the scope the
   *  owner implies, and the resolved pair (session id + immutable key) is imported by the server from
   *  the host — a client can never store a conversationKey by itself. */
  const buildRecurringJob = (body, { owner, actorUserId, enabled }) => {
    const association = associationEdit({
      prev: null, wanted: body.conversationSessionId, owner,
      actorUserId, oneShot: false,
    });
    return {
      association,
      job: {
        id: newId(),
        name: body.name,
        schedule: body.schedule,
        prompt: body.prompt,
        ...(body.check !== undefined ? { check: body.check } : {}),
        ...(body.hours !== undefined ? { hours: body.hours } : {}),
        ...(body.notifyChannelId !== undefined ? { notifyChannelId: body.notifyChannelId } : {}),
        ...(body.plain !== undefined ? { plain: body.plain } : {}),
        ...(body.model !== undefined ? { model: body.model } : {}),
        ...(enabled !== undefined ? { enabled } : {}),
        ...(owner !== null ? { ownerUserId: owner } : {}),
        ...(owner === null ? {} : toolProjectRef(owner)),
        ...association.fields,
        createdAt: new Date().toISOString(),
        // Armed from creation, exactly as every other writer arms a new job: it waits for its NEXT
        // natural slot, never firing on save.
        lastRun: new Date().toISOString(),
        // Optimistic concurrency begins at creation, so the very first edit already has a base.
        revision: 1,
      },
    };
  };

  /** WHOSE job a tool call creates, decided by the caller's EXPLICIT choice rather than by the shape of
   *  the session.
   *
   *  It used to read `if (ctx.isAdminSession()) return null`, which asked the wrong question: an admin
   *  talking in their own private chat is an admin session, so "remind me tomorrow" silently became an
   *  instance-wide job that reported to the notification channel instead of to the person who asked. Being
   *  an admin says what someone MAY do, never what they MEANT — so the tool asks, and `scope` is required.
   *
   *  'instance' stays owner-only: an instance job runs with owner powers, may carry a shell check and may
   *  report into any channel. A foreign admin session is broad project access, not authority over the instance. */
  const toolProjectRef = (owner) => {
    const ref = executionRef(ctx.currentAccess().projectRef);
    if (ref?.kind === 'managed' && owner === null) throw new Error('managed project schedules require personal scope');
    return ref ? { projectRef: ref } : {};
  };
  const toolOwner = (scope) => {
    if (scope === 'instance') {
      if (ctx.currentIdentity()?.owner !== true) throw new Error('only the instance owner may schedule an instance-wide job — use scope "personal" for your own');
      return null;
    }
    const me = callerId();
    if (me === null) throw new Error('scheduling needs an Elowen account behind the conversation');
    return me;
  };

  /** Persist the current one-person conversation as an origin. Direct adapters also supply an opaque
   *  delivery target so core can deliver the completed scheduled result through that exact adapter path.
   *  With `directOnly` an owner-chat conversation records nothing: a recurring job does not report where
   *  it was created, it reports in its own conversation. The scheduler's `boundOrigin` applies the same
   *  rule at fire time for records written before it existed — change both together. */
  const conversationOrigin = (userId, { directOnly = false } = {}) => {
    const sessionId = ctx.currentSessionId();
    const where = ctx.currentIdentity()?.conversation;
    if (!sessionId || (where !== 'own' && where !== 'direct')) return undefined;
    const deliveryTarget = where === 'direct' ? ctx.currentDeliveryTarget?.() : undefined;
    if (directOnly && where !== 'direct') return undefined;
    return {
      originSessionId: sessionId,
      originUserId: userId,
      ...(typeof deliveryTarget === 'string' ? { originDeliveryTarget: deliveryTarget } : {}),
    };
  };
  /** WHO may see or address a job, in ONE helper every surface shares — the chat tools and every
   *  HTTP route can never disagree: a personal job belongs to its OWNER alone; an instance job belongs
   *  to an administrator; an admin sees their own personal jobs plus the instance ones, never another
   *  account's. Unknown and foreign ids read exactly like `not_found`, so an id cannot probe identity.
   *
   *  An actor without an account behind it (a delegated turn) sees only instance jobs, and only when
   *  its session is an admin session — a delegated identity carries no `elowenUserId` while still
   *  inheriting its parent's plugin grant. */
  const canAddressJob = (actor, job) => {
    const owner = ownerOf(job);
    if (actor.userId === null) return owner === null && actor.admin === true;
    return owner === actor.userId || (actor.admin === true && owner === null);
  };
  const actorSeesJobs = (actor, jobs) => jobs.filter((j) => canAddressJob(actor, j));
  /** The call-snapshot an actor carries in this plugin: the turn's account (when it has one) and
   *  whether that session holds administrator access. */
  const toolActor = () => ({ userId: callerId(), admin: ctx.isAdminSession() });
  const visibleJobs = (jobs) => actorSeesJobs(toolActor(), jobs);

  // ── The organizational conversation a recurring job is filed under ──────────────────────────────
  // Filing, and nothing else. It never decides where a job runs, whose rights it runs with, which model
  // it uses or where its result is delivered — `originSessionId`/`originUserId`/`originDeliveryTarget`,
  // `ownerUserId`, `model` and `notifyChannelId` keep every one of those jobs, and the scheduler above
  // does not read a single field below.
  //
  // The association is a PAIR, written only by the server. `conversationSessionId` is the conversation's
  // CURRENT id, which is what navigation needs and what a client may name — but it is not stable: a
  // channel's idle rollover re-keys the row and frees the deterministic id for the next conversation on
  // that channel, possibly somebody else's. `conversationKey` is the host's immutable identity for the
  // row, minted from the session record and never accepted from a client (it is absent from CRON_FIELDS,
  // so a forged one is dropped with every other unknown field). Saved associations therefore resolve by
  // KEY: the job follows the conversation it was filed under, through a rollover and into the archive,
  // and an id that has been reused can never inherit it.
  const CONVERSATION_UNAVAILABLE = 'that conversation is not available to organize this job under';
  const CONVERSATION_REQUIRED = 'a new recurring job must name the conversation it is organized under (conversationSessionId)';
  const CONVERSATION_OWNER_MISMATCH = 'the saved conversation belongs to the previous owner — name one the new owner can use';
  const CONVERSATION_DIRECTORY_MISSING = 'this instance cannot resolve conversations, so the job was not saved';
  const CONVERSATION_NEEDS_ACCOUNT = 'organizing a job under a conversation needs an identified Elowen account';

  /** The host's read-only conversation projection, or null when this core has no such seam. Fail CLOSED:
   *  a save that cannot verify a target must refuse, never store an unverified one. */
  const conversationsRead = () => {
    try { return ctx.host.stores().conversationsRead ?? null; }
    catch (e) {
      ctx.logger.warn(`the host exposes no conversation directory (${e instanceof Error ? e.message : e})`);
      return null;
    }
  };

  /** Resolve a conversation the caller NAMED, in the scope the job's ownership implies: a personal job
   *  asks in its owner's scope (the host allows that account or an administrator), an instance job asks
   *  in the instance scope (administrators only). Null covers "does not exist", "not an eligible target"
   *  and "outside your scope" alike, so a save cannot be used to probe another account's conversations. */
  const resolveNamedTarget = (actorUserId, ownerUserId, sessionId) => {
    const read = conversationsRead();
    if (!read) return null;
    try { return read.resolve({ actorUserId, ownerUserId, sessionId }); }
    catch (e) {
      ctx.logger.warn(`conversation ${sessionId} refused for account ${actorUserId} (${e instanceof Error ? e.message : e})`);
      return null;
    }
  };

  /** Where a job's SAVED association points RIGHT NOW:
   *   - 'unset'   nothing was ever filed (a legacy job, a one-shot) — not an error;
   *   - 'linked'  the immutable key still names a conversation; `target` carries its CURRENT id;
   *   - 'missing' the key was minted here but its conversation is gone — an explicit state, never a
   *               silent detach and never a fall back to the stored id, which may now belong elsewhere;
   *   - 'unknown' the host could not answer, so nothing is claimed in either direction. */
  const savedAssociation = (job) => {
    const key = typeof job?.conversationKey === 'string' && job.conversationKey.trim() ? job.conversationKey : '';
    if (!key) return { state: 'unset', key: '', target: null };
    const read = conversationsRead();
    if (!read) return { state: 'unknown', key, target: null };
    try {
      const target = read.resolveKey(key);
      return target ? { state: 'linked', key, target } : { state: 'missing', key, target: null };
    } catch (e) {
      ctx.logger.warn(`could not resolve the conversation of job ${job?.id} (${e instanceof Error ? e.message : e})`);
      return { state: 'unknown', key, target: null };
    }
  };

  /** Whether a resolved conversation may stand as THIS job's file: a personal job is organized only under
   *  a conversation of its own account, an instance job under any eligible root the operator can read.
   *  Re-asked at every read, so a job that changed hands can never keep pointing at the previous owner's
   *  conversation, whatever is on disk. */
  const targetFitsOwner = (target, owner) => owner === null || target.ownerUserId === owner;

  /** The saved association as READERS must see it — the ownership rule already applied. */
  const jobAssociation = (job) => {
    const saved = savedAssociation(job);
    if (saved.state === 'linked' && !targetFitsOwner(saved.target, ownerOf(job))) {
      return { state: 'missing', key: saved.key, target: null };
    }
    return saved;
  };

  /** The association fields a save stores, or the reason it cannot be stored. An EMPTY `fields` means
   *  "keep exactly what is on disk": an editor that never heard of this field, and an edit that
   *  deliberately leaves an unavailable target in place, both preserve the stored pair. */
  const associationEdit = ({ prev, wanted, owner, actorUserId, oneShot }) => {
    const saved = prev ? savedAssociation(prev) : { state: 'unset', key: '', target: null };
    // Judged against the owner the job WILL have — that is what makes an ownership change revalidate.
    const fits = saved.state === 'linked' && targetFitsOwner(saved.target, owner);
    if (wanted === undefined) {
      if (!prev && !oneShot) return { error: CONVERSATION_REQUIRED };
      if (saved.state === 'linked' && !fits) return { error: CONVERSATION_OWNER_MISMATCH };
      return { fields: {} };
    }
    // The same conversation, named either by what is on disk or by the id it answers to today — a
    // rollover moves the live id and the editor round-trips the resolved one. Not a change, so nothing is
    // revalidated and an unavailable target stays exactly as it is.
    const unchanged = saved.state !== 'unset'
      && (wanted === prev?.conversationSessionId || (saved.state === 'linked' && wanted === saved.target.id));
    if (unchanged && saved.state === 'linked' && !fits) return { error: CONVERSATION_OWNER_MISMATCH };
    if (unchanged) return { fields: {} };
    if (typeof actorUserId !== 'number') return { error: CONVERSATION_NEEDS_ACCOUNT };
    if (!conversationsRead()) return { error: CONVERSATION_DIRECTORY_MISSING };
    const target = resolveNamedTarget(actorUserId, owner, wanted);
    if (!target) return { error: CONVERSATION_UNAVAILABLE };
    return { fields: { conversationSessionId: target.id, conversationKey: target.key } };
  };

  /** How many conversations one tool answer names. The listing is newest-first, so the tail is the least
   *  likely to be what somebody is filing a new job under — and an id can always be named directly. */
  const CONVERSATION_LIST_MAX = 25;

  /** Whether this turn happens where exactly ONE person reads: an own chat or a direct platform chat.
   *  The audience test for every conversation title or id this plugin prints into a conversation. */
  const inPrivateConversation = () => {
    const where = ctx.currentIdentity()?.conversation;
    return where === 'own' || where === 'direct';
  };

  /** One conversation as a tool answer names it: enough to recognize and to pass to CronAdd, never
   *  anything that was said in it. */
  const describeTarget = (target) => {
    const kind = target.platform ? `${target.platform} ${target.direct ? 'direct chat' : 'room'}` : 'own chat';
    return `- ${target.id} "${target.title || 'untitled'}" (${kind}, last active ${target.updatedAt})`;
  };

  /** The conversation this turn is happening in, when it is an eligible target. Asked in the caller's own
   *  scope first; an administrator may also be standing in a room owned by somebody else, which the host
   *  answers under the instance scope. */
  const currentRoomTarget = (actorUserId) => {
    const here = ctx.currentSessionId();
    if (!here) return null;
    const mine = resolveNamedTarget(actorUserId, actorUserId, here);
    if (mine || ctx.currentIdentity()?.admin !== true) return mine;
    return resolveNamedTarget(actorUserId, null, here);
  };

  /** How a job's filing may be described TO THIS ROOM. A conversation's title and id belong to the people
   *  who can already see it, so a shared room is told only THAT the job is filed somewhere — except when
   *  it is filed under this very room, which discloses nothing its audience does not already have. */
  const groupingLabel = (job) => {
    const assoc = jobAssociation(job);
    if (assoc.state === 'unset') return 'unassigned';
    if (assoc.state === 'missing') return 'conversation unavailable';
    if (assoc.state === 'unknown') return 'assigned (the conversation directory is unavailable)';
    if (assoc.target.id === ctx.currentSessionId()) return 'this conversation';
    return inPrivateConversation() ? (assoc.target.title || assoc.target.id) : 'assigned';
  };

  /** WHERE THE JOB'S TURNS RUN, for a reader of the job list — the same answer the scheduler routes by
   *  and the navigation seam hands to a conversation listing, read from `jobRunLocation` so a page can
   *  never state a location the daemon would not use. Read-only: it is derived on every response and is
   *  not a client-writable field (it is absent from CRON_FIELDS, so a sent one is dropped).
   *
   *  Only the KIND and the identifier travel. A dedicated conversation and a cron channel are exactly
   *  what the row has to distinguish from the conversation the job is FILED under, which is a different
   *  fact and already on the wire beside this one. */
  const publicRunLocation = (job) => {
    const location = jobRunLocation(job, ownerOf(job));
    return location.kind === 'channel'
      ? { kind: 'channel', channelId: location.channelId }
      : { kind: location.kind, sessionId: location.sessionId };
  };

  /** The client-facing shape of a stored job. The immutable key never leaves the daemon, and a live
   *  association is projected as the conversation's CURRENT id plus display metadata; an unavailable one
   *  keeps its stored id beside an explicit null, so the editor can say so and offer a reassignment
   *  instead of quietly showing nothing.
   *
   *  "Gone" and "could not be read" are separate answers on the wire, exactly as they are above. A failed
   *  read reported as `conversation: null` would tell the reader their conversation had been deleted and
   *  ask them to refile a job whose filing is very probably still good — a wrong answer, where the honest
   *  one is that nothing is known right now. */
  /** ONE strict read supplies the live engine inputs every projection answers with: the configured
   *  timezone, the scheduler's own tick and lookback, and the generation instant. */
  const liveEngineInputs = (overrides = {}) => ({
    timezone: overrides.timezone ?? ctx.timezone(),
    nowMs: overrides.nowMs ?? Date.now(),
    tickMs: overrides.tickMs ?? adapter?.tickMs ?? DEFAULT_TICK_MS,
    lookbackMs: overrides.lookbackMs ?? clampConfig(ctx.config?.cronLookbackMs, DEFAULT_CRON_LOOKBACK_MS, 3_600_000, 604_800_000),
  });

  /** The SERVER-derived next occurrence in the plan's CronNextOccurrence shape; null when disabled or
   *  when the schedule produces nothing next. A pending one-shot past its time keeps its scheduledAt
   *  and reports the current server time as expectedAt. */
  const nextOccurrenceFor = (job) => {
    if (job.enabled === false) return null;
    const live = liveEngineInputs();
    const planned = planOccurrences(job, { ...live, fromMs: live.nowMs, untilMs: live.nowMs + 366 * 86_400_000, maxOccurrences: 1 });
    const next = sortOccurrences(planned.occurrences)[0];
    if (!next) return null;
    return {
      occurrenceId: next.id,
      scheduledAt: next.scheduledAt,
      expectedAt: next.expectedAt,
      localDate: next.localDate,
      localTime: next.localTime,
      timezone: next.timezone,
      disposition: next.disposition,
      precisionMs: live.tickMs,
      guarded: next.guarded,
    };
  };
  /** A job must sit at least five seconds ahead of NOW when its run time is written (the same lower
   *  bound ScheduleWakeup enforces) — anything nearer would fire before the writer even learns the id. */
  const ONESHOT_MIN_AHEAD_MS = 5_000;

  /** The client-facing shape of a stored job. The immutable key never leaves the daemon, and a live
   *  association is projected as the conversation's CURRENT id plus display metadata; an unavailable
   *  one keeps its stored id beside an explicit null, so the editor can say so and offer a reassignment
   *  instead of quietly showing nothing.
   *
   *  Answer variants are the plan's additive projection on top of the historical fields: a derived,
   *  read-only lifecycle (oneShot iff runAt is present — there is no second field to disagree with
   *  it), the revision a client needs for CAS, the server-computed next occurrence and manual queue
   *  state. Field status stays exactly as before: "gone" and "could not be read" are separate answers. */
  const publicJob = (job) => {
    const { conversationKey: _key, ...base } = job;
    const lifecycle = job.runAt !== undefined && job.runAt !== null ? 'oneShot' : 'recurring';
    const projected = {
      ...base,
      runLocation: publicRunLocation(job),
      lifecycle,
      revision: Number.isSafeInteger(job.revision) && job.revision >= 0 ? job.revision : 0,
      nextOccurrence: nextOccurrenceFor(job),
      manualQueued: !!job.manualRequest,
    };
    const assoc = jobAssociation(job);
    if (assoc.state === 'unset') return projected;
    if (assoc.state === 'unknown') return { ...projected, conversation: null, conversationUnresolved: true };
    if (assoc.state !== 'linked') return { ...projected, conversation: null };
    return {
      ...projected,
      conversationSessionId: assoc.target.id,
      conversation: {
        id: assoc.target.id,
        title: assoc.target.title,
        ownerUserId: assoc.target.ownerUserId,
        platform: assoc.target.platform,
        direct: assoc.target.direct,
      },
    };
  };

  ctx.registerApiRoute({
    rootMount: '/plugins/cronjob/jobs', path: '', method: 'GET', access: 'user',
    handler: async (req) => {
      if (req.path !== '') return jsonRes({ error: 'not found', code: 'not_found' }, 404);
      let jobs;
      try { jobs = readJobsStrict(); }
      catch (error) {
        ctx.logger.warn(`strict jobs read failed (${error instanceof Error ? error.message : error})`);
        return jsonRes({ error: 'the scheduled jobs file could not be read', code: 'jobs_unreadable' }, 500);
      }
      // Filter FIRST, then enrich only the rows this caller may see. The actor boundary is the ONE
      // visibility helper every route shares; the host's own PluginUserView stays display-only.
      const visible = actorSeesJobs({ userId: req.auth.userId, admin: req.auth.admin === true }, jobs);
      let owners = new Map();
      try {
        owners = new Map(ctx.host.stores().usersRead.list().map((user) => [user.id, {
          id: user.id,
          username: user.username,
          name: String(user.name ?? '').trim() || user.username,
          avatar: user.avatar || '',
        }]));
      } catch (error) {
        ctx.logger.warn(`could not read cron job owner profiles (${error instanceof Error ? error.message : error})`);
      }
      return jsonRes(visible.map((job) => {
        const owner = ownerOf(job);
        const projected = publicJob(job);
        return owner !== null && owners.has(owner) ? { ...projected, owner: owners.get(owner) } : projected;
      }));
    },
  });

  /** Project authorization for a CREATE/EDIT draft: an execution target resolved, and a managed
   *  environment provisioned when it changes. Returns null when the draft may store, or the wire answer. */
  const authorizeProjectEdit = async (job, prevRow, req) => {
    try {
      const ref = executionRef(job.projectRef);
      if (!ref) return null;
      job.projectRef = ref;
      const changed = JSON.stringify(ref) !== JSON.stringify(prevRow?.projectRef) || ownerOf(job) !== ownerOf(prevRow ?? {});
      if (!changed) return null;
      if (ref.projectId === undefined) {
        if (!req.auth.admin || ownerOf(job) !== null) return jsonRes({ error: 'host administration requires an instance job', code: 'forbidden' }, 403);
      } else {
        if (!req.auth.admin && !req.auth.accessibleProjects?.includes(ref.projectId)) return jsonRes({ error: 'project forbidden', code: 'forbidden' }, 403);
        const project = ctx.host.stores().projects.get(ref.projectId);
        if (!project || (project.executionKind ?? 'host') !== ref.kind) return jsonRes({ error: 'invalid project execution target', code: 'invalid_request' }, 400);
        if (ref.kind === 'managed') {
          if (ownerOf(job) === null) return jsonRes({ error: 'managed project schedules require personal scope', code: 'invalid_request' }, 400);
          const provider = ctx.control('sandbox');
          if (!provider) return jsonRes({ error: 'project environment unavailable', code: 'scheduler_unavailable' }, 503);
          await provider.environmentFor({ project: ref, accountUserId: ownerOf(job) });
        } else if (ownerOf(job) !== null && !ownerIsAdmin(ownerOf(job)) && !ctx.host.stores().userProjects.canAccess(ownerOf(job), ref.projectId)) return jsonRes({ error: 'project forbidden', code: 'forbidden' }, 403);
      }
      return null;
    } catch { return jsonRes({ error: 'project execution target unavailable or forbidden', code: 'forbidden' }, 403); }
  };

  // Upsert ONE job, leaving every other job on disk exactly as it is.
  ctx.registerApiRoute({
    rootMount: '/plugins/cronjob/jobs', path: '', method: 'PUT', access: 'user',
    handler: async (req) => {
      const segs = req.path === '' ? [] : req.path.split('/');
      if (segs.length !== 1) return jsonRes({ error: 'not found' }, 404);
      let body;
      try { body = await req.json(); } catch { body = null; }
      if (!body || typeof body !== 'object' || Array.isArray(body)) return jsonRes({ error: 'body must be a job object' }, 400);
      const expectedRevision = body.expectedRevision;
      if (expectedRevision !== undefined && (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0)) {
        return jsonRes({ error: 'expectedRevision must be a non-negative integer' }, 400);
      }
      // The URL names the job — a body id can't redirect the write onto another one.
      const job = { ...body, id: decodeURIComponent(segs[0]) };
      // GET preserves legacy empty strings for display, while the canonical stored shape omits empty
      // optional fields. Normalize before validation so an untouched row can round-trip through the UI.
      for (const key of ['check', 'hours', 'notifyChannelId']) if (job[key] === '') delete job[key];

      // The write's ONE read-check-write rule lives at the BOTTOM of this handler: every step that may
      // await (a project environment provisioning) runs against the PROVISIONAL snapshot — the final
      // strict read below happens after, so the save can never write over a job the scheduler stamped
      // or another client added during the awaited steps.
      let jobs0;
      try { jobs0 = readJobsStrict(); }
      catch { return jsonRes({ error: 'jobs file is unreadable — refusing to write over it', code: 'jobs_unreadable' }, 500); }
      const prev0 = jobs0.find((j) => j.id === job.id);
      // Ownership is decided by the SERVER, never by the body. A non-admin owns only his own job and
      // cannot address what is not his; an admin writes their own personal jobs plus the instance ones;
      // an unknown or foreign id reads exactly like one that does not exist (same 404, no probing).
      // Authorization runs BEFORE any conflict payload below, and that ordering is the security
      // property: the conflict payload carries the whole previous job.
      const authorize = (prevRow) => {
        if (!req.auth.admin) {
          if (req.auth.userId === null) return jsonRes({ error: 'forbidden', code: 'forbidden' }, 403);
          if (prevRow && !canAddressJob({ userId: req.auth.userId, admin: false }, prevRow)) {
            return jsonRes({ error: 'not found', code: 'not_found' }, 404);
          }
          job.ownerUserId = req.auth.userId;
          return null;
        }
        if (job.ownerUserId === undefined) {
          // An admin's edit keeps whoever owns the job; a job he creates is an INSTANCE job, exactly as
          // every job was before ownership existed. An instance job carries NO owner key at all, so a
          // jobs.json written before ownership existed round-trips unchanged.
          const inherited = prevRow ? ownerOf(prevRow) : null;
          if (inherited !== null) job.ownerUserId = inherited;
          else delete job.ownerUserId;
        } else if (job.ownerUserId === null) {
          delete job.ownerUserId;
        }
        if (prevRow && !canAddressJob({ userId: req.auth.userId, admin: true }, prevRow)) {
          return jsonRes({ error: 'not found', code: 'not_found' }, 404);
        }
        return null;
      };
      const authed = authorize(prev0);
      if (authed) return authed;
      // A one-shot's local time is resolved by the SERVER in the runtime timezone — the browser never
      // converts a wall clock into an instant. `localRunAt` is optional on an edit and always wins over
      // a stale `runAt` a client echoes back.
      if (body.localRunAt !== undefined) {
        if (prev0 === undefined || prev0.runAt === undefined) {
          return jsonRes({ error: 'only a one-shot job accepts a localRunAt', code: 'invalid_request', field: 'localRunAt' }, 400);
        }
        const resolved = resolveLocalDateTime(ctx.timezone(), body.localRunAt.date, body.localRunAt.time, body.localRunAt.disambiguation ?? 'earlier');
        if (resolved.error === 'nonexistent') {
          return jsonRes({ error: 'that wall-clock time does not exist in the runtime timezone — it is skipped by the spring DST change', code: 'nonexistent_local_time', field: 'localRunAt' }, 400);
        }
        if (resolved.error) {
          return jsonRes({ error: 'localRunAt must be a valid local date and time', code: 'invalid_request', field: 'localRunAt' }, 400);
        }
        job.runAt = new Date(resolved.ms).toISOString();
      }
      // A row keeps its LIFECYCLE: recurring to one-shot and back is delete/recreate, never a save.
      if (prev0 !== undefined) {
        const prevIsOneShot = prev0.runAt !== undefined;
        if (!prevIsOneShot && job.runAt !== undefined) {
          return jsonRes({ error: 'a job keeps its lifecycle; delete and recreate it to change kind', code: 'invalid_request', field: 'lifecycle' }, 400);
        }
        // A one-shot keeps its stored instant when the client sends neither a new runAt nor a localRunAt.
        if (prevIsOneShot && job.runAt === undefined) job.runAt = prev0.runAt;
      }
      if (job.projectRef === undefined && prev0?.projectRef !== undefined) job.projectRef = prev0.projectRef;
      // The execution target rule is ONE helper, shared with create: a second inline copy here is a
      // second place the managed/host authorization could drift.
      const projectAuth = await authorizeProjectEdit(job, prev0 ?? null, req);
      if (projectAuth) return projectAuth;
      // ── THE final read-check-write: no await runs between this strict read and the save. ──
      let jobs;
      try { jobs = readJobsStrict(); }
      catch { return jsonRes({ error: 'jobs file is unreadable — refusing to write over it', code: 'jobs_unreadable' }, 500); }
      const prev = jobs.find((j) => j.id === job.id);
      const authedNow = authorize(prev);
      if (authedNow) return authedNow;
      if (prev && expectedRevision !== undefined && expectedRevision !== (Number.isSafeInteger(prev.revision) ? prev.revision : 0)) {
        return jsonRes({
          error: 'job changed on the server; reload it before saving',
          conflict: true,
          code: 'revision_conflict',
          current: publicJob(prev),
        }, 409);
      }
      if (!prev && expectedRevision !== undefined && expectedRevision !== 0) {
        return jsonRes({
          error: 'job changed on the server; reload it before saving',
          conflict: true,
          code: 'revision_conflict',
          current: null,
        }, 409);
      }
      const error = cronJobError(job) ?? (ownerOf(job) !== null ? ownedJobError(job, jobs) : null);
      if (error) return jsonRes({ error, code: 'invalid_request' }, 400);
      // Organization only: this decides which conversation the job is FILED under and touches nothing the
      // scheduler reads. Omission preserves whatever is on disk, including an unavailable target.
      const association = associationEdit({
        prev, wanted: job.conversationSessionId, owner: ownerOf(job),
        actorUserId: req.auth.userId, oneShot: !!job.runAt,
      });
      if (association.error) return jsonRes({ error: association.error, code: 'invalid_request' }, 400);
      const edit = {};
      for (const k of CRON_FIELDS) if (job[k] !== undefined) edit[k] = job[k];
      const runtime = {};
      for (const [k, v] of Object.entries(prev ?? {})) if (!CRON_FIELDS.includes(k)) runtime[k] = v;
      // A job that just flipped to enabled (or arrived new as enabled) is armed from NOW, so it waits
      // for its next natural slot instead of firing immediately. Arming means BOTH halves of the run
      // state: `lastSlot` decides a daily/weekly job on slot identity alone, so leaving Monday's slot
      // behind on a job re-enabled on Thursday would fire it on the spot. One-shot (runAt) jobs are
      // excluded — they fire exactly once, while lastRun is empty.
      const enabling = !job.runAt && edit.enabled !== false && (!prev || prev.enabled === false);
      if (enabling) delete runtime.lastSlot;
      // Ownership CHANGED, so the origin binding has to go with it. `originSessionId` names the previous
      // owner's conversation and wins over every other delivery rule at run time, so keeping it would
      // leave the job reporting into the old owner's chat — a silent redirect nobody asked for and
      // nobody can see in the job. Dropping it re-derives delivery from what the job says NOW: its
      // notification channel if it has one, otherwise the new owner's own conversation.
      if (prev && ownerOf(prev) !== ownerOf(edit)) {
        delete runtime.originSessionId;
        delete runtime.originUserId;
        delete runtime.originDeliveryTarget;
      }
      const saved = {
        ...edit,
        ...runtime,
        ...(enabling ? { lastRun: new Date().toISOString() } : {}),
        // After `runtime`, which carries the stored pair forward: a reassignment must replace BOTH halves
        // at once, never leave yesterday's key beside today's id.
        ...association.fields,
        revision: (prev?.revision ?? 0) + 1,
      };
      store.save(prev ? jobs.map((j) => (j.id === job.id ? saved : j)) : [...jobs, saved]);
      return jsonRes({ ok: true, job: publicJob(saved), revision: saved.revision });
    },
  });

  /** THE create route body: shape and scope first, then the lifecycle draft, the per-account ceilings
   *  and the project authorization — and, ONLY AFTER all of that, the idempotency receipt is written
   *  beside the row, so an invalid body never burns a requestId. An HTTP retry with the SAME requestId
   *  and the SAME payload answers the SAME row (200 idempotentReplay, even when the row has since
   *  fired and deleted itself); a reused requestId with DIFFERENT content is a conflict. */
  const createJobRoute = async (req, actor) => {
    let body;
    try { body = await req.json(); } catch { body = null; }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return jsonRes({ error: 'body must be a creation object', code: 'invalid_request' }, 400);
    }
    if (typeof body.requestId !== 'string' || !body.requestId.trim() || body.requestId.length > 200) {
      return jsonRes({ error: 'requestId must be a non-empty string (a UUID is a good one)', code: 'invalid_request', field: 'requestId' }, 400);
    }
    if (body.scope === undefined) body.scope = 'personal';
    if (body.scope !== 'personal' && body.scope !== 'instance') {
      return jsonRes({ error: 'scope must be "personal" or "instance"', code: 'invalid_request', field: 'scope' }, 400);
    }
    if (body.scope === 'instance' && !actor.admin) {
      return jsonRes({ error: 'instance scope requires an administrator', code: 'forbidden', field: 'scope' }, 403);
    }
    if (actor.userId === null) return jsonRes({ error: 'forbidden', code: 'forbidden' }, 403);
    // Personal is ALWAYS the authenticated account: an admin cannot create or transfer a personal job
    // onto another account from the HTTP surface.
    const owner = body.scope === 'instance' ? null : actor.userId;
    for (const field of ['name', 'prompt']) {
      if (typeof body[field] !== 'string' || body[field].trim() === '') {
        return jsonRes({ error: `"${field}" must be a non-empty string`, code: 'invalid_request', field }, 400);
      }
    }
    if (body.lifecycle !== 'recurring' && body.lifecycle !== 'oneShot') {
      return jsonRes({ error: 'lifecycle must be "recurring" or "oneShot"', code: 'invalid_request', field: 'lifecycle' }, 400);
    }
    if (body.lifecycle === 'oneShot') {
      // A one-shot is NEVER filed: filing must not be misused as delivery routing.
      if (body.conversationSessionId !== undefined) {
        return jsonRes({ error: 'a one-shot wake-up is never filed under a conversation', code: 'invalid_request', field: 'conversationSessionId' }, 400);
      }
      if (body.localRunAt === undefined || typeof body.localRunAt !== 'object' || Array.isArray(body.localRunAt)) {
        return jsonRes({ error: 'a one-shot needs localRunAt with date and time', code: 'invalid_request', field: 'localRunAt' }, 400);
      }
    } else if (body.conversationSessionId === undefined) {
      // Recurring filing stays REQUIRED, as it is everywhere else this plugin writes.
      return jsonRes({ error: CONVERSATION_REQUIRED, code: 'invalid_request', field: 'conversationSessionId' }, 400);
    }
    const fingerprint = creationFingerprint(body);
    const receiptKey = `${receiptScope(owner)}:${body.requestId}`;
    const receipt = receipts.find(receiptKey);
    if (receipt !== null) {
      if (receipt.payloadHash !== fingerprint) {
        return jsonRes({ error: 'this requestId was already used with different content', code: 'idempotency_conflict', field: 'requestId' }, 409);
      }
      let jobsNow;
      try { jobsNow = readJobsStrict(); }
      catch { return jsonRes({ error: 'the scheduled jobs file could not be read', code: 'jobs_unreadable' }, 500); }
      const prior = jobsNow.find((j) => j.id === receipt.jobId);
      // A replay whose row is gone (a fired one-shot deletes itself) still answers the SAME truth:
      // created once. Nothing is re-created twice by the same requestId.
      if (!prior) return jsonRes({ ok: true, idempotentReplay: true, jobId: receipt.jobId, job: null }, 200);
      return jsonRes({
        ok: true,
        idempotentReplay: true,
        jobId: receipt.jobId,
        job: publicJob(prior),
        revision: Number.isSafeInteger(prior.revision) ? prior.revision : 0,
      }, 200);
    }
    let draft;
    if (body.lifecycle === 'oneShot') draft = buildOneShotJob(body, { owner, enabled: body.enabled });
    else draft = buildRecurringJob(body, { owner, actorUserId: actor.userId, enabled: body.enabled });
    if (draft.error) return jsonRes({ error: draft.error, code: draft.code, ...(draft.field ? { field: draft.field } : {}) }, 400);
    if (draft.association?.error) return jsonRes({ error: draft.association.error, code: 'invalid_request', field: 'conversationSessionId' }, 400);
    let ceilingRows;
    try { ceilingRows = readJobsStrict(); }
    catch { return jsonRes({ error: 'the scheduled jobs file could not be read', code: 'jobs_unreadable' }, 500); }
    const denied = creationError(draft.job, ceilingRows);
    if (denied) return jsonRes({ error: denied.error, code: denied.code, ...(denied.field ? { field: denied.field } : {}) }, 400);
    const projectAuth = await authorizeProjectEdit(draft.job, null, req);
    if (projectAuth) return projectAuth;
    // ── THE final read-write: the awaited project authorization ran against the read above, so the
    //    row is appended to a list read AFTER it, with no await in between. ──
    let jobs;
    try { jobs = readJobsStrict(); }
    catch { return jsonRes({ error: 'the scheduled jobs file could not be read', code: 'jobs_unreadable' }, 500); }
    jobs.push(draft.job);
    store.save(jobs);
    // Written AFTER the row: an HTTP retry with this requestId replays the content hash instead of
    // creating a second job. An invalid body never burns a requestId on a receipt.
    //
    // THE ONE WINDOW THIS LEAVES: the row and its receipt are two atomic JSON files, so a crash
    // between these two writes loses the receipt while keeping the job. The order is the choice, not
    // an oversight — it makes that crash produce a VISIBLE duplicate on a retry rather than a reply
    // claiming a creation that never landed. Writing the receipt first would invert it: a receipt
    // whose row is absent is indistinguishable from a one-shot that already fired and deleted itself
    // (the `!prior` replay below), so the retry would answer "created" for a job that does not exist
    // and never will. Closing the window properly needs the two files to commit together — a
    // transaction this plugin deliberately does not have, because its persistence is atomic JSON that
    // an older plugin version must still be able to read. `cronJobsRoutes.test.ts` pins both the
    // ordering and the resulting behaviour.
    receipts.put(receiptKey, { jobId: draft.job.id, payloadHash: fingerprint, createdAt: new Date().toISOString() }, Date.now());
    return jsonRes({ ok: true, job: publicJob(draft.job), revision: 1 }, 201);
  };

  /** The durable manual run. Recurring jobs only. The request persists on the JOB (manualRequest),
   *  the scheduler claims at most the OLDEST one per tick before the natural due work, and a retried
   *  request finds its answer in `lastManualRequestId` instead of running twice. */
  const runJobRoute = async (req, actor, id) => {
    let body = null;
    try { body = await req.json(); } catch { body = null; }
    if (body === null || body === undefined) body = {};
    if (typeof body !== 'object' || Array.isArray(body)) {
      return jsonRes({ error: 'body must be a run request object', code: 'invalid_request' }, 400);
    }
    // Legacy callers send nothing: the server mints the request id, so their "run now" still carries
    // a dedupe token forward.
    const requestId = typeof body.requestId === 'string' && body.requestId.trim() ? body.requestId.trim() : newId();
    if (body.requestId !== undefined && typeof body.requestId !== 'string') {
      return jsonRes({ error: 'requestId must be a string', code: 'invalid_request', field: 'requestId' }, 400);
    }
    if (body.expectedRevision !== undefined && (!Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 0)) {
      return jsonRes({ error: 'expectedRevision must be a non-negative integer', code: 'invalid_request', field: 'expectedRevision' }, 400);
    }
    let jobs;
    try { jobs = readJobsStrict(); }
    catch { return jsonRes({ error: 'the scheduled jobs file could not be read', code: 'jobs_unreadable' }, 500); }
    const target = jobs.find((job) => job.id === id);
    if (!target || !canAddressJob({ userId: actor.userId, admin: actor.admin }, target)) {
      return jsonRes({ error: 'not found', code: 'not_found' }, 404);
    }
    if (target.runAt) return jsonRes({ error: 'a one-shot wake-up cannot be run manually', code: 'one_shot_manual_run' }, 400);
    if (body.expectedRevision !== undefined && (Number.isSafeInteger(target.revision) ? target.revision : 0) !== body.expectedRevision) {
      return jsonRes({ error: 'job changed on the server; reload it before running', conflict: true, code: 'revision_conflict', current: publicJob(target) }, 409);
    }
    if (target.manualRequest && target.manualRequest.id !== requestId) {
      return jsonRes({ error: 'a manual run is already queued for this job', code: 'run_already_queued' }, 409);
    }
    if (target.lastManualRequestId === requestId) {
      // The SAME requestId once answered: no second run, whatever the job's queue state now. A retry
      // reads its own PAST, not the scheduler's present availability.
      return jsonRes({ ok: true }, 202);
    }
    if (target.manualRequest) {
      // SAME requestId while still queued: idempotent, no second run.
      return jsonRes({ ok: true }, 202);
    }
    if (!adapter?.status().ready) {
      return jsonRes({ error: 'scheduler is not ready', code: 'scheduler_unavailable' }, 503);
    }
    store.patch(id, { manualRequest: { id: requestId, requestedAt: new Date().toISOString() } });
    queueMicrotask(() => void adapter.tick().catch((error) => ctx.logger.error(`manual run failed: ${error?.message ?? error}`)));
    return jsonRes({ ok: true }, 202);
  };

  // POST /plugins/cronjob/jobs — create; /:id/run — the durable manual run.
  ctx.registerApiRoute({
    rootMount: '/plugins/cronjob/jobs', path: '', method: 'POST', access: 'user',
    handler: async (req) => {
      const segs = req.path === '' ? [] : req.path.split('/');
      const actor = { userId: req.auth.userId, admin: req.auth.admin === true };
      if (segs.length === 0) return createJobRoute(req, actor);
      if (segs.length === 2 && segs[1] === 'run') return runJobRoute(req, actor, decodeURIComponent(segs[0]));
      return jsonRes({ error: 'not found', code: 'not_found' }, 404);
    },
  });
  // Idempotent: deleting a job that is already gone is a success, not a 404. A client racing its own
  // in-flight save (or another tab) must be able to say "this job should not exist" without having to
  // know whether it currently does.
  ctx.registerApiRoute({
    rootMount: '/plugins/cronjob/jobs', path: '', method: 'DELETE', access: 'user',
    handler: async (req) => {
      const segs = req.path === '' ? [] : req.path.split('/');
      if (segs.length !== 1) return jsonRes({ error: 'not found' }, 404);
      let jobs;
      try { jobs = readJobsStrict(); }
      catch { return jsonRes({ error: 'jobs file is unreadable — refusing to write over it' }, 500); }
      const id = decodeURIComponent(segs[0]);
      const target = jobs.find((j) => j.id === id);
      // Deleting is idempotent (a job already gone is a success), but deleting SOMEONE ELSE'S reads as
      // `not_found` — the same answer an absent row gives — so an id never learns what exists for
      // someone else. The `userId === null` clause is not redundant: an INSTANCE job also has no owner,
      // so an unidentified caller would otherwise match one and delete it (the PUT route refuses the
      // same caller, so accepting the delete would leave onboarding able to destroy but not create).
      if (!req.auth.admin && req.auth.userId === null) return jsonRes({ error: 'forbidden', code: 'forbidden' }, 403);
      if (target && !canAddressJob({ userId: req.auth.userId, admin: req.auth.admin === true }, target)) {
        return jsonRes({ error: 'not found', code: 'not_found' }, 404);
      }
      // Optional CAS: an `If-Match` header names a revision — the same CAS the PUT carries. A mismatch
      // answers with the CURRENT authorized projection, never a deletion.
      const ifMatchRaw = req.headers
        ? (typeof req.headers.get === 'function' ? req.headers.get('if-match') : req.headers['if-match'])
        : undefined;
      if (ifMatchRaw !== undefined) {
        const wanted = Number(String(ifMatchRaw).trim().replaceAll('"', ''));
        if (!Number.isSafeInteger(wanted) || wanted < 0) {
          return jsonRes({ error: 'If-Match must name a job revision', code: 'invalid_request', field: 'If-Match' }, 400);
        }
        if (target && (Number.isSafeInteger(target.revision) ? target.revision : 0) !== wanted) {
          return jsonRes({ error: 'job changed on the server; reload it before deleting', conflict: true, code: 'revision_conflict', current: publicJob(target) }, 409);
        }
      }
      const rest = jobs.filter((j) => j.id !== id);
      if (rest.length !== jobs.length) store.save(rest);
      return jsonRes({ ok: true });
    },
  });

  const shiftLocalDate = (localDate, amount) => {
    const [year, month, day] = localDate.split('-').map(Number);
    return new Date(Date.UTC(year, month - 1, day + amount)).toISOString().slice(0, 10);
  };
  const mondayOf = (localDate) => {
    const [year, month, day] = localDate.split('-').map(Number);
    const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
    return shiftLocalDate(localDate, -((weekday + 6) % 7));
  };
  const localDayBounds = (localDate, timezone) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(localDate)) return null;
    const [year, month, day] = localDate.split('-').map(Number);
    const start = zonedTimeToMs(timezone, year, month, day, 0, 0);
    if (localDateLabel(start, timezone) !== localDate) return null;
    const next = shiftLocalDate(localDate, 1).split('-').map(Number);
    return { start, end: zonedTimeToMs(timezone, next[0], next[1], next[2], 0, 0) - 1 };
  };
  const ownerProfiles = () => {
    try {
      return new Map(ctx.host.stores().usersRead.list().map((user) => [user.id, {
        id: user.id,
        username: user.username,
        name: String(user.name ?? '').trim() || user.username,
        avatar: user.avatar || '',
      }]));
    } catch (error) {
      ctx.logger.warn(`could not read cron owner profiles (${error instanceof Error ? error.message : error})`);
      return new Map();
    }
  };
  const withOwner = (job, owners) => {
    const projected = publicJob(job);
    const owner = ownerOf(job);
    return owner !== null && owners.has(owner) ? { ...projected, owner: owners.get(owner) } : projected;
  };
  const runActor = (req) => ({ userId: req.auth.userId, admin: req.auth.admin === true });

  // A bounded calendar projection: fixed schedules produce at most one card per job/day and intervals
  // produce exactly one table row, never hundreds of occurrences.
  ctx.registerApiRoute({
    path: 'week', method: 'GET', access: 'user',
    handler: async (req) => {
      const timezone = ctx.timezone();
      const nowMs = Date.now();
      const todayLocalDate = localDateLabel(nowMs, timezone);
      const daysCount = req.query.days === undefined ? 7 : Number(req.query.days);
      if (daysCount !== 1 && daysCount !== 7) {
        return jsonRes({ error: 'days must be 1 or 7', code: 'invalid_request', field: 'days' }, 400);
      }
      const startLocalDate = req.query.start === undefined
        ? mondayOf(todayLocalDate)
        : String(req.query.start);
      if (!localDayBounds(startLocalDate, timezone)) {
        return jsonRes({ error: 'start must be a real local calendar date YYYY-MM-DD', code: 'invalid_request', field: 'start' }, 400);
      }
      let jobs;
      try { jobs = readJobsStrict(); }
      catch (error) {
        ctx.logger.warn(`week calendar strict jobs read failed (${error instanceof Error ? error.message : error})`);
        return jsonRes({ error: 'the scheduled jobs file could not be read', code: 'jobs_unreadable' }, 500);
      }
      const actor = runActor(req);
      const visible = actorSeesJobs(actor, jobs);
      const owners = ownerProfiles();
      const endLocalDateExclusive = shiftLocalDate(startLocalDate, daysCount);
      const latest = journal.latestByJobDays(actor, startLocalDate, endLocalDateExclusive);
      const counts = journal.countsByDay(actor, startLocalDate, endLocalDateExclusive);
      const days = [];
      const intervals = [];
      let truncated = false;

      for (let offset = 0; offset < daysCount; offset += 1) {
        const localDate = shiftLocalDate(startLocalDate, offset);
        const bounds = localDayBounds(localDate, timezone);
        const cards = [];
        for (const job of visible) {
          const parsed = typeof job.runAt === 'string' ? { kind: 'oneShot' } : parseSchedule(job.schedule);
          if (!parsed || parsed.kind === 'interval') continue;
          const projection = {
            ...job,
            enabled: true,
            lastRun: undefined,
            lastSlot: undefined,
          };
          const summary = summarizeJobDay(projection, {
            timezone,
            nowMs: bounds.start - 60_000,
            tickMs: adapter?.tickMs ?? DEFAULT_TICK_MS,
            lookbackMs: clampConfig(ctx.config?.cronLookbackMs, DEFAULT_CRON_LOOKBACK_MS, 3_600_000, 604_800_000),
            dayStartMs: bounds.start,
            dayEndMs: bounds.end,
            maxTimes: 3,
          });
          if (summary.truncated) truncated = true;
          if (summary.remaining === 0 || summary.head.length === 0) continue;
          const [first, ...rest] = summary.head;
          const receipt = latest.get(`${job.id}:${localDate}`);
          cards.push({
            jobId: job.id,
            kind: parsed.kind,
            localTime: first.localTime,
            moreTimes: rest.slice(0, 3).map((entry) => entry.localTime),
            remaining: summary.remaining,
            enabled: job.enabled !== false,
            guarded: typeof job.check === 'string' && job.check.trim() !== '',
            disposition: first.disposition,
            state: job.enabled === false ? 'paused' : receipt?.outcome ?? 'waiting',
          });
        }
        cards.sort((a, b) => a.localTime.localeCompare(b.localTime) || a.jobId.localeCompare(b.jobId));
        days.push({
          localDate,
          cards,
          dayTotal: cards.length,
          runs: counts.get(localDate) ?? { ok: 0, error: 0, skipped: 0, running: 0 },
        });
      }

      const todayBounds = localDayBounds(todayLocalDate, timezone);
      for (const job of visible) {
        const parsed = parseSchedule(job.schedule);
        if (job.runAt || parsed?.kind !== 'interval') continue;
        const summary = job.enabled === false
          ? { remaining: 0, head: [], truncated: false }
          : summarizeJobDay(job, {
              ...liveEngineInputs({ timezone, nowMs }),
              dayStartMs: todayBounds.start,
              dayEndMs: todayBounds.end,
              maxTimes: 0,
            });
        const next = publicJob(job).nextOccurrence;
        const receipt = latest.get(`${job.id}:${todayLocalDate}`);
        intervals.push({
          jobId: job.id,
          schedule: job.schedule,
          enabled: job.enabled !== false,
          nextExpectedAt: next?.expectedAt ?? null,
          // The DAY of the next fire travels with its time. Active hours can defer an interval job past
          // midnight, and a bare "05:00" then reads as if it were still due today.
          nextLocalDate: next?.localDate ?? null,
          nextLocalTime: next?.localTime ?? null,
          remainingToday: summary.remaining,
          lastOutcome: receipt?.outcome ?? null,
          lastRunAt: receipt?.startedAt ?? null,
        });
      }
      intervals.sort((a, b) => a.jobId.localeCompare(b.jobId));
      return jsonRes({
        generatedAt: new Date(nowMs).toISOString(),
        todayLocalDate,
        nowLocalTime: localTimeLabel(nowMs, timezone),
        timezone,
        precisionMs: adapter?.tickMs ?? DEFAULT_TICK_MS,
        scheduler: adapter?.status() ?? { ready: false },
        window: { startLocalDate, endLocalDateExclusive },
        jobs: visible.map((job) => withOwner(job, owners)),
        days,
        intervals,
        truncated,
      });
    },
  });

  // One indexed, ACL-scoped run register serves both selected-day keyset pagination and History pager.
  ctx.registerApiRoute({
    path: 'runs', method: 'GET', access: 'user',
    handler: async (req) => {
      const segments = req.path === '' ? [] : req.path.split('/');
      const actor = runActor(req);
      if (segments.length === 1) {
        const row = journal.get(actor, decodeURIComponent(segments[0]));
        if (!row) return jsonRes({ error: 'not found', code: 'not_found' }, 404);
        const owner = row.ownerUserId === null ? undefined : ownerProfiles().get(row.ownerUserId);
        return jsonRes(owner ? { ...row, owner } : row);
      }
      if (segments.length !== 0) return jsonRes({ error: 'not found', code: 'not_found' }, 404);
      for (const field of ['date', 'from', 'to']) {
        if (req.query[field] !== undefined && !localDayBounds(String(req.query[field]), ctx.timezone())) {
          return jsonRes({ error: `${field} must be a real local calendar date YYYY-MM-DD`, code: 'invalid_request', field }, 400);
        }
      }
      if (req.query.outcome !== undefined && !['waiting', 'running', 'ok', 'error', 'skipped'].includes(String(req.query.outcome))) {
        return jsonRes({ error: 'invalid outcome', code: 'invalid_request', field: 'outcome' }, 400);
      }
      if (req.query.owner !== undefined && !['all', 'mine', 'instance'].includes(String(req.query.owner))) {
        return jsonRes({ error: 'invalid owner filter', code: 'invalid_request', field: 'owner' }, 400);
      }
      const query = {
        ...(req.query.date !== undefined ? { date: String(req.query.date) } : {}),
        ...(req.query.from !== undefined ? { from: String(req.query.from) } : {}),
        ...(req.query.to !== undefined ? { to: String(req.query.to) } : {}),
        ...(req.query.outcome !== undefined ? { outcome: String(req.query.outcome) } : {}),
        ...(req.query.owner !== undefined && req.query.owner !== 'all' ? { owner: String(req.query.owner) } : {}),
        ...(req.query.jobId !== undefined ? { jobId: String(req.query.jobId) } : {}),
        ...(req.query.q !== undefined ? { q: String(req.query.q).slice(0, 200) } : {}),
        ...(req.query.cursor !== undefined ? { cursor: String(req.query.cursor) } : {}),
        limit: Math.min(Math.max(Number(req.query.limit) || 50, 1), 100),
        offset: Math.max(Number(req.query.offset) || 0, 0),
      };
      try {
        const result = journal.list(actor, query);
        const owners = ownerProfiles();
        return jsonRes({
          ...result,
          runs: result.runs.map((row) => {
            const owner = row.ownerUserId === null ? undefined : owners.get(row.ownerUserId);
            return owner ? { ...row, owner } : row;
          }),
        });
      } catch (error) {
        return jsonRes({ error: error instanceof Error ? error.message : String(error), code: 'invalid_request', field: 'cursor' }, 400);
      }
    },
  });

  // ── The schedule draft preview: VALIDITY and next occurrences come from the server ──────────────
  // The browser never parses cron to validate or expand a draft; this route answers from the same
  // engine the scheduler runs, honoring lookback semantics only where the preview is future-facing.
  ctx.registerApiRoute({
    path: 'schedule-preview', method: 'POST', access: 'user',
    handler: async (req) => {
      let body;
      try { body = await req.json(); } catch { body = null; }
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return jsonRes({ error: 'body must be a preview request', code: 'invalid_request' }, 400);
      }
      if (typeof body.schedule !== 'string') {
        return jsonRes({ error: 'schedule must be a string', code: 'invalid_request', field: 'schedule' }, 400);
      }
      const count = body.count === undefined ? 5 : Number(body.count);
      if (!Number.isSafeInteger(count) || count < 1 || count > 10) {
        return jsonRes({ error: 'count must be an integer between 1 and 10', code: 'invalid_request', field: 'count' }, 400);
      }
      const timezone = ctx.timezone();
      const hoursValid = hoursAreValid(body.hours);
      const nowMs = Date.now();
      let fromMs = nowMs;
      if (body.fromLocalDate !== undefined) {
        if (/^\d{4}-\d{2}-\d{2}$/.test(String(body.fromLocalDate)) === false) {
          return jsonRes({ error: 'fromLocalDate must be a local calendar date YYYY-MM-DD', code: 'invalid_request', field: 'fromLocalDate' }, 400);
        }
        const [fy, fmo, fd] = String(body.fromLocalDate).split('-').map(Number);
        fromMs = zonedTimeToMs(timezone, fy, fmo, fd, 0, 0);
      }
      const sched = parseSchedule(body.schedule);
      if (!sched) {
        return jsonRes({
          valid: false, timezone, hoursValid, occurrences: [],
          error: 'invalid schedule — use "every 15m", "every 2h", "daily 07:30", "weekly sun 20:00" or a 5-field cron expression',
          code: 'invalid_schedule',
        }, 200);
      }
      const planned = planOccurrences(
        { id: 'preview', schedule: body.schedule, hours: body.hours },
        {
          timezone, nowMs, fromMs, untilMs: fromMs + 366 * 86_400_000,
          tickMs: DEFAULT_TICK_MS, lookbackMs: DEFAULT_CRON_LOOKBACK_MS,
          // A draft preview asks for a handful of dates, so the walk stops at the count it was asked
          // for (plus the one catch-up entry that sorts ahead of them) instead of expanding a year of
          // a one-minute interval to throw it away.
          maxOccurrences: count + 1, budgetCap: CALENDAR_CANDIDATE_BUDGET,
        },
      ).occurrences;
      return jsonRes({
        valid: true,
        kind: sched.kind,
        timezone,
        hoursValid,
        occurrences: sortOccurrences(planned).slice(0, count),
      });
    },
  });
  // The conversation picker the jobs editor fills its "organized under" field from. Authenticated, and
  // scoped by the HOST: this route only states WHOSE conversations it asks for, and the host refuses a
  // scope the caller may not have. Metadata only — never messages, and never the immutable key.
  ctx.registerApiRoute({
    path: 'conversations', method: 'GET', access: 'user',
    handler: async (req) => {
      const read = conversationsRead();
      if (!read) return jsonRes({ status: 'unavailable', conversations: [] });
      const actorUserId = req.auth.userId;
      if (typeof actorUserId !== 'number') return jsonRes({ error: 'forbidden' }, 403);
      const instance = req.query.scope === 'instance';
      const asked = req.query.owner ? Number(req.query.owner) : null;
      if (asked !== null && !Number.isInteger(asked)) return jsonRes({ error: 'owner must be an account id' }, 400);
      // Both the instance-wide picker and another account's picker are administrator scopes. Refused here
      // as well as inside the host, so the answer is a 403 rather than a thrown scope violation.
      if ((instance || (asked !== null && asked !== actorUserId)) && !req.auth.admin) {
        return jsonRes({ error: 'forbidden' }, 403);
      }
      try {
        const conversations = read.list({ actorUserId, ownerUserId: instance ? null : asked ?? actorUserId })
          .map((c) => ({
            id: c.id, title: c.title, ownerUserId: c.ownerUserId,
            platform: c.platform, direct: c.direct, updatedAt: c.updatedAt,
          }));
        return jsonRes({ status: 'available', conversations });
      } catch (e) {
        ctx.logger.warn(`conversation listing refused for account ${actorUserId} (${e instanceof Error ? e.message : e})`);
        return jsonRes({ error: 'forbidden' }, 403);
      }
    },
  });

  ctx.registerTool(defineTool({
    name: 'CronAdd', label: 'Schedule job',
    description: [
      'Schedule a recurring prompt — daily summaries, periodic checks, recurring reminders. The prompt fires as a brain turn on the schedule you set.',
      'You MUST say who the job is for with `scope`. Use "personal" when a person asks for something for themselves ("remind ME every morning"): it belongs to their account, runs with their rights, and reports in a conversation of its own named after the job — unless it was created in a direct platform chat (a 1:1 DM), which it then keeps reporting back into. Use "instance" only for automation that belongs to the whole instance, with no particular person behind it — that is owner-only, runs with owner powers and reports to the notification channel. When in doubt pick "personal": someone talking to you in their own chat is asking for themselves, even if they happen to be an admin.',
      'The schedule takes either a plain form — "every 15m", "every 2h", "daily 07:30", "weekly sun 20:00" — or a standard 5-field cron expression ("*/5 * * * *", "0 9 * * 1-5", "0 0 1 * *"). The format is detected automatically; reach for cron only when the plain form cannot express the timing you need.',
      'Avoid the :00 and :30 minute marks when the task allows it. Everyone who asks for "9am" gets minute 0, so every such job on every instance hits the same APIs at the same instant. When the time is approximate, pick a minute that is neither 0 nor 30: "every morning around 9" becomes "57 8 * * *" (or "daily 08:57"), not "0 9 * * *"; "hourly" becomes "7 * * * *", not "0 * * * *". Use 0 or 30 only when the person names that exact time and clearly means it — a meeting, "at 9:00 sharp". Nudging a few minutes either way is invisible to them and spreads the load.',
      'For polling work, use the `check` guard: a cheap shell command that runs BEFORE the prompt. If it prints nothing (or fails), the scheduled turn is skipped entirely — no model call. If it prints output, the brain runs and receives that output. This is how you poll for new work without paying for a model call on every tick.',
      'You MUST also say which conversation the job is FILED under, with `conversationSessionId`. That is organization only — it groups the job in the conversation list and changes nothing about how it runs: not its context, not its model, not its permissions and not where its reply is delivered. Get an id from CronConversations; the current conversation is usually the right answer, but the id has to be passed explicitly rather than assumed.',
      'Use `hours` ("H-H", e.g. "5-21") to keep a job quiet outside active hours, `enabled: false` to create it paused, and `plain: true` to deliver the reply without the "⏰ job name" header. Returns the job id — pass it to CronRemove to cancel, and see everything currently scheduled with CronList.',
      'This tool is only for work that REPEATS on a timer. To come back to something exactly once — a reminder later today, checking on a deploy in ten minutes — use ScheduleWakeup, which fires a single time and deletes itself. A new job never fires on creation; it waits for its next natural slot.',
    ].join(' '),
    parameters: Type.Object({
      name: Type.String({ description: 'Short human name for the job, shown in schedules and telemetry' }),
      scope: Type.Union([Type.Literal('personal'), Type.Literal('instance')], { description: 'Who the job is for. "personal" = the person you are talking to; it runs with their rights and reports in a conversation of its own, or back into this chat when this is a direct platform chat. "instance" = the whole instance, owner only. Required: broad admin access does not grant authority over instance automation, and scope must not be guessed.' }),
      schedule: Type.String({ description: '"every <N>m", "every <N>h", "daily HH:MM", "weekly <mon..sun> HH:MM", or a 5-field cron expression (e.g. "0 9 * * 1-5")' }),
      prompt: Type.String({ description: 'The prompt to run on schedule' }),
      conversationSessionId: Type.String({ description: 'The conversation this job is organized under, by its id from CronConversations. Filing only: it groups the job in the conversation list and never changes the job\'s context, model, permissions or where its result is delivered. Required, and never guessed — a personal job may only name a conversation of its own account.' }),
      check: Type.Optional(Type.String({ description: 'Host guards require instance-owner authority. Personal managed-project guards run inside the selected project. Optional cheap shell guard run BEFORE the prompt. If it prints nothing (or fails), the scheduled brain turn is skipped — no LLM call. If it prints output, the brain runs and receives that output. Use it to poll for new work without paying for a model call each tick, e.g. a collector script that only prints when there is something new.' })),
      hours: Type.Optional(Type.String({ description: 'Active-hours window "H-H" (e.g. "5-21") — outside it the job stays quiet' })),
      notifyChannelId: Type.Optional(Type.String({ description: 'Deliver results to this channel/thread instead of the default notification channel. Instance-owner scope only — personal jobs always report in their own conversation.' })),
      plain: Type.Optional(Type.Boolean({ description: 'true = deliver the reply as-is, without the "⏰ job name" header line — for persona messages in a dedicated channel' })),
      model: Type.Optional(Type.String({ description: 'Run this job on a specific brain model, as "provider/model" (e.g. "anthropic/claude-sonnet-5"). BOTH halves are required — a bare model id is rejected, because the same id can exist on several providers. Empty = the server default.' })),
      enabled: Type.Optional(Type.Boolean({ description: 'false = create the job paused' })),
    }),
    execute: async (_id, p) => {
      try {
        const owner = toolOwner(p.scope);
        if (!parseSchedule(p.schedule)) return ok('Error: invalid schedule — use "every 15m", "every 2h", "daily 07:30", "weekly sun 20:00", or a 5-field cron expression like "0 9 * * 1-5".');
        const jobs = readJobsStrict();
        const id = newId();
        // "provider/model" → the stored pair. An empty value means "no preference" and runs the server
        // default; a value that NAMES a model but not its provider (or the other way round) is refused
        // rather than dropped. Dropping it was the quiet failure: the caller asked for one model, the tool
        // reported the job as scheduled, and every run then went to whatever the server default happened
        // to be — visible only as a footer nobody cross-checks against the job.
        const wanted = typeof p.model === 'string' ? p.model.trim() : '';
        const model = wanted ? parseModelSpec(wanted) : undefined;
        if (wanted && !model) return ok(`Error: model "${wanted}" must name a provider AND a model as "provider/model" (e.g. "anthropic/claude-sonnet-5"). Leave it empty to run on the server default.`);
        // A personal job scheduled from a direct platform chat remembers it, so "tell me here every
        // morning" in a Teams DM reports where it was promised. From the web it records nothing: the job
        // reports in a conversation of its own, not in whatever the owner was working on when they asked.
        const origin = owner !== null ? conversationOrigin(owner, { directOnly: true }) : undefined;
        // WHERE the job is filed, decided explicitly and resolved by the host. Separate from `origin`
        // above, which is the delivery binding: the two are allowed to name different conversations and
        // neither is derived from the other. The actor is the turn's own verified account — a delegated
        // turn carries none, and organizing on somebody's behalf is not something a tool may assume.
        const filedUnder = typeof p.conversationSessionId === 'string' ? p.conversationSessionId.trim() : '';
        if (!filedUnder) return ok(`Error: ${CONVERSATION_REQUIRED}.`);
        const actor = callerId();
        if (actor === null) return ok(`Error: ${CONVERSATION_NEEDS_ACCOUNT}.`);
        if (!conversationsRead()) return ok(`Error: ${CONVERSATION_DIRECTORY_MISSING}.`);
        const target = resolveNamedTarget(actor, owner, filedUnder);
        if (!target) return ok(`Error: ${CONVERSATION_UNAVAILABLE}.`);
        // lastRun starts at creation time so a fresh job waits for its NEXT natural slot — a
        // "daily 06:00" created at 15:00 must not fire immediately.
        const job = { id, ...toolProjectRef(owner), name: p.name, schedule: p.schedule, prompt: p.prompt, check: p.check, hours: p.hours, notifyChannelId: p.notifyChannelId, plain: p.plain, model, enabled: p.enabled, ...(owner !== null ? { ownerUserId: owner } : {}), ...origin, conversationSessionId: target.id, conversationKey: target.key, createdAt: new Date().toISOString(), lastRun: new Date().toISOString() };
        // The SHARED creation validation the web POST route runs — the same same shape, schedule
        // bounds and per-account ceilings. The tool answers in its own voice; the rule is one.
        const denied = creationError(job, jobs);
        if (denied) return ok(`Error: ${denied.error}.`);
        jobs.push(job);
        store.save(jobs);
        const lands = owner === null
          ? 'It will report through the notification channel.'
          : origin ? 'It will report here, in this chat.' : `It will report in a conversation of its own, named "${p.name}".`;
        // Confirmed without naming the conversation: the caller supplied the id, and a title read back
        // into a shared room would tell everyone present what that conversation is called.
        const filed = target.id === ctx.currentSessionId()
          ? 'It is grouped under this conversation.'
          : 'It is grouped under the conversation you named.';
        return ok(`Scheduled "${p.name}" (${p.schedule}) — id ${id}. ${lands} ${filed}`);
      } catch (e) { return fail(e); }
    },
  }));

  ctx.registerTool(defineTool({
    name: 'ScheduleWakeup', label: 'Schedule wake-up',
    description: [
      'Schedule a ONE-SHOT wake-up for yourself after a delay ("in 30s", "in 20m", "in 2h") or at a time ("at 18:30") to run a prompt. Strictly one-shot — the job removes itself after firing. Scheduled from a user conversation, the wake-up resumes THAT conversation with its full existing context and replies there, so the follow-up lands where it was promised.',
      'Use it to check back on / verify something that changes over time but does not notify you — a CI run, a deploy, an external queue — in the same conversation. Do NOT use it to poll background work you started here: a background sub-agent and a background command both wake you on their own when they finish, so a wake-up on top of them only fires redundantly. If you want a safety net for work that might hang, set a LONG fallback ("in 30m") rather than a short poll.',
      'Pick the delay from how fast the watched thing actually changes, not from round numbers: a CI run that takes ~8 minutes deserves one "in 5m" check, not ten at 30s. For an idle tick with no specific signal, 20-30 minutes is the sane default.',
      'It fires exactly once and then disappears, so it is the wrong tool for anything recurring — a daily summary, a reminder every Monday, a periodic poll belong in CronAdd, which repeats on a schedule until removed. A pending wake-up shows up in CronList and can be cancelled with CronRemove before it fires.',
    ].join(' '),
    parameters: Type.Object({
      name: Type.String({ description: 'Short, specific human name — "check-deploy" beats "wakeup". Shown in schedules and telemetry.' }),
      when: Type.String({ description: '"in <N>s", "in <N>m", "in <N>h" or "at HH:MM"' }),
      prompt: Type.String({ description: 'What to do when you wake up. From a user conversation the wake-up resumes that same thread with its full context, so write a short note to your future self — what to check and what to do with the result ("verify deploy #142 finished; report the outcome"), not a recap of the conversation. Only a wake-up scheduled outside a user conversation runs standalone with just this prompt, so make it self-contained then.' }),
    }),
    execute: async (_id, p) => {
      try {
        // Unlike CronAdd there is nothing to ask here: "come back to this later" is always for whoever is
        // asking, so a turn with an account behind it always gets a personal wake-up. Only automation with
        // no account at all — a job's own turn rescheduling itself — has nobody to own it and falls to the
        // instance, which requires the operator identity just like explicit CronAdd instance scope.
        const owner = toolOwner(callerId() === null ? 'instance' : 'personal');
        const runAt = parseOneShot(p.when, Date.now(), ctx.timezone());
        if (!runAt) return ok('Error: invalid time — use "in 30s", "in 20m", "in 2h" or "at 18:30".');
        const jobs = readJobsStrict();
        const id = newId();
        // A wake-up scheduled where exactly ONE person reads records its origin: owner chat resumes the
        // bound conversation, while a direct platform chat carries its opaque delivery target back to core.
        // A shared room and a cron-of-cron turn keep no origin and deliver through the notification channel
        // as before — there the answer would land in front of everyone else. This used to exclude every
        // `brain-ch-…` id, which also excluded a private 1:1 chat, because the two were indistinguishable.
        const uid = ctx.currentIdentity()?.elowenUserId;
        const origin = uid != null ? conversationOrigin(uid) : undefined;
        const job = { id, ...toolProjectRef(owner), name: p.name, schedule: p.when, prompt: p.prompt, runAt: new Date(runAt).toISOString(), ...(owner !== null ? { ownerUserId: owner } : {}), createdAt: new Date().toISOString(), ...origin };
        // The shared creation validation, including the five-second lower bound a one-shot must clear.
        const denied = creationError(job, jobs);
        if (denied) return ok(`Error: ${denied.error}.`);
        jobs.push(job);
        store.save(jobs);
        return ok(`Wake-up "${p.name}" set for ${new Date(runAt).toISOString()} — id ${id}.${origin ? ' It will reply in this conversation.' : ''}`);
      } catch (e) { return fail(e); }
    },
  }));

  ctx.registerTool(defineTool({
    name: 'CronList', label: 'List jobs',
    description: [
      'List the scheduled jobs, timers and reminders that are currently set up: for each one its id, name, schedule, when it last ran and what that run produced.',
      'Use it to answer what is scheduled, whether a recurring task is still active, when a job last fired and whether it succeeded — and to get the job id that CronRemove needs. It takes no parameters and changes nothing, so it is safe to call before deciding what to cancel.',
      'Both kinds of entry appear here: recurring jobs created with CronAdd, and pending one-shot wake-ups from ScheduleWakeup, which are marked "one-shot" with their fire time. A wake-up that has already fired is gone, because a one-shot deletes itself after running.',
      'You see your own jobs, plus instance-wide jobs when your session has admin access; another account\'s personal jobs stay private. A job that never ran yet reports its last run as "never".',
    ].join(' '),
    parameters: Type.Object({}),
    execute: async () => {
      try {
        const jobs = visibleJobs(store.all());
        if (jobs.length === 0) return ok('No scheduled jobs.');
        return ok(jobs.map((j) => {
          // Name the pinned model when there is one. A run reports the model it actually used, so without
          // the job's own selection beside it there is nothing to compare that against — and "pinned to
          // Opus but every footer says Sonnet" is unanswerable from a listing that never mentions models.
          const sel = storedModel(j);
          // Filing, not delivery: a one-shot wake-up is never grouped, so it says nothing here.
          const grouped = j.runAt ? '' : `\n  grouped: ${groupingLabel(j)}`;
          return `- ${j.id} "${j.name}" ${j.schedule}${j.runAt ? ` (one-shot @ ${j.runAt})` : ''}${sel ? `\n  model: ${sel.provider}/${sel.model}` : ''}${grouped}\n  last run: ${j.lastRun ?? 'never'}\n  last result: ${j.lastResult ?? '—'}`;
        }).join('\n'));
      } catch (e) { return fail(e); }
    },
  }));

  ctx.registerTool(defineTool({
    name: 'CronConversations', label: 'List conversations',
    description: [
      'List the conversations a recurring job can be ORGANIZED under, with the id CronAdd needs for its required `conversationSessionId`. Read-only: it changes nothing and schedules nothing.',
      'Grouping is filing, not routing. It decides where a job appears in the conversation list and nothing else — not the context the job runs with, not its model, not its permissions, and not where its result is delivered. So pick the conversation the work belongs to, which is usually the one you are in.',
      'By default it lists the conversations of the account you are talking to, which are the only ones a personal job may be filed under. `scope: "instance"` lists every account\'s eligible conversation and is for instance-wide jobs; it is owner-only.',
      'In a shared room it does not list anything private: it offers that room alone, if the room itself is eligible. Ask again in a private chat, or use the Automation page, when you need the full list.',
    ].join(' '),
    parameters: Type.Object({
      scope: Type.Optional(Type.Union([Type.Literal('personal'), Type.Literal('instance')], {
        description: 'Whose conversations to list. "personal" (the default) = the account you are talking to. "instance" = every account, for instance-wide jobs; owner-only.',
      })),
    }),
    execute: async (_id, p) => {
      try {
        const read = conversationsRead();
        if (!read) return ok(`Error: ${CONVERSATION_DIRECTORY_MISSING}.`);
        const me = callerId();
        if (me === null) return ok(`Error: ${CONVERSATION_NEEDS_ACCOUNT}.`);
        // A shared room is an audience, not an identity. Listing here would read out the names and ids of
        // conversations everybody present has no access to — being an admin says what someone may do, not
        // who else is in the room. The room itself discloses nothing its own members do not already have.
        if (!inPrivateConversation()) {
          const here = currentRoomTarget(me);
          return ok(here
            ? `${describeTarget(here)}\nOnly this room is offered here. Ask again in a private chat, or use the Automation page, to see the rest.`
            : 'No conversation can be offered in a shared room. Ask again in a private chat, or use the Automation page.');
        }
        const instance = p.scope === 'instance';
        if (instance && ctx.currentIdentity()?.owner !== true) {
          return ok('Error: only the instance owner may list conversations across accounts — omit `scope` for your own.');
        }
        const targets = read.list({ actorUserId: me, ownerUserId: instance ? null : me });
        if (targets.length === 0) return ok('No conversation is available to organize a job under.');
        const shown = targets.slice(0, CONVERSATION_LIST_MAX);
        const rest = targets.length - shown.length;
        return ok([
          ...shown.map(describeTarget),
          ...(rest > 0 ? [`… and ${rest} less recently used conversation(s) — name one directly by its id if you know it.`] : []),
        ].join('\n'));
      } catch (e) { return fail(e); }
    },
  }));

  ctx.registerTool(defineTool({
    name: 'CronRemove', label: 'Remove job',
    description: [
      'Cancel a scheduled job by its id — deleting the recurring task, timer or reminder so it stops firing immediately and never runs again.',
      'Use it when the user asks to stop, cancel or turn off something that was scheduled, or when a job you created is no longer needed. Get the id from CronList, or from the result CronAdd or ScheduleWakeup returned when the job was created; the id is required, and there is no way to cancel by name.',
      'It removes both recurring schedules and pending one-shot wake-ups. The deletion is permanent and cannot be undone — the job definition, including its prompt and schedule, is gone, so recreate it with CronAdd if it is needed again. To pause a recurring job instead of losing it, disable it rather than removing it.',
      'You may remove your own jobs, plus instance-wide jobs when your session has admin access. Another account\'s personal job remains inaccessible. An id that does not exist and an id belonging to someone else return the same error, so this cannot be used to discover what other people have scheduled.',
    ].join(' '),
    parameters: Type.Object({ id: Type.String({ description: 'The job id to cancel, exactly as shown by CronList or returned by CronAdd / ScheduleWakeup' }) }),
    execute: async (_id, p) => {
      try {
        const jobs = readJobsStrict();
        // Unknown and not-yours read the same, so this can never be used to probe what else is scheduled.
        if (!visibleJobs(jobs).some((j) => j.id === p.id)) return ok(`Error: no job with id ${p.id}.`);
        store.save(jobs.filter((j) => j.id !== p.id));
        return ok(`Removed job ${p.id}.`);
      } catch (e) { return fail(e); }
    },
  }));

  // The retention janitor's seam (the host reads it via registry.control('cron')): which of this user's
  // conversations a live job still RUNS IN, so an idle stretch longer than the retention horizon cannot
  // purge them. A one-shot wake-up is deleted at fire time (and by CronRemove), so its presence in the
  // store IS pendingness; a recurring job is pending for as long as it is enabled, and its dedicated
  // conversation is exactly where its run history lives between runs. Read from jobRunLocation, the one
  // place that decides where a job runs, so the janitor and the scheduler can never disagree. A channel
  // run carries no conversation of this user's to retain.
  ctx.registerControl('cron', {
    retainedSessionIds: (userId) => {
      const ids = [];
      for (const job of store.all()) {
        if (job.enabled === false) continue;
        const location = jobRunLocation(job, ownerOf(job));
        if (location.kind !== 'channel' && location.userId === userId) ids.push(location.sessionId);
      }
      return ids;
    },
    /** The NAVIGATION seam behind a conversation listing's collapsed jobs branch: which recurring jobs are
     *  filed under conversations the host has ALREADY authorized for this requester. Organization only —
     *  it says nothing about where a job runs or where its result goes, and reading it changes nothing.
     *
     *  Optional by contract, so an older core that never calls it keeps working; core re-checks the ids
     *  and the job visibility on the way out, and builds the link itself. Called once per listing. */
    conversationLinks: ({ requesterUserId, requesterIsAdmin, conversationIds }) => {
      if (typeof requesterUserId !== 'number') throw new Error('conversationLinks needs a host-verified requester');
      const authorized = new Set((Array.isArray(conversationIds) ? conversationIds : []).filter((id) => typeof id === 'string'));
      if (authorized.size === 0) return [];
      // STRICT read on purpose: a jobs file that cannot be parsed must reach core as a FAILURE. Answered
      // with an empty array it would read as "this account has nothing scheduled", which is a different
      // claim entirely and the one thing a navigation panel must never invent.
      const links = [];
      for (const job of readJobsStrict()) {
        if (!isRecord(job) || job.runAt) continue; // a one-shot wake-up is not a branch anyone navigates to
        const owner = ownerOf(job);
        // The same visibility rule every route and tool applies — own personal plus admin-visible
        // instance jobs — read from ONE helper rather than re-derived here.
        if (!canAddressJob({ userId: requesterUserId, admin: requesterIsAdmin === true }, job)) continue;
        const assoc = jobAssociation(job);
        if (assoc.state !== 'linked' || !authorized.has(assoc.target.id)) continue;
        // WHERE THE JOB RUNS, beside where it is filed, so a reader following the row lands in the
        // transcript its runs produced instead of the schedule's editor. The same rule the scheduler
        // routes by, read from the one place that decides it. A job bound to a DIRECT platform chat is
        // deliberately silent here: its turns run in that room, which is not a conversation this listing
        // may hand out, and core would refuse it anyway. Core re-checks whatever is named.
        const location = jobRunLocation(job, owner);
        links.push({
          jobId: job.id,
          conversationId: assoc.target.id,
          name: typeof job.name === 'string' ? job.name : '',
          enabled: job.enabled !== false,
          ownerUserId: owner,
          ...(location.kind === 'dedicated' ? { runSessionId: location.sessionId } : {}),
          ...(location.kind === 'channel' ? { runChannelId: location.channelId } : {}),
        });
      }
      return links;
    },
  });

  adapter = new CronAdapter(store, deliveryStore, journal, ctx.logger, ctx.notify, ctx.config, () => ctx.timezone(), ownerIsAdmin, ownerMaySchedule, {
    authorize: async (job) => {
      const project = executionRef(job.projectRef);
      if (project.kind === 'host') {
        const stores = ctx.host.stores();
        const record = stores.projects.get(project.projectId);
        if (!record || (record.executionKind ?? 'host') !== 'host') throw new Error('host project execution target changed');
        const owner = job.ownerUserId ?? null;
        if (owner !== null && !stores.usersRead.isAdmin(owner) && !stores.userProjects.canAccess(owner, project.projectId)) throw new Error('project access revoked');
        return;
      }
      if (!Number.isSafeInteger(job.ownerUserId) || job.ownerUserId <= 0) throw new Error('managed project schedule requires an account');
      const provider = ctx.control('sandbox');
      if (!provider) throw new Error('project environment unavailable');
      await provider.environmentFor({ project, accountUserId: job.ownerUserId });
    },
    check: (job, timeoutMs, signal) => projectCheck(ctx, job, timeoutMs, undefined, signal),
  }, ctx.alerts);
  // Both of these settle rows in `p_cronjob_runs`, which lives in the DAEMON's database — and a forked
  // sub-agent runner loads this plugin too, in its own process, against that same database. Reconciling
  // there does not repair anything: it reads a run the daemon is still executing and closes it as
  // interrupted, so a job that worked is reported as failed and nothing distinguishes that from a real
  // failure. Only the process a run could have outlived may declare it dead.
  if (ctx.authoritativeProcess) {
    journal.reconcile({ nowMs: Date.now(), tickMs: adapter.tickMs });
    journal.prune(Date.now());
  }
  ctx.registerPlatform(adapter);
  // The skill that teaches the model to USE those tools ships with them, the way the task domain's
  // does. Kept in the skills plugin it would keep describing CronAdd on an instance where this plugin
  // is not installed and nothing answers — and a model that believes a missing tool should be there
  // works around its absence instead of stopping.
  const skillsDir = join(dirname(fileURLToPath(import.meta.url)), 'skills');
  for (const skill of loadSkillsFromDir({ dir: skillsDir, source: 'elowen-plugin:cronjob' }).skills) {
    ctx.registerSkill(skill);
  }

  ctx.logger.info('cron tools + scheduler registered');
}
