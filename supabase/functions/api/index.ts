// Best Photo of the Day — single API edge function.
// Auth model: each request carries the caller's personal secret `token`.
// We validate it server-side and use the service-role client (bypasses RLS),
// so anonymity is correct-by-construction: names are never returned before results.
//
// Deploy with JWT verification OFF (we do our own token auth): verify_jwt = false
//
// Actions (POST JSON { action, token, ... }):
//   state         -> who am I + current phase + relevant data (ballot / your submission / latest result)
//   submit        -> upload/replace today's photo (image = base64 data URL)
//   vote          -> cast/replace your vote for the current voting contest
//   hall_of_fame  -> past winners with images

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BUCKET = "photos";
const SIGNED_URL_TTL = 60 * 60 * 6; // 6 hours

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

// ---------------------------------------------------------------------------
// Time / phase logic — all in SAST (UTC+2, fixed, no DST).
// A contest is keyed by its VOTING DAY (`contest_date`).
// ---------------------------------------------------------------------------
const SUBMIT_OPEN = 14 * 60; //  2:00pm (the day before contest_date)
const SUBMIT_CLOSE = 11 * 60; // 11:00am (on contest_date)
const VOTE_OPEN = 11 * 60 + 5; // 11:05am
const VOTE_CLOSE = 12 * 60 + 50; // 12:50pm
const RESULTS_AT = 13 * 60; //  1:00pm

function sastParts(now = new Date()) {
  const s = new Date(now.getTime() + 2 * 60 * 60 * 1000); // UTC fields now read as SAST
  const dateStr = `${s.getUTCFullYear()}-${String(s.getUTCMonth() + 1).padStart(2, "0")}-${String(
    s.getUTCDate(),
  ).padStart(2, "0")}`;
  return { dateStr, minutes: s.getUTCHours() * 60 + s.getUTCMinutes() };
}

function addDays(dateStr: string, delta: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + delta);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(
    dt.getUTCDate(),
  ).padStart(2, "0")}`;
}

function phaseInfo(now = new Date()) {
  const { dateStr: today, minutes } = sastParts(now);

  // Active submission contest: opens (C-1) 14:00, closes C 11:00.
  let submitDate: string | null = null;
  if (minutes >= SUBMIT_OPEN) submitDate = addDays(today, 1); // afternoon -> tomorrow's contest
  else if (minutes < SUBMIT_CLOSE) submitDate = today; // morning of contest day

  // Active voting contest: C 11:05 .. 12:50, where C = today.
  const voteDate = minutes >= VOTE_OPEN && minutes < VOTE_CLOSE ? today : null;

  // Brief tally gaps on contest day: 11:00-11:05 and 12:50-13:00.
  const tallying =
    (minutes >= SUBMIT_CLOSE && minutes < VOTE_OPEN) ||
    (minutes >= VOTE_CLOSE && minutes < RESULTS_AT);

  // Most recently completed contest (results since C 13:00).
  const resultsDate = minutes >= RESULTS_AT ? today : addDays(today, -1);

  let primary: "vote" | "submit" | "tallying" | "results";
  if (voteDate) primary = "vote";
  else if (submitDate) primary = "submit";
  else if (tallying) primary = "tallying";
  else primary = "results";

  return { today, minutes, submitDate, voteDate, tallying, resultsDate, primary };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "content-type": "application/json" },
  });
}

async function playerFromToken(token: string) {
  if (!token) return null;
  const { data } = await db
    .from("players")
    .select("id, name, active")
    .eq("token", token)
    .maybeSingle();
  if (!data || !data.active) return null;
  return data as { id: string; name: string; active: boolean };
}

async function signed(path: string | null): Promise<string | null> {
  if (!path) return null;
  const { data } = await db.storage.from(BUCKET).createSignedUrl(path, SIGNED_URL_TTL);
  return data?.signedUrl ?? null;
}

function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

async function resultsFor(contest_date: string) {
  await db.rpc("finalize_contest", { p_date: contest_date }); // idempotent
  const { data: wins } = await db
    .from("winners")
    .select("player_id, photo_path, caption, vote_count, is_cowinner")
    .eq("contest_date", contest_date);
  if (!wins || wins.length === 0) return { contest_date, winners: [] };
  const winners = await Promise.all(
    wins.map(async (w) => {
      const { data: mem } = w.player_id
        ? await db.from("players").select("name").eq("id", w.player_id).maybeSingle()
        : { data: null };
      return {
        name: mem?.name ?? "Unknown",
        caption: w.caption,
        votes: w.vote_count,
        cowinner: w.is_cowinner,
        image_url: await signed(w.photo_path),
      };
    }),
  );
  return { contest_date, winners };
}

// ---------------------------------------------------------------------------
// Action handlers
// ---------------------------------------------------------------------------
async function handleState(player: { id: string; name: string }) {
  const p = phaseInfo();
  const out: Record<string, unknown> = {
    you: { name: player.name },
    phase: p.primary,
    times: { submit: "2:00pm", close: "11:00am", vote: "11:05am", winner: "1:00pm" },
  };

  if (p.primary === "submit" && p.submitDate) {
    out.contest_date = p.submitDate;
    const { data: mine } = await db
      .from("submissions")
      .select("caption, photo_path, updated_at")
      .eq("contest_date", p.submitDate)
      .eq("player_id", player.id)
      .maybeSingle();
    if (mine) {
      out.yourSubmission = {
        caption: mine.caption,
        updated_at: mine.updated_at,
        image_url: await signed(mine.photo_path),
      };
    }
    const { count } = await db
      .from("submissions")
      .select("id", { count: "exact", head: true })
      .eq("contest_date", p.submitDate);
    out.submissionCount = count ?? 0;
  }

  if (p.primary === "vote" && p.voteDate) {
    out.contest_date = p.voteDate;
    const { data: subs } = await db
      .from("submissions")
      .select("id, caption, photo_path, player_id")
      .eq("contest_date", p.voteDate);
    const { data: myVote } = await db
      .from("votes")
      .select("submission_id")
      .eq("contest_date", p.voteDate)
      .eq("voter_player_id", player.id)
      .maybeSingle();
    out.yourVote = myVote?.submission_id ?? null;
    const ballot = await Promise.all(
      (subs ?? []).map(async (s) => ({
        id: s.id,
        caption: s.caption,
        isOwn: s.player_id === player.id, // client disables your own; reveals nothing about others
        image_url: await signed(s.photo_path),
      })),
    );
    out.ballot = shuffle(ballot);
    out.votableCount = ballot.filter((b) => !b.isOwn).length;
  }

  // Always include the latest finalized result for context.
  out.latestResult = await resultsFor(p.resultsDate);
  return json(out);
}

async function handleSubmit(player: { id: string }, body: any) {
  const p = phaseInfo();
  if (!p.submitDate) return json({ error: "Submissions are closed right now." }, 409);
  const dataUrl: string = body.image ?? "";
  const m = dataUrl.match(/^data:(image\/\w+);base64,(.+)$/s);
  if (!m) return json({ error: "Invalid image." }, 400);
  const bytes = Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0));
  if (bytes.length > 6 * 1024 * 1024) return json({ error: "Image too large (max ~6MB)." }, 413);

  const path = `${p.submitDate}/${player.id}.jpg`;
  const up = await db.storage
    .from(BUCKET)
    .upload(path, bytes, { contentType: "image/jpeg", upsert: true });
  if (up.error) return json({ error: up.error.message }, 500);

  const caption = (body.caption ?? "").toString().slice(0, 200);
  const { error } = await db.from("submissions").upsert(
    {
      contest_date: p.submitDate,
      player_id: player.id,
      photo_path: path,
      caption,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "contest_date,player_id" },
  );
  if (error) return json({ error: error.message }, 500);
  return json({ ok: true, image_url: await signed(path) });
}

async function handleVote(player: { id: string }, body: any) {
  const p = phaseInfo();
  if (!p.voteDate) return json({ error: "Voting is not open right now." }, 409);
  const submission_id: string = body.submission_id;
  if (!submission_id) return json({ error: "Pick a photo." }, 400);

  const { data: sub } = await db
    .from("submissions")
    .select("id, player_id")
    .eq("id", submission_id)
    .eq("contest_date", p.voteDate)
    .maybeSingle();
  if (!sub) return json({ error: "That photo isn't in today's competition." }, 400);
  if (sub.player_id === player.id) return json({ error: "You can't vote for your own photo." }, 403);

  const { error } = await db.from("votes").upsert(
    { contest_date: p.voteDate, voter_player_id: player.id, submission_id },
    { onConflict: "contest_date,voter_player_id" },
  );
  if (error) return json({ error: error.message }, 500);
  return json({ ok: true, yourVote: submission_id });
}

async function handleHallOfFame() {
  const { data: wins } = await db
    .from("winners")
    .select("contest_date")
    .order("contest_date", { ascending: false })
    .limit(120);
  const dates = [...new Set((wins ?? []).map((w) => w.contest_date))];
  const days = await Promise.all(dates.map((d) => resultsFor(d)));
  return json({ days });
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  if (body.action === "hall_of_fame") return handleHallOfFame();

  const player = await playerFromToken(body.token);
  if (!player) return json({ error: "Unknown or inactive link." }, 401);

  switch (body.action) {
    case "state":
      return handleState(player);
    case "submit":
      return handleSubmit(player, body);
    case "vote":
      return handleVote(player, body);
    default:
      return json({ error: "Unknown action" }, 400);
  }
});
