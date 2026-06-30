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
  const many = latest.winners.length > 1;
  const items = latest.winners
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
  return `<div class="card">
    <div class="headline">${many ? "🏆 Co-winners" : "🏆 Latest winner"} · ${prettyDate(latest.contest_date)}</div>
    ${items}
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
    return;
  }
  const card = el(`<div class="card">
    <div class="banner vote">🗳️ Voting is open — until 12:50pm</div>
    <div class="headline">Pick the best photo</div>
    <p class="sub">Anonymous. Tap a photo to vote — you can change it until 12:50pm. Winner at 1:00pm.</p>
    <div class="grid"></div>
  </div>`);
  const grid = card.querySelector(".grid");
  let selected = s.yourVote || null;

  ballot.forEach((b) => {
    const tile = el(`<div class="tile ${b.isOwn ? "own" : ""} ${selected === b.id ? "selected" : ""}" data-id="${b.id}">
      ${b.image_url ? `<img src="${b.image_url}" alt="">` : ""}
      <div class="check">✓</div>
      ${b.isOwn ? `<div class="tag">Your photo</div>` : b.caption ? `<div class="tag">${esc(b.caption)}</div>` : ""}
    </div>`);
    if (!b.isOwn) {
      tile.addEventListener("click", async () => {
        const prev = selected;
        grid.querySelectorAll(".tile").forEach((t) => t.classList.remove("selected"));
        tile.classList.add("selected");
        selected = b.id;
        try {
          await api("vote", { submission_id: b.id });
          toast("Vote saved ✅");
        } catch (e) {
          toast(e.message);
          tile.classList.remove("selected");
          if (prev) grid.querySelector(`.tile[data-id="${prev}"]`)?.classList.add("selected");
          selected = prev;
        }
      });
    }
    grid.appendChild(tile);
  });
  app.appendChild(card);
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
  if (COMPETITIONS.length < 2) return;
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

// --- tabs -------------------------------------------------------------------
document.querySelector(".tabs").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-tab]");
  if (!btn) return;
  document.querySelectorAll(".tabs button").forEach((b) => b.classList.remove("active"));
  btn.classList.add("active");
  CURRENT_TAB = btn.dataset.tab;
  if (CURRENT_TAB === "hof") renderHallOfFame();
  else load();
});

load();
