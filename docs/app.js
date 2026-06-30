"use strict";

const API = `${CONFIG.SUPABASE_URL}/functions/v1/api`;
const app = document.getElementById("app");
const whoEl = document.getElementById("who");

// --- token: from ?t= (persist) or localStorage -----------------------------
function getToken() {
  const u = new URL(location.href);
  const t = u.searchParams.get("t");
  if (t) {
    localStorage.setItem("bpotd_token", t);
    u.searchParams.delete("t");
    history.replaceState({}, "", u.pathname + u.search + u.hash); // hide token from address bar
    return t;
  }
  return localStorage.getItem("bpotd_token");
}
const TOKEN = getToken();

// --- competition state ------------------------------------------------------
let COMP = localStorage.getItem("bpotd_comp") || "photo";
let COMPETITIONS = [];
let CURRENT_TAB = "home";

// --- api --------------------------------------------------------------------
async function api(action, extra = {}) {
  const res = await fetch(API, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      apikey: CONFIG.ANON_KEY,
      Authorization: `Bearer ${CONFIG.ANON_KEY}`,
    },
    body: JSON.stringify({ action, token: TOKEN, comp: COMP, ...extra }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
  return data;
}

// --- helpers ----------------------------------------------------------------
function el(html) {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}
function esc(s) {
  return (s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}
let toastTimer;
function toast(msg) {
  let t = document.querySelector(".toast");
  if (!t) {
    t = el(`<div class="toast"></div>`);
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 2600);
}
function prettyDate(d) {
  const dt = new Date(d + "T00:00:00");
  return dt.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
}
// Show points with halves as ½ (e.g. 0.5 -> "½", 1.5 -> "1½", 2 -> "2").
function fmtPoints(n) {
  const whole = Math.floor(n);
  if (n - whole >= 0.5) return whole > 0 ? `${whole}½` : "½";
  return String(whole);
}
// "Who's voted" panel (names only — never reveals choices).
function votersHTML(voted, pending) {
  const total = voted.length + pending.length;
  return `<div class="headline">🗳️ Who's voted — ${voted.length}/${total}</div>
    <p class="sub"><b>Voted:</b> ${voted.length ? voted.map(esc).join(", ") : "—"}</p>
    ${
      pending.length
        ? `<p class="sub"><b>Still to vote:</b> ${pending.map(esc).join(", ")}</p>`
        : `<p class="sub">🎉 Everyone has voted!</p>`
    }`;
}

// Resize a chosen image to <=1600px longest edge, JPEG ~0.8, return data URL.
function resizeImage(file, maxEdge = 1600, quality = 0.8) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();
    reader.onload = () => (img.src = reader.result);
    reader.onerror = reject;
    img.onerror = () => reject(new Error("Could not read that image."));
    img.onload = () => {
      const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      canvas.getContext("2d").drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL("image/jpeg", quality));
    };
    reader.readAsDataURL(file);
  });
}

// --- screens ----------------------------------------------------------------
function latestResultCard(latest) {
  if (!latest || !latest.winners || latest.winners.length === 0) return "";
  const winners = latest.winners.filter((w) => w.isWinner);
  const allSubmissions = latest.winners;
  const many = winners.length > 1;
  const winnerItems = winners
    .map(
      (w) => `
      <div class="winner">
        ${w.image_url ? `<img src="${w.image_url}" alt="">` : ""}
        <div class="meta">
          <div class="name"><span class="crown">👑</span> ${esc(w.name)}</div>
          ${w.caption ? `<div class="muted">${esc(w.caption)}</div>` : ""}
          <div class="votes">${w.votes} vote${w.votes === 1 ? "" : "s"}</div>
        </div>
      </div>`,
    )
    .join("");
  const otherItems = allSubmissions
    .filter((w) => !w.isWinner)
    .map(
      (w) => `
      <div class="result-row">
        ${w.image_url ? `<img src="${w.image_url}" alt="">` : ""}
        <div class="result-meta">
          <div class="result-name">${esc(w.name)}</div>
          ${w.caption ? `<div class="result-caption">${esc(w.caption)}</div>` : ""}
        </div>
        <div class="result-votes">${w.votes}</div>
      </div>`,
    )
    .join("");
  return `<div class="card">
    <div class="headline">${many ? "🏆 Co-winners" : "🏆 Winner"} · ${prettyDate(latest.contest_date)}</div>
    ${winnerItems}
    ${otherItems ? `<div class="headline" style="margin-top: 16px; font-size: 0.95rem; font-weight: 600;">Other votes</div>${otherItems}` : ""}
  </div>`;
}

function renderSubmit(s) {
  app.innerHTML = "";
  const has = s.yourSubmission;
  const card = el(`<div class="card">
    <div class="banner submit">📸 Submissions are open — until 11:00am</div>
    <div class="headline">${has ? "Your photo is in!" : "Submit your photo"}</div>
    <p class="sub">${has ? "You can replace it any time before 11:00am." : "One photo per person. You can change it until 11:00am."}</p>
    ${has && has.image_url ? `<img class="preview" src="${has.image_url}" alt="your photo">` : `<div id="prevWrap"></div>`}
    <label class="label-btn" for="file">${has ? "📷 Choose a different photo" : "📷 Choose a photo"}</label>
    <input type="file" id="file" accept="image/*">
    <textarea id="cap" rows="2" placeholder="Optional caption">${has ? esc(has.caption || "") : ""}</textarea>
    <div style="height:10px"></div>
    <button id="send" disabled>${has ? "Replace photo" : "Submit photo"}</button>
    <p class="sub center" style="margin-top:10px">${s.submissionCount || 0} ${
    (s.submissionCount || 0) === 1 ? "photo" : "photos"
  } in so far</p>
  </div>`);
  app.appendChild(card);
  app.insertAdjacentHTML("beforeend", latestResultCard(s.latestResult));

  const file = card.querySelector("#file");
  const send = card.querySelector("#send");
  const cap = card.querySelector("#cap");
  let dataUrl = null;

  file.addEventListener("change", async () => {
    if (!file.files[0]) return;
    send.disabled = true;
    send.textContent = "Preparing…";
    try {
      dataUrl = await resizeImage(file.files[0]);
      let prev = card.querySelector(".preview");
      if (!prev) {
        prev = el(`<img class="preview" alt="preview">`);
        (card.querySelector("#prevWrap") || card.querySelector(".label-btn")).before(prev);
      }
      prev.src = dataUrl;
      send.disabled = false;
      send.textContent = has ? "Replace photo" : "Submit photo";
    } catch (e) {
      toast(e.message);
      send.textContent = has ? "Replace photo" : "Submit photo";
    }
  });

  send.addEventListener("click", async () => {
    if (!dataUrl) return;
    send.disabled = true;
    send.textContent = "Uploading…";
    try {
      await api("submit", { image: dataUrl, caption: cap.value });
      toast("Photo submitted! 🎉");
      load();
    } catch (e) {
      toast(e.message);
      send.disabled = false;
      send.textContent = has ? "Replace photo" : "Submit photo";
    }
  });
}

function renderVote(s) {
  app.innerHTML = "";
  const ballot = s.ballot || [];
  if (s.votableCount === 0) {
    app.appendChild(
      el(`<div class="card center">
        <div class="banner vote">🗳️ Voting is open — until 12:50pm</div>
        <p class="sub">There are no other photos to vote for today.</p>
      </div>`),
    );
    app.insertAdjacentHTML("beforeend", latestResultCard(s.latestResult));
    if (s.voters) {
      const pc = el(`<div class="card"></div>`);
      pc.innerHTML = votersHTML(s.voters.voted, s.voters.pending);
      app.appendChild(pc);
    }
    return;
  }
  const card = el(`<div class="card">
    <div class="banner vote">🗳️ Voting is open — until 12:50pm</div>
    <div class="headline">Pick the best</div>
    <p class="sub" id="votestatus"></p>
    <div class="grid"></div>
  </div>`);
  const grid = card.querySelector(".grid");
  const status = card.querySelector("#votestatus");
  let selected = s.yourVote || null;
  const meName = s.you && s.you.name;
  let voted = s.voters ? s.voters.voted.slice() : [];
  let pending = s.voters ? s.voters.pending.slice() : [];
  const partCard = el(`<div class="card"></div>`);
  function renderPart() {
    partCard.innerHTML = votersHTML(voted, pending);
  }
  function markMeVoted() {
    if (meName && pending.includes(meName)) {
      pending = pending.filter((n) => n !== meName);
      voted = [...voted, meName].sort();
      renderPart();
    }
  }

  // Update markers/labels without re-fetching, so the chosen photo never jumps or vanishes.
  function refresh() {
    grid.classList.toggle("voted", !!selected);
    grid.querySelectorAll(".tile").forEach((t) => {
      const sel = t.dataset.id === selected;
      const own = t.dataset.own === "1";
      t.classList.toggle("selected", sel);
      const tag = t.querySelector(".tag");
      if (sel) tag.textContent = "✓ Your vote";
      else if (own) tag.textContent = "Your photo";
      else tag.textContent = t.dataset.caption || "";
      tag.style.display = sel || own || t.dataset.caption ? "block" : "none";
    });
    status.textContent = selected
      ? "✓ You voted for the highlighted photo. Tap another to change it (until 12:50pm)."
      : "Anonymous — tap a photo to vote. You can change it until 12:50pm. Winner at 1:00pm.";
  }

  ballot.forEach((b) => {
    const tile = el(`<div class="tile ${b.isOwn ? "own" : ""}" data-id="${b.id}" data-own="${
      b.isOwn ? "1" : "0"
    }" data-caption="${esc(b.caption || "")}">
      ${b.image_url ? `<img src="${b.image_url}" alt="">` : ""}
      <div class="check">✓</div>
      <div class="tag"></div>
    </div>`);
    if (!b.isOwn) {
      tile.addEventListener("click", async () => {
        const prev = selected;
        selected = b.id;
        refresh();
        try {
          await api("vote", { submission_id: b.id });
          toast("Vote saved ✅");
          markMeVoted();
        } catch (e) {
          toast(e.message);
          selected = prev;
          refresh();
        }
      });
    }
    grid.appendChild(tile);
  });
  app.appendChild(card);
  refresh();
  renderPart();
  app.appendChild(partCard);
}

function renderWaiting(title, msg, s) {
  app.innerHTML = "";
  app.appendChild(
    el(`<div class="card center">
      <div class="banner wait">⏳ ${esc(title)}</div>
      <p class="sub">${esc(msg)}</p>
    </div>`),
  );
  if (s) app.insertAdjacentHTML("beforeend", latestResultCard(s.latestResult));
}

function renderResults(s) {
  app.innerHTML = "";
  const r = s.latestResult;
  if (!r || !r.winners || r.winners.length === 0) {
    app.appendChild(
      el(`<div class="card center">
        <div class="headline">No winner yet</div>
        <p class="sub">Come back at 2:00pm to submit a photo for the next round.</p>
      </div>`),
    );
    return;
  }
  app.insertAdjacentHTML("beforeend", latestResultCard(r));
  app.appendChild(
    el(`<div class="card center">
      <p class="sub">Next round opens at 2:00pm. Tap 🏆 Hall of Fame to see past winners.</p>
    </div>`),
  );
}

async function renderHallOfFame() {
  updateHeader();
  renderSwitch();
  app.innerHTML = `<div class="card loading">Loading…</div>`;
  try {
    const { days } = await api("hall_of_fame");
    app.innerHTML = "";
    if (!days || days.length === 0) {
      app.appendChild(el(`<div class="card center"><p class="sub">No winners recorded yet.</p></div>`));
      return;
    }
    days.forEach((d) => {
      if (!d.winners.length) return;
      const card = el(`<div class="card">
        <div class="date-h">${prettyDate(d.contest_date)}${d.winners.length > 1 ? " · co-winners" : ""}</div>
        ${d.winners
          .map(
            (w) => `<div class="winner">
              ${w.image_url ? `<img src="${w.image_url}" alt="">` : ""}
              <div class="meta">
                <div class="name"><span class="crown">👑</span> ${esc(w.name)}</div>
                ${w.caption ? `<div class="muted">${esc(w.caption)}</div>` : ""}
                <div class="votes">${w.votes} vote${w.votes === 1 ? "" : "s"}</div>
              </div>
            </div>`,
          )
          .join("")}
      </div>`);
      app.appendChild(card);
    });
  } catch (e) {
    app.innerHTML = `<div class="card center"><p class="sub">${esc(e.message)}</p></div>`;
  }
}

// --- competition switcher ---------------------------------------------------
function updateHeader() {
  const c = COMPETITIONS.find((x) => x.slug === COMP);
  const h = document.querySelector("header h1");
  if (c && h) h.textContent = `${c.emoji} ${c.name}`;
}
function renderSwitch() {
  const host = document.getElementById("compswitch");
  if (!host) return;
  host.innerHTML = "";
  if (COMPETITIONS.length < 2 || CURRENT_TAB === "board" || CURRENT_TAB === "admin") return;
  COMPETITIONS.forEach((c) => {
    const b = el(`<button class="${c.slug === COMP ? "active" : ""}">${c.emoji} ${esc(c.name)}</button>`);
    b.addEventListener("click", () => {
      if (c.slug === COMP) return;
      COMP = c.slug;
      localStorage.setItem("bpotd_comp", COMP);
      updateHeader();
      renderSwitch();
      if (CURRENT_TAB === "hof") renderHallOfFame();
      else load();
    });
    host.appendChild(b);
  });
}

// --- main load --------------------------------------------------------------
async function load() {
  if (!TOKEN) {
    app.innerHTML = `<div class="card center">
      <div class="headline">Welcome 👋</div>
      <p class="sub">Open your personal link to join. Ask the organiser for yours if you don't have it.</p>
    </div>`;
    whoEl.textContent = "";
    return;
  }
  app.innerHTML = `<div class="card loading">Loading…</div>`;
  try {
    const s = await api("state");
    if (s.competitions) COMPETITIONS = s.competitions;
    if (s.comp) {
      COMP = s.comp;
      localStorage.setItem("bpotd_comp", COMP);
    }
    const adminTab = document.getElementById("adminTab");
    if (adminTab) adminTab.hidden = !(s.you && s.you.is_admin);
    updateHeader();
    renderSwitch();
    whoEl.textContent = s.you ? `Hi, ${s.you.name}` : "";
    if (s.phase === "submit") renderSubmit(s);
    else if (s.phase === "vote") renderVote(s);
    else if (s.phase === "tallying") renderWaiting("Counting votes", "Results at 1:00pm.", s);
    else renderResults(s);
  } catch (e) {
    app.innerHTML = `<div class="card center"><p class="sub">${esc(e.message)}</p></div>`;
  }
}

// --- leaderboard ------------------------------------------------------------
async function renderLeaderboard() {
  const h = document.querySelector("header h1");
  if (h) h.textContent = "🏅 Leaderboard";
  renderSwitch();
  app.innerHTML = `<div class="card loading">Loading…</div>`;
  try {
    const { leaderboard, competitions } = await api("leaderboard");
    app.innerHTML = "";
    if (!leaderboard || leaderboard.length === 0) {
      app.appendChild(el(`<div class="card center"><p class="sub">No wins recorded yet.</p></div>`));
      return;
    }
    const card = el(`<div class="card">
      <div class="headline">🏅 All-time wins</div>
      <p class="sub">Outright win = 1 point · shared (co-)win = ½ point each.</p>
    </div>`);
    leaderboard.forEach((r, i) => {
      const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}.`;
      const parts = competitions
        .map((c) => (r.byComp[c.slug] ? `${c.emoji} ${fmtPoints(r.byComp[c.slug])}` : null))
        .filter(Boolean)
        .join("  ");
      card.appendChild(
        el(`<div class="lb-row">
          <span class="lb-rank">${medal}</span>
          <span class="lb-name">${esc(r.name)}</span>
          <span class="lb-sub">${parts}</span>
          <span class="lb-wins">${fmtPoints(r.wins)}</span>
        </div>`),
      );
    });
    app.appendChild(card);
  } catch (e) {
    app.innerHTML = `<div class="card center"><p class="sub">${esc(e.message)}</p></div>`;
  }
}

// --- admin (organiser only) -------------------------------------------------
async function renderAdmin() {
  const h = document.querySelector("header h1");
  if (h) h.textContent = "⚙️ Organiser";
  renderSwitch();
  app.innerHTML = `<div class="card loading">Loading…</div>`;
  let data;
  try {
    data = await api("admin_overview");
  } catch (e) {
    app.innerHTML = `<div class="card center"><p class="sub">${esc(e.message)}</p></div>`;
    return;
  }
  app.innerHTML = "";

  data.competitions.forEach((c) => {
    const card = el(`<div class="card">
      <div class="headline">${c.emoji} ${esc(c.name)} — ${c.count} ${c.count === 1 ? "entry" : "entries"}</div>
      <p class="sub">${prettyDate(data.date)}</p>
    </div>`);
    if (c.entries.length === 0) card.appendChild(el(`<p class="sub">No entries yet.</p>`));
    c.entries.forEach((en) => {
      const row = el(`<div class="adm-row">
        ${en.image_url ? `<img src="${en.image_url}" alt="">` : `<div class="adm-noimg"></div>`}
        <div class="adm-meta"><div class="name">${esc(en.name)}</div>${
        en.caption ? `<div class="muted">${esc(en.caption)}</div>` : ""
      }</div>
        <button class="sm danger">Remove</button>
      </div>`);
      row.querySelector("button").addEventListener("click", async () => {
        if (!confirm(`Remove ${en.name}'s entry?`)) return;
        try {
          await api("admin_remove_submission", { submission_id: en.submission_id });
          toast("Entry removed");
          renderAdmin();
        } catch (e) {
          toast(e.message);
        }
      });
      card.appendChild(row);
    });
    app.appendChild(card);
  });

  const origin = location.origin + location.pathname;
  const people = el(`<div class="card">
    <div class="headline">👪 People (${data.players.length})</div>
    <div class="adm-add"><input id="newname" placeholder="Add a person — their name"><button id="addbtn">Add</button></div>
  </div>`);
  data.players.forEach((pl) => {
    const link = `${origin}?t=${pl.token}`;
    const row = el(`<div class="adm-row">
      <div class="adm-meta">
        <div class="name">${esc(pl.name)} ${pl.is_admin ? "⚙️" : ""} ${
      pl.active ? "" : '<span class="muted">(inactive)</span>'
    }</div>
        <div class="muted link-line">${esc(link)}</div>
      </div>
      <button class="sm copy">Copy</button>
      <button class="sm toggle ${pl.active ? "danger" : ""}">${pl.active ? "Remove" : "Restore"}</button>
    </div>`);
    row.querySelector(".copy").addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(link);
        toast("Link copied");
      } catch {
        toast("Long-press the link to copy");
      }
    });
    const tg = row.querySelector(".toggle");
    if (pl.is_admin && pl.active) tg.disabled = true;
    tg.addEventListener("click", async () => {
      try {
        await api("admin_set_active", { player_id: pl.id, active: !pl.active });
        toast("Updated");
        renderAdmin();
      } catch (e) {
        toast(e.message);
      }
    });
    people.appendChild(row);
  });
  people.querySelector("#addbtn").addEventListener("click", async () => {
    const name = people.querySelector("#newname").value.trim();
    if (!name) return;
    try {
      const res = await api("admin_add_player", { name });
      toast(`Added ${res.player.name}`);
      renderAdmin();
    } catch (e) {
      toast(e.message);
    }
  });
  app.appendChild(people);
}

// --- tabs -------------------------------------------------------------------
document.querySelector(".tabs").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-tab]");
  if (!btn) return;
  document.querySelectorAll(".tabs button").forEach((b) => b.classList.remove("active"));
  btn.classList.add("active");
  CURRENT_TAB = btn.dataset.tab;
  if (CURRENT_TAB === "hof") renderHallOfFame();
  else if (CURRENT_TAB === "board") renderLeaderboard();
  else if (CURRENT_TAB === "admin") renderAdmin();
  else load();
});

load();
