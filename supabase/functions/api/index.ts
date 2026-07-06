// Best Photo / Best Tail End — single API edge function (multi-competition + admin).
// Auth: each request carries the caller's personal secret `token` (validated server-side).
// Most actions also carry `comp` (competition slug); defaults to "photo".
// Admin actions (admin_*) additionally require the caller's player.is_admin = true.
// Uses the service-role client so anonymity is correct-by-construction.
// Deploy with verify_jwt = false (own token auth).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BUCKET = "photos";
const SIGNED_URL_TTL = 60 * 60 * 6;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const SUBMIT_OPEN = 14 * 60;
const SUBMIT_CLOSE = 11 * 60 + 30;
const VOTE_OPEN = 11 * 60 + 35;
const VOTE_CLOSE = 12 * 60 + 55;
const RESULTS_AT = 13 * 60;

function sastParts(now = new Date()) {
  const s = new Date(now.getTime() + 2 * 60 * 60 * 1000);
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
  let submitDate: string | null = null;
  if (minutes >= SUBMIT_OPEN) submitDate = addDays(today, 1);
  else if (minutes < SUBMIT_CLOSE) submitDate = today;
  const voteDate = minutes >= VOTE_OPEN && minutes < VOTE_CLOSE ? today : null;
  const tallying =
    (minutes >= SUBMIT_CLOSE && minutes < VOTE_OPEN) ||
    (minutes >= VOTE_CLOSE && minutes < RESULTS_AT);
  const resultsDate = minutes >= RESULTS_AT ? today : addDays(today, -1);
  let primary: "vote" | "submit" | "tallying" | "results";
  if (voteDate) primary = "vote";
  else if (submitDate) primary = "submit";
  else if (tallying) primary = "tallying";
  else primary = "results";
  return { today, minutes, submitDate, voteDate, tallying, resultsDate, primary };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "content-type": "application/json" },
  });
}

function hex(n: number) {
  const a = new Uint8Array(n);
  crypto.getRandomValues(a);
  return [...a].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function getCompetitions() {
  const { data } = await db
    .from("competitions")
    .select("slug, name, emoji")
    .eq("active", true)
    .order("sort", { ascending: true });
  return data ?? [];
}

async function resolveComp(raw: unknown, comps: { slug: string }[]) {
  const want = typeof raw === "string" ? raw : "";
  if (comps.some((c) => c.slug === want)) return want;
  return comps[0]?.slug ?? "photo";
}

async function getSeasons() {
  const { data } = await db
    .from("hof_seasons")
    .select("id, label, starts_on, ends_on")
    .order("sort", { ascending: true });
  return data ?? [];
}

// Pick the requested season if valid, else whichever season's date range covers
// "today", else the last (most recent) season.
function resolveSeason(
  raw: unknown,
  seasons: { id: number; starts_on: string; ends_on: string | null }[],
  today: string,
): number | null {
  const wantId = typeof raw === "number" ? raw : typeof raw === "string" && raw !== "" ? Number(raw) : NaN;
  if (!Number.isNaN(wantId) && seasons.some((s) => s.id === wantId)) return wantId;
  const current = seasons.find((s) => s.starts_on <= today && (!s.ends_on || today <= s.ends_on));
  if (current) return current.id;
  return seasons.length ? seasons[seasons.length - 1].id : null;
}

async function playerFromToken(token: string) {
  if (!token) return null;
  const { data } = await db
    .from("players")
    .select("id, name, active, is_admin")
    .eq("token", token)
    .maybeSingle();
  if (!data || !data.active) return null;
  return data as { id: string; name: string; active: boolean; is_admin: boolean };
}

async function signed(path: string | null): Promise<string | null> {
  if (!path) return null;
  if (/^https?:\/\//.test(path)) return path;
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

async function resultsFor(comp: string, contest_date: string) {
  await db.rpc("finalize_contest", { p_comp: comp, p_date: contest_date });

  // Get all submissions
  const { data: subs } = await db
    .from("submissions")
    .select("id, player_id, photo_path, caption")
    .eq("competition", comp)
    .eq("contest_date", contest_date);

  // Get all winners (including manually-added hall of fame entries)
  const { data: allWinners } = await db
    .from("winners")
    .select("player_id, photo_path, caption, vote_count")
    .eq("competition", comp)
    .eq("contest_date", contest_date);

  // If no submissions and no winners, return empty
  if ((!subs || subs.length === 0) && (!allWinners || allWinners.length === 0)) {
    return { contest_date, winners: [] };
  }

  // Get vote counts for submissions
  const { data: voteCounts } = await db
    .from("votes")
    .select("submission_id")
    .eq("competition", comp)
    .eq("contest_date", contest_date);

  const voteCountMap = new Map<string, number>();
  (voteCounts ?? []).forEach((v: any) => {
    voteCountMap.set(v.submission_id, (voteCountMap.get(v.submission_id) ?? 0) + 1);
  });

  const winnerPlayerIds = new Set((allWinners ?? []).map((w: any) => w.player_id));
  const submissionPlayerIds = new Set((subs ?? []).map((s: any) => s.player_id));

  // Build results from submissions
  const results = await Promise.all(
    (subs ?? []).map(async (s) => {
      const { data: mem } = s.player_id
        ? await db.from("players").select("name").eq("id", s.player_id).maybeSingle()
        : { data: null };
      return {
        name: mem?.name ?? "Unknown",
        caption: s.caption,
        votes: voteCountMap.get(s.id) ?? 0,
        isWinner: winnerPlayerIds.has(s.player_id),
        image_url: await signed(s.photo_path),
      };
    }),
  );

  // Add winners that don't have submissions (manually-added hall of fame entries)
  const manualWinners = await Promise.all(
    (allWinners ?? [])
      .filter((w: any) => !submissionPlayerIds.has(w.player_id))
      .map(async (w: any) => {
        const { data: mem } = w.player_id
          ? await db.from("players").select("name").eq("id", w.player_id).maybeSingle()
          : { data: null };
        return {
          name: mem?.name ?? "Unknown",
          caption: w.caption,
          votes: w.vote_count,
          isWinner: true,
          image_url: await signed(w.photo_path),
        };
      }),
  );

  results.push(...manualWinners);

  // Sort: winners first (by votes desc), then others (by votes desc, then name)
  results.sort((a, b) => {
    if (a.isWinner !== b.isWinner) return a.isWinner ? -1 : 1;
    if (b.votes !== a.votes) return b.votes - a.votes;
    return a.name.localeCompare(b.name);
  });

  return { contest_date, winners: results };
}

async function handleState(
  player: { id: string; name: string; is_admin: boolean },
  comp: string,
  comps: unknown[],
) {
  const p = phaseInfo();
  const out: Record<string, unknown> = {
    you: { name: player.name, is_admin: player.is_admin },
    competitions: comps,
    comp,
    phase: p.primary,
    times: { submit: "2:00pm", close: "11:30am", vote: "11:35am", winner: "1:00pm" },
  };

  if (p.primary === "submit" && p.submitDate) {
    out.contest_date = p.submitDate;
    const { data: mine } = await db
      .from("submissions")
      .select("caption, photo_path, updated_at")
      .eq("competition", comp)
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
      .eq("competition", comp)
      .eq("contest_date", p.submitDate);
    out.submissionCount = count ?? 0;
  }

  if (p.primary === "vote" && p.voteDate) {
    out.contest_date = p.voteDate;
    const { data: subs } = await db
      .from("submissions")
      .select("id, caption, photo_path, player_id")
      .eq("competition", comp)
      .eq("contest_date", p.voteDate);
    const { data: myVote } = await db
      .from("votes")
      .select("submission_id")
      .eq("competition", comp)
      .eq("contest_date", p.voteDate)
      .eq("voter_player_id", player.id)
      .maybeSingle();
    out.yourVote = myVote?.submission_id ?? null;
    const ballot = await Promise.all(
      (subs ?? []).map(async (s) => ({
        id: s.id,
        caption: s.caption,
        isOwn: s.player_id === player.id,
        image_url: await signed(s.photo_path),
      })),
    );
    out.ballot = shuffle(ballot);
    out.votableCount = ballot.filter((b) => !b.isOwn).length;

    // Who has voted (names only — never reveals choices). Visible to everyone.
    const { data: activePlayers } = await db.from("players").select("id, name").eq("active", true);
    const { data: voteRows } = await db
      .from("votes")
      .select("voter_player_id")
      .eq("competition", comp)
      .eq("contest_date", p.voteDate);
    const votedIds = new Set((voteRows ?? []).map((v) => v.voter_player_id));
    const voted = (activePlayers ?? []).filter((pl) => votedIds.has(pl.id)).map((pl) => pl.name).sort();
    const pending = (activePlayers ?? []).filter((pl) => !votedIds.has(pl.id)).map((pl) => pl.name).sort();
    out.voters = { voted, pending };
  }

  out.latestResult = await resultsFor(comp, p.resultsDate);
  return json(out);
}

async function handleSubmit(player: { id: string }, comp: string, body: any) {
  const p = phaseInfo();
  if (!p.submitDate) return json({ error: "Submissions are closed right now." }, 409);
  const dataUrl: string = body.image ?? "";
  const m = dataUrl.match(/^data:(image\/\w+);base64,(.+)$/s);
  if (!m) return json({ error: "Invalid image." }, 400);
  const bytes = Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0));
  if (bytes.length > 6 * 1024 * 1024) return json({ error: "Image too large (max ~6MB)." }, 413);
  const path = `${comp}/${p.submitDate}/${player.id}.jpg`;
  const up = await db.storage
    .from(BUCKET)
    .upload(path, bytes, { contentType: "image/jpeg", upsert: true });
  if (up.error) return json({ error: up.error.message }, 500);
  const caption = (body.caption ?? "").toString().slice(0, 200);
  const { error } = await db.from("submissions").upsert(
    {
      competition: comp,
      contest_date: p.submitDate,
      player_id: player.id,
      photo_path: path,
      caption,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "competition,contest_date,player_id" },
  );
  if (error) return json({ error: error.message }, 500);
  return json({ ok: true, image_url: await signed(path) });
}

async function handleVote(player: { id: string }, comp: string, body: any) {
  const p = phaseInfo();
  if (!p.voteDate) return json({ error: "Voting is not open right now." }, 409);
  const submission_id: string = body.submission_id;
  if (!submission_id) return json({ error: "Pick a photo." }, 400);
  const { data: sub } = await db
    .from("submissions")
    .select("id, player_id")
    .eq("id", submission_id)
    .eq("competition", comp)
    .eq("contest_date", p.voteDate)
    .maybeSingle();
  if (!sub) return json({ error: "That photo isn't in today's competition." }, 400);
  if (sub.player_id === player.id) return json({ error: "You can't vote for your own photo." }, 403);
  const { error } = await db.from("votes").upsert(
    { competition: comp, contest_date: p.voteDate, voter_player_id: player.id, submission_id },
    { onConflict: "competition,contest_date,voter_player_id" },
  );
  if (error) return json({ error: error.message }, 500);
  return json({ ok: true, yourVote: submission_id });
}

async function handleHallOfFame(comp: string, body: any) {
  const p = phaseInfo();
  // The winners row for "today" is finalized by cron at 12:55, but isn't announced
  // until 1:00pm — hide it from Hall of Fame until then.
  const hideDate = p.minutes < RESULTS_AT ? p.today : null;

  const seasons = await getSeasons();
  const seasonId = resolveSeason(body.season, seasons, p.today);
  const season = seasons.find((s) => s.id === seasonId) ?? null;

  const { data: wins } = await db
    .from("winners")
    .select("contest_date")
    .eq("competition", comp)
    .order("contest_date", { ascending: false })
    .limit(400);
  let dates = [...new Set((wins ?? []).map((w) => w.contest_date))].filter((d) => d !== hideDate);
  if (season) {
    dates = dates.filter((d) => d >= season.starts_on && (!season.ends_on || d <= season.ends_on));
  }
  const days = await Promise.all(dates.map((d) => resultsFor(comp, d)));
  return json({ comp, seasons, season: seasonId, days });
}

// Every submitted photo (winners and non-winners), for a permanent archive.
async function handleAllPhotos(comp: string) {
  const p = phaseInfo();
  const hideDate = p.minutes < RESULTS_AT ? p.today : null;
  const { data: subs } = await db
    .from("submissions")
    .select("contest_date")
    .eq("competition", comp)
    .order("contest_date", { ascending: false });
  const dates = [...new Set((subs ?? []).map((s) => s.contest_date))].filter((d) => d !== hideDate);
  const days = await Promise.all(dates.map((d) => resultsFor(comp, d)));
  return json({ comp, days });
}

// Most wins within a Hall of Fame season (each winner row counts; co-wins count for each).
// Also tallies total votes received per person within that season (wins and non-wins),
// as a popularity stat.
async function handleLeaderboard(body: any) {
  const comps = await getCompetitions();
  const p = phaseInfo();
  // Same 1:00pm embargo as Hall of Fame — don't count today's result until it's announced.
  const hideDate = p.minutes < RESULTS_AT ? p.today : null;

  const seasons = await getSeasons();
  const seasonId = resolveSeason(body.season, seasons, p.today);
  const season = seasons.find((s) => s.id === seasonId) ?? null;
  const inSeason = (d: string) => !season || (d >= season.starts_on && (!season.ends_on || d <= season.ends_on));

  const { data: wins } = await db
    .from("winners")
    .select("player_id, competition, is_cowinner, contest_date");
  const { data: allVotes } = await db.from("votes").select("submission_id, competition, contest_date");
  const { data: allSubs } = await db.from("submissions").select("id, player_id");
  const { data: players } = await db.from("players").select("id, name");

  const nameById = new Map((players ?? []).map((p) => [p.id, p.name]));
  const ownerBySubmission = new Map((allSubs ?? []).map((s) => [s.id, s.player_id]));

  type Row = { wins: number; byComp: Record<string, number>; totalVotes: number; votesByComp: Record<string, number> };
  const agg = new Map<string, Row>();
  function ensure(id: string): Row {
    let a = agg.get(id);
    if (!a) {
      a = { wins: 0, byComp: {}, totalVotes: 0, votesByComp: {} };
      agg.set(id, a);
    }
    return a;
  }

  for (const w of wins ?? []) {
    if (!w.player_id) continue;
    if (hideDate && w.contest_date === hideDate) continue;
    if (!inSeason(w.contest_date)) continue;
    const pts = w.is_cowinner ? 0.5 : 1; // co-wins are worth half a point each
    const a = ensure(w.player_id);
    a.wins += pts;
    a.byComp[w.competition] = (a.byComp[w.competition] ?? 0) + pts;
  }

  for (const v of allVotes ?? []) {
    if (hideDate && v.contest_date === hideDate) continue;
    if (!inSeason(v.contest_date)) continue;
    const ownerId = ownerBySubmission.get(v.submission_id);
    if (!ownerId) continue;
    const a = ensure(ownerId);
    a.totalVotes += 1;
    a.votesByComp[v.competition] = (a.votesByComp[v.competition] ?? 0) + 1;
  }

  const rows = [...agg.entries()]
    .map(([id, a]) => ({
      name: nameById.get(id) ?? "Unknown",
      wins: a.wins,
      byComp: a.byComp,
      totalVotes: a.totalVotes,
      votesByComp: a.votesByComp,
    }))
    .sort((x, y) => y.wins - x.wins || y.totalVotes - x.totalVotes || x.name.localeCompare(y.name));
  return json({ leaderboard: rows, competitions: comps, seasons, season: seasonId });
}

// ----- Admin (caller is verified is_admin before these run) -----------------
async function handleAdminOverview(player: { id: string }) {
  const comps = await getCompetitions();
  const p = phaseInfo();
  const date = p.submitDate ?? p.voteDate ?? p.resultsDate;
  const phase = p.primary;
  const competitions = await Promise.all(
    comps.map(async (c) => {
      const { data: subs } = await db
        .from("submissions")
        .select("id, caption, photo_path, player_id, updated_at")
        .eq("competition", c.slug)
        .eq("contest_date", date);
      const entries = await Promise.all(
        (subs ?? []).map(async (sb) => {
          const { data: mem } = await db
            .from("players")
            .select("name")
            .eq("id", sb.player_id)
            .maybeSingle();
          return {
            submission_id: sb.id,
            name: mem?.name ?? "Unknown",
            caption: sb.caption,
            image_url: await signed(sb.photo_path),
          };
        }),
      );
      entries.sort((a, b) => a.name.localeCompare(b.name));
      return { slug: c.slug, name: c.name, emoji: c.emoji, count: entries.length, entries };
    }),
  );
  const { data: players } = await db
    .from("players")
    .select("id, name, token, active, is_admin")
    .order("name");
  return json({ date, phase, competitions, players, self_id: player.id });
}

async function handleAdminRemoveSubmission(body: any) {
  const id: string = body.submission_id;
  if (!id) return json({ error: "submission_id required" }, 400);
  const { data: sb } = await db.from("submissions").select("id, photo_path").eq("id", id).maybeSingle();
  if (!sb) return json({ error: "Submission not found." }, 404);
  if (sb.photo_path && !/^https?:\/\//.test(sb.photo_path)) {
    await db.storage.from(BUCKET).remove([sb.photo_path]);
  }
  const { error } = await db.from("submissions").delete().eq("id", id); // votes cascade
  if (error) return json({ error: error.message }, 500);
  return json({ ok: true });
}

async function handleAdminAddPlayer(body: any) {
  const name = (body.name ?? "").toString().trim().slice(0, 40);
  if (!name) return json({ error: "Name required." }, 400);
  const { data, error } = await db
    .from("players")
    .insert({ name, token: hex(12) })
    .select("id, name, token, active, is_admin")
    .maybeSingle();
  if (error) return json({ error: error.message }, 500);
  return json({ ok: true, player: data });
}

async function handleAdminSetActive(player: { id: string }, body: any) {
  const id: string = body.player_id;
  const active = !!body.active;
  if (!id) return json({ error: "player_id required" }, 400);
  if (id === player.id && !active) return json({ error: "You can't deactivate yourself." }, 400);
  const { error } = await db.from("players").update({ active }).eq("id", id);
  if (error) return json({ error: error.message }, 500);
  return json({ ok: true });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const comps = await getCompetitions();
  const comp = await resolveComp(body.comp, comps);

  // Public (no token) actions.
  if (body.action === "hall_of_fame") return handleHallOfFame(comp, body);
  if (body.action === "leaderboard") return handleLeaderboard(body);

  const player = await playerFromToken(body.token);
  if (!player) return json({ error: "Unknown or inactive link." }, 401);

  // Admin-only actions.
  if (typeof body.action === "string" && body.action.startsWith("admin_")) {
    if (!player.is_admin) return json({ error: "Not allowed." }, 403);
    switch (body.action) {
      case "admin_overview":
        return handleAdminOverview(player);
      case "admin_remove_submission":
        return handleAdminRemoveSubmission(body);
      case "admin_add_player":
        return handleAdminAddPlayer(body);
      case "admin_set_active":
        return handleAdminSetActive(player, body);
      default:
        return json({ error: "Unknown admin action" }, 400);
    }
  }

  switch (body.action) {
    case "state":
      return handleState(player, comp, comps);
    case "submit":
      return handleSubmit(player, comp, body);
    case "vote":
      return handleVote(player, comp, body);
    case "all_photos":
      return handleAllPhotos(comp);
    default:
      return json({ error: "Unknown action" }, 400);
  }
});
