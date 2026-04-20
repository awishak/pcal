// ============================================================
// LiveSection.jsx
// PCAL Live Scoring - single-file React module.
// Drop this file alongside pcal-database.jsx and import the
// default export (LiveSection) from your main App.
// ============================================================
//
// Integration (brief, see integrate_notes.md for full steps):
//
//   import LiveSection from "./LiveSection.jsx";
//
//   // In NAV_ITEMS add:
//   { key: "live", label: "Live",
//     icon: "M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" }
//
//   // In the main render block, alongside other {tab === "..."} renders:
//   {tab === "live" && <LiveSection />}
//
// This file imports { supabase } from "./supabase.js" - your existing
// Supabase client. No new client file needed.
//
// ============================================================

import React, { useEffect, useMemo, useState, useCallback, useRef, createContext, useContext } from "react";
import { supabase } from "./supabase.js";

// Context carries the base64 team logo map from App.jsx down to
// components that need to render logos. Falls back to null (colored
// circle fallback) if LiveSection was instantiated without a logos prop.
const LogosContext = createContext(null);
const useLogos = () => useContext(LogosContext);

// ------------------------------------------------------------
// Team names/colors: match main app TEAM_BADGE_COLORS
// ------------------------------------------------------------
const TEAM_NAMES = {
  CIS: "Christ in Sports", CON: "Concord", HAY: "Hayward", MCS: "Modesto+CIS",
  MOD: "Modesto", PDF: "Pacific", PLE: "Pleasanton", SAC: "Sacramento",
  SJK: "Knights", SJO: "San Jose", SRA: "San Ramon",
};

const TEAM_COLORS = {
  SAC: "#7c3aed",
  PDF: "#0d9488",
  MOD: "#dc2626",
  SJO: "#7f1d1d",
  HAY: "#2563eb",
  PLE: "#facc15",
  CON: "#065f46",
  SRA: "#b91c1c",
  CIS: "#16a34a",
  SJK: "#eab308",
  NOR: "#065f46",
  MCS: "#9333ea",
};

// Text color that reads well on top of TEAM_COLORS[team] background
const TEAM_TEXT_ON_BG = {
  PLE: "#000000",
};
const textOnTeam = (team) => TEAM_TEXT_ON_BG[team] || "#ffffff";

// Small team badge. If logos are provided via context (passed from App.jsx
// which has the base64 logo strings), renders the real logo. Otherwise
// falls back to a colored circle with the team code.
function TeamLogoLocal({ team, size = 24, className = "" }) {
  const logos = useLogos();
  const logo = logos ? logos[team] : null;
  if (logo) {
    return (
      <img
        src={logo}
        alt={team}
        style={{ width: size, height: size, objectFit: "contain" }}
        className={`flex-shrink-0 ${className}`}
      />
    );
  }
  const bg = TEAM_COLORS[team] || "#6b7280";
  const fg = textOnTeam(team);
  return (
    <div
      className={`rounded-full flex items-center justify-center flex-shrink-0 ${className}`}
      style={{ width: size, height: size, backgroundColor: bg }}
    >
      <span style={{ fontSize: Math.max(7, size * 0.38), color: fg }} className="font-black">
        {team}
      </span>
    </div>
  );
}

const CURRENT_SEASON = 2026;

// ------------------------------------------------------------
// Stat type definitions: all events we can enter during a game.
// Grid is 3x3, row-major. Row 1: makes (green). Row 2: misses (red).
// Row 3: steal/block/foul (gray).
// ------------------------------------------------------------
const STAT_BUTTONS = [
  { key: "made_2",   label: "Made 2",   pts: 2, prompt: "assist",  color: "bg-green-500 text-white", activeRing: "ring-green-300" },
  { key: "made_3",   label: "Made 3",   pts: 3, prompt: "assist",  color: "bg-green-500 text-white", activeRing: "ring-green-300" },
  { key: "made_ft",  label: "Made FT",  pts: 1, prompt: null,      color: "bg-green-500 text-white", activeRing: "ring-green-300" },
  { key: "missed_2", label: "Miss 2",   pts: 0, prompt: "rebound", color: "bg-red-500 text-white",   activeRing: "ring-red-300" },
  { key: "missed_3", label: "Miss 3",   pts: 0, prompt: "rebound", color: "bg-red-500 text-white",   activeRing: "ring-red-300" },
  { key: "missed_ft",label: "Miss FT",  pts: 0, prompt: "rebound", color: "bg-red-500 text-white",   activeRing: "ring-red-300" },
  { key: "stl",      label: "Steal",    pts: 0, prompt: null,      color: "bg-gray-100 text-gray-700", activeRing: "ring-gray-300" },
  { key: "blk",      label: "Block",    pts: 0, prompt: null,      color: "bg-gray-100 text-gray-700", activeRing: "ring-gray-300" },
  { key: "foul",     label: "Foul",     pts: 0, prompt: null,      color: "bg-gray-100 text-gray-700", activeRing: "ring-gray-300" },
];

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------
function formatName(raw) {
  if (!raw) return "";
  const parts = raw.trim().split(/\s+/);
  if (parts.length < 2) return raw;
  const cap = s => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
  return parts.slice(1).map(cap).join(" ") + " " + cap(parts[0]);
}

function formatTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  let h = d.getHours();
  const m = d.getMinutes();
  const ap = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${String(m).padStart(2, "0")} ${ap}`;
}

// Format a YYYY-MM-DD date into "Sunday, April 19, 2026"
function formatGameDate(ymd) {
  if (!ymd) return "";
  const d = new Date(ymd + "T12:00:00");
  if (isNaN(d.getTime())) return ymd;
  return d.toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric", year: "numeric",
  });
}

// Format an HH:MM or HH:MM:SS time into "3:00 PM"
function formatGameTime(hms) {
  if (!hms) return "";
  const parts = hms.split(":");
  let h = parseInt(parts[0], 10);
  const m = parts[1] || "00";
  const ap = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${m} ${ap}`;
}

function within96Hours(date, time) {
  const gameTs = new Date(`${date}T${time}`).getTime();
  const now = Date.now();
  const delta = Math.abs(gameTs - now);
  return delta <= 96 * 3600 * 1000;
}

function pinKey(pin) { return "pcal_pin_" + pin; }

// Compute live stats from event list
function computeBoxScore(events) {
  const box = {}; // player_name -> {team, pts, reb, ast, stl, blk, fgm, fga, tpm, tpa, ftm, fta, foul}
  const teamScore = {};
  const teamFoulsThisHalf = {};
  const teamTimeoutsThisHalf = {}; // { H1: { TEAM: count }, H2: { TEAM: count }, OT1: ... }
  let currentHalf = "H1";

  const ensure = (p, team) => {
    if (!box[p]) box[p] = { team, pts:0, reb:0, ast:0, stl:0, blk:0, fgm:0, fga:0, tpm:0, tpa:0, ftm:0, fta:0, foul:0 };
  };
  const ensureTeam = (t) => {
    if (teamScore[t] == null) teamScore[t] = 0;
  };

  for (const e of events) {
    if (e.deleted) continue;
    const t = e.team;
    const p = e.player_name;
    if (e.stat_type === "period_change") {
      // e.player_name holds new period label
      if (e.player_name === "H2" || e.player_name === "Halftime") currentHalf = "H2";
      else if (e.player_name === "H1") currentHalf = "H1";
      // OT counts as its own "half" for team-foul and timeout reset
      if (e.player_name && e.player_name.startsWith("OT")) {
        currentHalf = e.player_name;
        teamFoulsThisHalf[currentHalf] = {};
        teamTimeoutsThisHalf[currentHalf] = {};
      }
      continue;
    }
    if (e.stat_type === "timeout") {
      if (!t) continue;
      if (!teamTimeoutsThisHalf[currentHalf]) teamTimeoutsThisHalf[currentHalf] = {};
      teamTimeoutsThisHalf[currentHalf][t] = (teamTimeoutsThisHalf[currentHalf][t] || 0) + 1;
      continue;
    }
    if (!t || !p) continue;
    ensure(p, t);
    ensureTeam(t);

    switch (e.stat_type) {
      case "made_2":
        box[p].pts += 2; box[p].fgm += 1; box[p].fga += 1; teamScore[t] += 2; break;
      case "missed_2":
        box[p].fga += 1; break;
      case "made_3":
        box[p].pts += 3; box[p].fgm += 1; box[p].fga += 1; box[p].tpm += 1; box[p].tpa += 1; teamScore[t] += 3; break;
      case "missed_3":
        box[p].fga += 1; box[p].tpa += 1; break;
      case "made_ft":
        box[p].pts += 1; box[p].ftm += 1; box[p].fta += 1; teamScore[t] += 1; break;
      case "missed_ft":
        box[p].fta += 1; break;
      case "reb":
        box[p].reb += 1; break;
      case "ast":
        box[p].ast += 1; break;
      case "stl":
        box[p].stl += 1; break;
      case "blk":
        box[p].blk += 1; break;
      case "foul":
        box[p].foul += 1;
        if (!teamFoulsThisHalf[currentHalf]) teamFoulsThisHalf[currentHalf] = {};
        teamFoulsThisHalf[currentHalf][t] = (teamFoulsThisHalf[currentHalf][t] || 0) + 1;
        break;
      default: break;
    }
  }

  return { box, teamScore, teamFoulsThisHalf, teamTimeoutsThisHalf, currentHalf };
}

// Map a stat_type to the box-score field name used in computeBoxScore.
// Used when showing per-player counts in the player-picker.
const STAT_TO_BOX_FIELD = {
  made_2: "fgm",
  made_3: "tpm",
  made_ft: "ftm",
  missed_2: "fga",   // misses shown against attempts
  missed_3: "tpa",
  missed_ft: "fta",
  reb: "reb",
  stl: "stl",
  blk: "blk",
  foul: "foul",
  ast: "ast",
};

// For a given stat key, what count should be shown for a player?
// Rebounds show total rebounds; fouls show total fouls; makes show
// that specific make count; misses show misses (attempts - makes).
function statCountForPlayer(statKey, boxEntry) {
  if (!boxEntry) return 0;
  if (statKey === "missed_2") return (boxEntry.fga || 0) - (boxEntry.fgm || 0) - ((boxEntry.tpa || 0) - (boxEntry.tpm || 0));
  if (statKey === "missed_3") return (boxEntry.tpa || 0) - (boxEntry.tpm || 0);
  if (statKey === "missed_ft") return (boxEntry.fta || 0) - (boxEntry.ftm || 0);
  const field = STAT_TO_BOX_FIELD[statKey];
  return field ? (boxEntry[field] || 0) : 0;
}

// Given the events list and a player name, is that player currently on
// a hot streak of 3+ made shots in a row (no misses in between, not
// counting FTs)? Returns true/false. Use on the last shot event for a
// player to decide whether to show the fire icon.
function isOnHotStreak(events, playerName) {
  if (!playerName) return false;
  let streak = 0;
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.deleted) continue;
    if (e.player_name !== playerName) continue;
    // Ignore non-field-goal shots
    if (e.stat_type === "made_ft" || e.stat_type === "missed_ft") continue;
    if (e.stat_type === "made_2" || e.stat_type === "made_3") {
      streak += 1;
      if (streak >= 3) return true;
    } else if (e.stat_type === "missed_2" || e.stat_type === "missed_3") {
      return false;
    }
  }
  return streak >= 3;
}

// Last-name sort helper for roster arrays.
function byLastName(a, b) {
  return (a.player_name || "").localeCompare(b.player_name || "");
}

// Sort a roster for the player-picker: players who have recorded this
// stat come first (by last name), then a divider, then players who
// have not (by last name). Returns { withStat: [...], withoutStat: [...] }.
function partitionRosterByStat(roster, box, statKey) {
  const withStat = [];
  const withoutStat = [];
  for (const p of roster) {
    const count = statCountForPlayer(statKey, box[p.player_name]);
    if (count > 0) withStat.push(p);
    else withoutStat.push(p);
  }
  withStat.sort(byLastName);
  withoutStat.sort(byLastName);
  return { withStat, withoutStat };
}

// ------------------------------------------------------------
// Main Live Section
// ------------------------------------------------------------
export default function LiveSection({ initialGameId = null, onConsumeInitialGameId = () => {}, logos = null } = {}) {
  // Cached login from localStorage
  const [me, setMe] = useState(() => {
    try {
      const raw = localStorage.getItem("pcal_me");
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  });

  // View state: 'home' | 'game' | 'review'
  const [view, setView] = useState("home");
  const [activeGameId, setActiveGameId] = useState(null);

  // Consume initialGameId prop once on mount or when it changes to a new value
  const consumedGameIdRef = useRef(null);
  useEffect(() => {
    if (initialGameId && consumedGameIdRef.current !== initialGameId) {
      consumedGameIdRef.current = initialGameId;
      setActiveGameId(initialGameId);
      setView("game");
      onConsumeInitialGameId();
    }
  }, [initialGameId, onConsumeInitialGameId]);

  // Login
  const login = (player) => {
    const rec = { pin: player.player_pin, name: player.player_name, team: player.team, season: player.season };
    localStorage.setItem("pcal_me", JSON.stringify(rec));
    setMe(rec);
  };
  const logout = () => {
    localStorage.removeItem("pcal_me");
    setMe(null);
  };

  const openGame = (gameId) => {
    setActiveGameId(gameId);
    setView("game");
  };

  return (
    <LogosContext.Provider value={logos}>
      <div>
        {view === "home" && (
          <LiveHome me={me} onLogin={login} onLogout={logout} onOpenGame={openGame} onReview={() => setView("review")} />
        )}
        {view === "game" && activeGameId && (
          <LiveGameView gameId={activeGameId} me={me} onBack={() => { setView("home"); setActiveGameId(null); }} />
        )}
        {view === "review" && (
          <ReviewQueue onBack={() => setView("home")} onOpen={openGame} />
        )}
      </div>
    </LogosContext.Provider>
  );
}

// ============================================================
// Live Home: 96-hour window of games, login/logout
// ============================================================
function LiveHome({ me, onLogin, onLogout, onOpenGame, onReview }) {
  const [games, setGames] = useState([]);
  const [liveStates, setLiveStates] = useState({}); // game_id -> live_games row
  const [loading, setLoading] = useState(true);
  const [showLogin, setShowLogin] = useState(false);
  const [showAdmin, setShowAdmin] = useState(false);

  const loadGames = useCallback(async () => {
    setLoading(true);
    const { data: sched, error } = await supabase
      .from("schedule")
      .select("*")
      .eq("season", CURRENT_SEASON)
      .order("game_date", { ascending: true })
      .order("game_time", { ascending: true });

    if (error) {
      console.error(error);
      setGames([]); setLoading(false); return;
    }

    const nearby = (sched || []).filter(g => within96Hours(g.game_date, g.game_time));
    const ids = nearby.map(g => g.game_id);
    let live = {};
    if (ids.length) {
      const { data: lg } = await supabase
        .from("live_games")
        .select("*")
        .in("game_id", ids);
      (lg || []).forEach(row => { live[row.game_id] = row; });
    }
    setGames(nearby);
    setLiveStates(live);
    setLoading(false);
  }, []);

  useEffect(() => { loadGames(); }, [loadGames]);

  // Subscribe to live_games changes so statuses update in real time
  useEffect(() => {
    const channel = supabase
      .channel("live_home_games")
      .on("postgres_changes", { event: "*", schema: "public", table: "live_games" },
        (payload) => {
          setLiveStates(prev => {
            const next = { ...prev };
            const row = payload.new || payload.old;
            if (row) next[row.game_id] = payload.new || null;
            return next;
          });
        })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  const now = new Date();
  const upcoming = games.filter(g => new Date(`${g.game_date}T${g.game_time}`) >= now);
  const recent = games.filter(g => new Date(`${g.game_date}T${g.game_time}`) < now);

  return (
    <div>
      <p className="text-xs text-gray-400 uppercase tracking-widest font-medium mb-3">Live Scoring</p>

      {/* Identity bar */}
      <div className="mb-4 rounded-2xl border border-gray-100 bg-gray-50 p-3 flex items-center gap-3">
        {me ? (
          <>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-bold text-gray-900">{formatName(me.name)}</div>
              <div className="text-[11px] text-gray-500">{TEAM_NAMES[me.team] || me.team} &middot; PIN &middot;&middot;&middot;&middot;</div>
            </div>
            <button onClick={onLogout} className="text-[11px] font-bold text-gray-500 px-3 py-1.5 rounded-lg bg-white border border-gray-200 active:bg-gray-100">
              Log out
            </button>
          </>
        ) : (
          <>
            <div className="flex-1 text-sm text-gray-600">Not signed in</div>
            <button onClick={() => setShowLogin(true)} className="text-xs font-bold text-white px-3 py-1.5 rounded-lg bg-gray-900 active:bg-gray-800">
              Sign in with PIN
            </button>
          </>
        )}
      </div>

      {/* Admin review link */}
      <div className="mb-4 flex items-center justify-between">
        <div className="text-[11px] text-gray-500 font-semibold uppercase tracking-wide">Games &middot; 96-hour window</div>
        <button onClick={onReview} className="text-[11px] font-bold text-gray-500 px-2 py-1 rounded bg-gray-100 active:bg-gray-200">
          Admin review
        </button>
      </div>

      {loading && <div className="text-center py-8 text-gray-400 text-sm">Loading...</div>}

      {!loading && upcoming.length === 0 && recent.length === 0 && (
        <div className="rounded-2xl border border-gray-100 bg-gray-50 p-6 text-center">
          <div className="text-sm text-gray-500">No games within 96 hours.</div>
          <div className="text-[11px] text-gray-400 mt-1">Check back closer to game day.</div>
        </div>
      )}

      {upcoming.length > 0 && (
        <div className="mb-4">
          <div className="text-[11px] text-gray-500 font-semibold uppercase tracking-wide mb-2">Upcoming &amp; Live</div>
          <div className="space-y-2">
            {upcoming.map(g => (
              <GameRow key={g.game_id} g={g} live={liveStates[g.game_id]} onOpen={() => onOpenGame(g.game_id)} />
            ))}
          </div>
        </div>
      )}

      {recent.length > 0 && (
        <div>
          <div className="text-[11px] text-gray-500 font-semibold uppercase tracking-wide mb-2">Recent</div>
          <div className="space-y-2">
            {recent.map(g => (
              <GameRow key={g.game_id} g={g} live={liveStates[g.game_id]} onOpen={() => onOpenGame(g.game_id)} />
            ))}
          </div>
        </div>
      )}

      {showLogin && <LoginModal onClose={() => setShowLogin(false)} onLogin={(p) => { onLogin(p); setShowLogin(false); }} />}
      {showAdmin && <AdminPasswordModal onClose={() => setShowAdmin(false)} onOk={() => setShowAdmin(false)} />}
    </div>
  );
}

function GameRow({ g, live, onOpen }) {
  const status = live?.status || g.status;
  const statusLabel =
    status === "live" ? "LIVE" :
    status === "halftime" ? "HALF" :
    status === "ended" ? "FINAL" :
    status === "approved" ? "FINAL" :
    null;
  return (
    <button onClick={onOpen} className="w-full text-left rounded-2xl border border-gray-100 bg-white p-3 active:bg-gray-50 transition-colors">
      <div className="flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">Week {g.week}</span>
            <span className="text-[10px] text-gray-400">{g.game_date} &middot; {g.game_time.slice(0,5)}</span>
            {statusLabel && (
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${status === "live" ? "bg-red-100 text-red-700" : "bg-gray-100 text-gray-600"}`}>
                {statusLabel}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <TeamBadge team={g.away_team} />
            <span className="text-xs text-gray-400">at</span>
            <TeamBadge team={g.home_team} />
          </div>
          {g.location && <div className="text-[10px] text-gray-400 mt-1">{g.location}</div>}
        </div>
        <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </div>
    </button>
  );
}

function TeamBadge({ team }) {
  const color = TEAM_COLORS[team] || "#6b7280";
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="w-2 h-2 rounded-full" style={{ background: color }} />
      <span className="text-sm font-bold text-gray-900">{team}</span>
    </span>
  );
}

// ============================================================
// Login modal: pin entry
// ============================================================
function LoginModal({ onClose, onLogin }) {
  const [pin, setPin] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!pin.trim()) return;
    setBusy(true); setErr("");
    const { data, error } = await supabase
      .from("rosters")
      .select("*")
      .eq("season", CURRENT_SEASON)
      .eq("player_pin", pin.trim())
      .eq("active", true)
      .limit(1);
    setBusy(false);
    if (error) { setErr("Error: " + error.message); return; }
    if (!data || data.length === 0) { setErr("PIN not found. Check with your team."); return; }
    onLogin(data[0]);
  };

  return (
    <ModalShell onClose={onClose} title="Sign in with your PIN">
      <input
        type="tel"
        inputMode="numeric"
        autoFocus
        value={pin}
        onChange={e => setPin(e.target.value)}
        placeholder="4-digit PIN"
        className="w-full text-center text-2xl font-bold tracking-widest py-3 rounded-xl border border-gray-200 bg-gray-50 focus:outline-none focus:border-gray-900"
      />
      {err && <div className="text-xs text-red-600 mt-2">{err}</div>}
      <button onClick={submit} disabled={busy || !pin}
        className="w-full mt-3 py-3 rounded-xl bg-gray-900 text-white font-bold text-sm active:bg-gray-800 disabled:bg-gray-200 disabled:text-gray-400">
        {busy ? "Checking..." : "Sign in"}
      </button>
    </ModalShell>
  );
}

// ============================================================
// Admin password modal
// ============================================================
function AdminPasswordModal({ onClose, onOk, title = "Admin password required", subtitle }) {
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!pw) return;
    setBusy(true); setErr("");
    const { data, error } = await supabase
      .from("app_config")
      .select("config_value")
      .eq("config_key", "admin_password")
      .limit(1);
    setBusy(false);
    if (error) { setErr("Error: " + error.message); return; }
    if (!data || data.length === 0 || data[0].config_value !== pw) {
      setErr("Incorrect password."); return;
    }
    onOk();
  };

  return (
    <ModalShell onClose={onClose} title={title}>
      {subtitle && <div className="text-xs text-gray-500 mb-2">{subtitle}</div>}
      <input
        type="password"
        autoFocus
        value={pw}
        onChange={e => setPw(e.target.value)}
        placeholder="Admin password"
        className="w-full py-3 px-3 rounded-xl border border-gray-200 bg-gray-50 focus:outline-none focus:border-gray-900"
      />
      {err && <div className="text-xs text-red-600 mt-2">{err}</div>}
      <div className="flex gap-2 mt-3">
        <button onClick={onClose} className="flex-1 py-3 rounded-xl bg-gray-100 text-gray-700 font-bold text-sm active:bg-gray-200">
          Cancel
        </button>
        <button onClick={submit} disabled={busy || !pw}
          className="flex-1 py-3 rounded-xl bg-gray-900 text-white font-bold text-sm active:bg-gray-800 disabled:bg-gray-200 disabled:text-gray-400">
          {busy ? "..." : "Confirm"}
        </button>
      </div>
    </ModalShell>
  );
}

function ModalShell({ children, onClose, title }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40" onClick={onClose}>
      <div className="w-full max-w-sm bg-white rounded-t-3xl sm:rounded-3xl p-5" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-base font-bold text-gray-900">{title}</h3>
          <button onClick={onClose} className="text-gray-400 text-lg leading-none">&times;</button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ============================================================
// Live Game View: scoreboard + box score + play-by-play
// Scorer controls appear only for signed-in scorers
// ============================================================
function LiveGameView({ gameId, me, onBack }) {
  const [game, setGame] = useState(null);
  const [live, setLive] = useState(null);
  const [events, setEvents] = useState([]);
  const [rosters, setRosters] = useState({ home: [], away: [] });
  const [mode, setMode] = useState("score"); // score | box | log
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Load game + state + events + rosters
  const load = useCallback(async () => {
    setLoading(true); setError("");
    const [{ data: sch }, { data: lg }, { data: evs }] = await Promise.all([
      supabase.from("schedule").select("*").eq("game_id", gameId).single(),
      supabase.from("live_games").select("*").eq("game_id", gameId).maybeSingle(),
      supabase.from("live_events").select("*").eq("game_id", gameId).order("event_ts", { ascending: true }),
    ]);
    if (!sch) { setError("Game not found."); setLoading(false); return; }
    const { data: rosterRows } = await supabase
      .from("rosters")
      .select("*")
      .eq("season", sch.season)
      .in("team", [sch.home_team, sch.away_team])
      .eq("active", true)
      .order("player_name", { ascending: true });
    const home = (rosterRows || []).filter(r => r.team === sch.home_team);
    const away = (rosterRows || []).filter(r => r.team === sch.away_team);

    setGame(sch);
    setLive(lg);
    setEvents(evs || []);
    setRosters({ home, away });
    setLoading(false);
  }, [gameId]);

  useEffect(() => { load(); }, [load]);

  // Subscribe to live_games and live_events for this specific game
  useEffect(() => {
    const ch = supabase
      .channel(`live_game_${gameId}`)
      .on("postgres_changes",
        { event: "*", schema: "public", table: "live_games", filter: `game_id=eq.${gameId}` },
        (payload) => { setLive(payload.new || null); })
      .on("postgres_changes",
        { event: "*", schema: "public", table: "live_events", filter: `game_id=eq.${gameId}` },
        (payload) => {
          setEvents(prev => {
            if (payload.eventType === "INSERT") return [...prev, payload.new];
            if (payload.eventType === "UPDATE") return prev.map(e => e.event_id === payload.new.event_id ? payload.new : e);
            if (payload.eventType === "DELETE") return prev.filter(e => e.event_id !== payload.old.event_id);
            return prev;
          });
        })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [gameId]);

  const { box, teamScore, teamFoulsThisHalf, teamTimeoutsThisHalf, currentHalf } = useMemo(() => computeBoxScore(events), [events]);

  // Compute top scorer per team
  const topScorerByTeam = useMemo(() => {
    const out = {};
    for (const [player, s] of Object.entries(box)) {
      if (!out[s.team] || s.pts > out[s.team].pts) out[s.team] = { name: player, pts: s.pts };
    }
    return out;
  }, [box]);

  // Identify my role in this game: home_scorer | away_scorer | viewer
  const myRole = useMemo(() => {
    if (!me || !live) return "viewer";
    if (live.home_scorer_pin === me.pin) return "home_scorer";
    if (live.away_scorer_pin === me.pin) return "away_scorer";
    return "viewer";
  }, [me, live]);

  if (loading) return <div className="text-center py-12 text-gray-400 text-sm">Loading game...</div>;
  if (error) return (
    <div>
      <BackRow onBack={onBack} />
      <div className="text-center py-8 text-red-600 text-sm">{error}</div>
    </div>
  );
  if (!game) return null;

  return (
    <div>
      <BackRow onBack={onBack} />

      {/* Big date/time + matchup header */}
      <div className="mb-3 text-center">
        <div className="text-[11px] font-bold text-gray-400 uppercase tracking-widest mb-1">
          Week {game.week === 0 ? "Preseason" : game.week}{game.location ? ` \u00b7 ${game.location}` : ""}
        </div>
        <div className="text-xl font-black text-gray-900 leading-tight">
          {formatGameDate(game.game_date)}
        </div>
        <div className="text-lg font-bold text-gray-700 leading-tight mt-0.5">
          {formatGameTime(game.game_time)}
        </div>
      </div>

      {/* Game control bar (period + timeouts). Only shown to scorers
          and only on the Live Score Mode tab. Lives ABOVE the scoreboard
          so the scorer sees period/timeout actions without scrolling. */}
      {mode === "score" && (myRole === "home_scorer" || myRole === "away_scorer") && (
        <GameControlBar
          game={game}
          live={live}
          me={me}
          myRole={myRole}
          events={events}
          currentHalf={currentHalf}
          teamTimeoutsThisHalf={teamTimeoutsThisHalf}
          teamScore={teamScore}
        />
      )}

      {/* Scoreboard */}
      <Scoreboard
        game={game}
        live={live}
        teamScore={teamScore}
        teamFoulsThisHalf={teamFoulsThisHalf}
        teamTimeoutsThisHalf={teamTimeoutsThisHalf}
        currentHalf={currentHalf}
        topScorerByTeam={topScorerByTeam}
        events={events}
      />

      {/* Mode tabs */}
      <div className="flex gap-1.5 mb-3">
        {["score","box","log"].map(m => (
          <button key={m} onClick={() => setMode(m)}
            className={`flex-1 py-2 rounded-lg text-xs font-bold transition-colors ${mode === m ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-600"}`}>
            {m === "score" ? "Live Score Mode" : m === "box" ? "Box Score" : "Play-by-play"}
          </button>
        ))}
      </div>

      {mode === "score" && (
        <ScorerControls
          game={game}
          live={live}
          events={events}
          rosters={rosters}
          me={me}
          myRole={myRole}
          onReload={load}
          currentHalf={currentHalf}
          teamFoulsThisHalf={teamFoulsThisHalf}
          teamTimeoutsThisHalf={teamTimeoutsThisHalf}
          teamScore={teamScore}
          box={box}
        />
      )}
      {mode === "box" && <BoxScoreView game={game} box={box} rosters={rosters} />}
      {mode === "log" && <PlayByPlay events={events} me={me} myRole={myRole} game={game} />}
    </div>
  );
}

function BackRow({ onBack }) {
  return (
    <button onClick={onBack} className="mb-3 flex items-center gap-1 text-xs font-bold text-gray-500 active:text-gray-900">
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
      </svg>
      Back
    </button>
  );
}

// ============================================================
// Scoreboard (big top display)
// ============================================================
function Scoreboard({ game, live, teamScore, teamFoulsThisHalf, teamTimeoutsThisHalf, currentHalf, topScorerByTeam, events }) {
  const home = game.home_team;
  const away = game.away_team;
  const hs = teamScore[home] || 0;
  const as = teamScore[away] || 0;
  const homeColor = TEAM_COLORS[home] || "#111827";
  const awayColor = TEAM_COLORS[away] || "#111827";

  const homeFouls = teamFoulsThisHalf?.[currentHalf]?.[home] || 0;
  const awayFouls = teamFoulsThisHalf?.[currentHalf]?.[away] || 0;

  const [logExpanded, setLogExpanded] = useState(false);

  // Last event (any kind except game_end / reopen). Covers made/missed/reb/ast/
  // stl/blk/foul/timeout/period_change/game_start.
  const lastPlay = useMemo(() => {
    const EXCLUDE = new Set(["game_end", "reopen"]);
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i];
      if (e.deleted) continue;
      if (EXCLUDE.has(e.stat_type)) continue;
      return e;
    }
    return null;
  }, [events]);

  // Build last-10 plays with running team scores attached to each scoring event.
  // Includes period_change and game_start so the Last line can show them too.
  // Excludes game_end and reopen. Scoring events carry running_home/running_away
  // for the inline score tag.
  const last10 = useMemo(() => {
    const running = { [home]: 0, [away]: 0 };
    const out = [];
    const NOTABLE = new Set([
      "made_2","made_3","made_ft","missed_2","missed_3","missed_ft",
      "reb","reb_other_team","ast","stl","blk","foul","timeout",
      "period_change","game_start",
    ]);
    for (const e of events) {
      if (e.deleted) continue;
      if (e.team && e.stat_type === "made_2" && running[e.team] != null) running[e.team] += 2;
      if (e.team && e.stat_type === "made_3" && running[e.team] != null) running[e.team] += 3;
      if (e.team && e.stat_type === "made_ft" && running[e.team] != null) running[e.team] += 1;
      if (NOTABLE.has(e.stat_type)) {
        out.push({
          ...e,
          running_home: running[home],
          running_away: running[away],
        });
      }
    }
    return out.slice(-10).reverse();
  }, [events, home, away]);

  // Quarter-scores summary. Pulls score snapshots off period_change events
  // (the insert path writes snap_home/snap_away into score_snapshot, or we
  // fall back to the event's own running totals).
  const quarterScores = useMemo(() => {
    const running = { [home]: 0, [away]: 0 };
    const snapshots = []; // [{ label, home, away }]
    for (const e of events) {
      if (e.deleted) continue;
      if (e.team === home && e.stat_type === "made_2") running[home] += 2;
      if (e.team === home && e.stat_type === "made_3") running[home] += 3;
      if (e.team === home && e.stat_type === "made_ft") running[home] += 1;
      if (e.team === away && e.stat_type === "made_2") running[away] += 2;
      if (e.team === away && e.stat_type === "made_3") running[away] += 3;
      if (e.team === away && e.stat_type === "made_ft") running[away] += 1;
      if (e.stat_type === "period_change") {
        const label = e.player_name || "";
        // The event label is the NEW period (e.g. "H2" means H1 just ended).
        // Record the snapshot under the period that just ended.
        const endingLabel = label === "H2" ? "H1" :
          label?.startsWith("OT") && label !== "OT1" ? `OT${parseInt(label.slice(2)) - 1}` :
          label === "OT1" ? "H2" : label;
        if (endingLabel) {
          snapshots.push({ label: endingLabel, home: running[home], away: running[away] });
        }
      }
      if (e.stat_type === "game_end") {
        snapshots.push({ label: "Final", home: running[home], away: running[away] });
      }
    }
    return snapshots;
  }, [events, home, away]);

  // Halftime / 2nd-half banner text. If the most recent period_change was H2,
  // show "Halftime" for up to 5 minutes OR until a stat event has fired after
  // the period_change. After that, show "2nd half started N min ago".
  const halftimeBanner = useMemo(() => {
    const periodChanges = events
      .filter(e => !e.deleted && e.stat_type === "period_change" && e.player_name === "H2");
    if (periodChanges.length === 0) return null;
    const pc = periodChanges[periodChanges.length - 1];
    const pcTs = pc.event_ts ? new Date(pc.event_ts).getTime() : null;
    if (!pcTs) return null;
    // Was there a stat event after this period_change?
    const STAT_KINDS = new Set([
      "made_2","made_3","made_ft","missed_2","missed_3","missed_ft",
      "reb","reb_other_team","ast","stl","blk","foul",
    ]);
    const hasPlayAfter = events.some(e =>
      !e.deleted
      && STAT_KINDS.has(e.stat_type)
      && e.event_ts
      && new Date(e.event_ts).getTime() > pcTs
    );
    const ageMs = Date.now() - pcTs;
    const ageMin = Math.floor(ageMs / 60000);
    if (!hasPlayAfter && ageMin < 5) {
      return { kind: "halftime" };
    }
    return { kind: "h2_ago", minutes: Math.max(0, ageMin) };
  }, [events]);

  // Which player was on the mic for the last shot event? Used to attach a fire
  // icon to the last play if they're now on a 3-in-a-row hot streak (FG only).
  const lastPlayOnStreak = useMemo(() => {
    if (!lastPlay) return false;
    if (!["made_2","made_3"].includes(lastPlay.stat_type)) return false;
    return isOnHotStreak(events, lastPlay.player_name);
  }, [lastPlay, events]);

  return (
    <div className="rounded-2xl overflow-hidden mb-3 border border-gray-200 bg-white">
      <div className="p-4">
        <div className="flex items-center justify-between mb-3">
          {/* Halftime / H2 age banner on the left */}
          <div className="text-[10px] font-bold uppercase tracking-widest">
            {halftimeBanner?.kind === "halftime" && (
              <span className="text-gray-600">Halftime</span>
            )}
            {halftimeBanner?.kind === "h2_ago" && halftimeBanner.minutes > 0 && (
              <span className="text-gray-400 normal-case tracking-normal font-normal">
                2nd half started {halftimeBanner.minutes} min ago
              </span>
            )}
          </div>
          {/* Status on the right */}
          <div className="text-[10px] font-bold uppercase tracking-widest">
            {live?.status === "live" ? (
              <span className="inline-flex items-center gap-1 text-red-600">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
                </span>
                LIVE
              </span>
            ) :
             live?.status === "ended" ? <span className="text-gray-500">FINAL</span> :
             <span className="text-gray-400">SCHEDULED</span>}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {/* Away */}
          <TeamScorePanel team={away} score={as} color={awayColor}
            fouls={awayFouls} topScorer={topScorerByTeam[away]} />
          {/* Home */}
          <TeamScorePanel team={home} score={hs} color={homeColor}
            fouls={homeFouls} topScorer={topScorerByTeam[home]} />
        </div>

        {/* Quarter scores summary */}
        {quarterScores.length > 0 && (
          <div className="mt-3 pt-3 border-t border-gray-100 text-[11px] text-gray-500 text-center tabular-nums">
            {quarterScores.map((q, i) => (
              <span key={i}>
                {i > 0 && <span className="text-gray-300 mx-1.5">&middot;</span>}
                <span className="font-bold text-gray-400 uppercase tracking-wide">{q.label}</span>
                <span className="ml-1">{q.away}-{q.home}</span>
              </span>
            ))}
          </div>
        )}

        {/* Last play / tappable expand to last 10 */}
        {lastPlay && (
          <div className={`${quarterScores.length > 0 ? "mt-2 pt-2" : "mt-3 pt-3 border-t border-gray-100"}`}>
            <button
              onClick={() => setLogExpanded(v => !v)}
              className="w-full text-left text-[11px] text-gray-600 flex items-center justify-between active:opacity-60"
            >
              <span>
                <span className="text-gray-400 mr-1">Last:</span>
                {formatEventText(lastPlay)}
                {lastPlayOnStreak && (
                  <span className="ml-1.5 inline-block px-1.5 py-0.5 rounded text-[9px] font-black bg-orange-500 text-white tracking-wider align-middle">
                    HOT
                  </span>
                )}
              </span>
              <span className="text-gray-400 text-[10px] ml-2">{logExpanded ? "\u25B4 hide" : "\u25BE last 10"}</span>
            </button>
            {logExpanded && (
              <div className="mt-2 flex flex-col gap-1">
                {last10.length === 0 ? (
                  <div className="text-[11px] text-gray-400 text-center py-2">No plays yet.</div>
                ) : (
                  last10.map((e) => {
                    const isAway = e.team === away;
                    const isScoring = ["made_2","made_3","made_ft"].includes(e.stat_type);
                    const isPeriodOrStart = e.stat_type === "period_change" || e.stat_type === "game_start";
                    const scoreTag = isScoring
                      ? ` \u00b7 ${away} ${e.running_away} - ${e.running_home} ${home}`
                      : "";
                    const showFire = ["made_2","made_3"].includes(e.stat_type)
                      && isOnHotStreakAtIndex(events, e);
                    return (
                      <div
                        key={e.event_id || Math.random()}
                        className={`text-[11px] ${isPeriodOrStart ? "text-center text-gray-400 font-semibold" : isAway ? "text-right" : "text-left"}`}
                      >
                        <span className={`${isScoring ? "font-bold text-gray-900" : "text-gray-700"}`}>
                          {formatEventText(e)}
                          {showFire && (
                            <span className="ml-1.5 inline-block px-1.5 py-0.5 rounded text-[9px] font-black bg-orange-500 text-white tracking-wider align-middle">
                              HOT
                            </span>
                          )}
                        </span>
                        {isScoring && (
                          <span className="text-gray-400">{scoreTag}</span>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// For play-by-play fire icon: was this event part of a 3-in-a-row (FGs only)
// for the shooter at the time it was made? Walks back from this event in the
// non-deleted event stream and counts the 3 most recent FG attempts by the
// same player.
function isOnHotStreakAtIndex(events, target) {
  if (!target || !target.player_name) return false;
  const idx = events.findIndex(e => e.event_id === target.event_id);
  if (idx < 0) return false;
  let streak = 0;
  for (let i = idx; i >= 0; i--) {
    const e = events[i];
    if (e.deleted) continue;
    if (e.player_name !== target.player_name) continue;
    if (e.stat_type === "made_ft" || e.stat_type === "missed_ft") continue;
    if (e.stat_type === "made_2" || e.stat_type === "made_3") {
      streak += 1;
      if (streak >= 3) return true;
    } else if (e.stat_type === "missed_2" || e.stat_type === "missed_3") {
      return false;
    }
  }
  return streak >= 3;
}

function TeamScorePanel({ team, score, color, fouls, topScorer }) {
  const foulRed = fouls >= 10;
  const fullName = TEAM_NAMES[team] || team;
  return (
    <div className="rounded-xl p-3 bg-gray-50 border border-gray-100 flex flex-col items-center text-center">
      <TeamLogoLocal team={team} size={36} />
      <div className="mt-1 text-base font-black text-gray-900 truncate w-full">{fullName}</div>
      <div className="mt-1 text-5xl font-black text-gray-900 leading-none tracking-tight tabular-nums">{score}</div>
      <div className="mt-2 text-xs">
        <span className={`font-bold ${foulRed ? "text-red-600" : "text-gray-500"}`}>
          FOULS {fouls}
        </span>
      </div>
      {topScorer && topScorer.pts > 0 && (
        <div className="mt-1 text-[11px] text-gray-500 truncate w-full">
          {formatName(topScorer.name)} {topScorer.pts}pts
        </div>
      )}
    </div>
  );
}

// ============================================================
// Game control bar: period + end-half/end-game + timeouts per team.
// Rendered ABOVE the scoreboard for scorers on the Live Score Mode tab.
// Each scorer can only tap their own team's timeout pills, but sees
// both teams' pill states. Pills display remaining timeouts with the
// numbers renumbered from 1 as timeouts are used.
// ============================================================
function GameControlBar({ game, live, me, myRole, events, currentHalf, teamTimeoutsThisHalf, teamScore }) {
  const period = live?.period || "H1";
  const homeTeam = game.home_team;
  const awayTeam = game.away_team;
  const myTeamCode = myRole === "home_scorer" ? homeTeam : myRole === "away_scorer" ? awayTeam : null;
  const homeTOUsed = teamTimeoutsThisHalf?.[currentHalf]?.[homeTeam] || 0;
  const awayTOUsed = teamTimeoutsThisHalf?.[currentHalf]?.[awayTeam] || 0;
  const inRegulation = period === "H1" || period === "H2" || period?.startsWith("OT");
  const gameIsOver = live?.status === "ended" || live?.status === "approved";

  const endFirstHalf = async () => {
    if (!confirm("End 1st half and begin 2nd half?")) return;
    await supabase.from("live_games").update({
      period: "H2", status: "live",
      home_timeouts_remaining: 3, away_timeouts_remaining: 3,
      updated_at: new Date().toISOString(),
    }).eq("game_id", game.game_id);
    await supabase.from("live_events").insert({
      game_id: game.game_id, period: "H2", stat_type: "period_change",
      player_name: "H2", scorer_pin: me.pin, scorer_name: me.name,
    });
  };

  const endGameOrStartOT = async () => {
    const homeScore = teamScore?.[homeTeam] || 0;
    const awayScore = teamScore?.[awayTeam] || 0;
    if (homeScore === awayScore) {
      if (!confirm("Scores are tied. Start overtime?")) return;
      const curPeriod = live?.period || "H2";
      const nextOT = curPeriod === "H2" ? "OT1" :
        curPeriod.startsWith("OT") ? `OT${parseInt(curPeriod.slice(2)) + 1}` : "OT1";
      await supabase.from("live_games").update({
        period: nextOT, status: "live",
        home_timeouts_remaining: 1, away_timeouts_remaining: 1,
        updated_at: new Date().toISOString(),
      }).eq("game_id", game.game_id);
      await supabase.from("live_events").insert({
        game_id: game.game_id, period: nextOT, stat_type: "period_change",
        player_name: nextOT, scorer_pin: me.pin, scorer_name: me.name,
      });
    } else {
      if (!confirm(`End game? Final: ${awayTeam} ${awayScore} - ${homeTeam} ${homeScore}`)) return;
      await supabase.from("live_games").update({
        status: "ended", period: "Final",
        ended_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      }).eq("game_id", game.game_id);
      await supabase.from("schedule").update({ status: "ended" }).eq("game_id", game.game_id);
      await supabase.from("live_events").insert({
        game_id: game.game_id, period: "Final", stat_type: "game_end",
        scorer_pin: me.pin, scorer_name: me.name,
      });
    }
  };

  const callTimeout = async (teamCode) => {
    const used = teamTimeoutsThisHalf?.[currentHalf]?.[teamCode] || 0;
    if (used >= 3) return;
    await supabase.from("live_events").insert({
      game_id: game.game_id,
      period: live?.period || "H1",
      team: teamCode,
      player_name: null,
      stat_type: "timeout",
      scorer_pin: me.pin,
      scorer_name: me.name,
    });
  };

  // Render 3 numbered rectangles. Used slots are X'ed out and gray on the
  // LEFT. Remaining green pills renumber from 1 on the right so the scorer
  // can easily tell how many timeouts remain. When all 3 are used, a red
  // message renders below instead of any pills.
  const renderTimeoutPills = (teamCode, usedCount) => {
    const iCanTap = teamCode === myTeamCode && inRegulation && !gameIsOver;
    if (usedCount >= 3) {
      return (
        <span className="text-[11px] font-bold text-red-600">
          No timeouts left
        </span>
      );
    }
    const remaining = 3 - usedCount;
    const pills = [];
    // Used pills on the left
    for (let i = 0; i < usedCount; i++) {
      pills.push(
        <div key={`u${i}`}
          className="relative w-8 h-7 rounded-md bg-gray-200 border border-gray-300 flex items-center justify-center flex-shrink-0"
          title="Used"
        >
          <svg viewBox="0 0 20 20" className="w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="5" y1="5" x2="15" y2="15" />
            <line x1="15" y1="5" x2="5" y2="15" />
          </svg>
        </div>
      );
    }
    // Remaining green pills, renumbered 1..remaining
    for (let i = 0; i < remaining; i++) {
      const label = i + 1;
      // Only the first remaining pill is tappable so a double-tap doesn't
      // accidentally burn two timeouts.
      const isNext = i === 0;
      pills.push(
        <button key={`r${i}`}
          onClick={() => isNext && iCanTap && callTimeout(teamCode)}
          disabled={!isNext || !iCanTap}
          className={`w-8 h-7 rounded-md text-xs font-black flex items-center justify-center flex-shrink-0 transition-all ${
            isNext && iCanTap
              ? "bg-green-500 text-white border-2 border-green-600 active:bg-green-600"
              : "bg-green-100 text-green-700 border border-green-200"
          } disabled:cursor-default`}
          title={iCanTap && isNext ? `Call timeout for ${teamCode}` : ""}
        >
          {label}
        </button>
      );
    }
    return <div className="flex gap-1">{pills}</div>;
  };

  if (!inRegulation || gameIsOver) {
    // Still show a thin period indicator if the game is in a terminal state.
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-2 mb-3 flex items-center justify-center">
        <span className="text-sm font-black text-gray-700">{period || "Final"}</span>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3 mb-3 space-y-2">
      {/* Row 1: period + action button */}
      <div className="flex items-center justify-between gap-2">
        <div className="text-xl font-black text-gray-900">{period}</div>
        <div className="flex gap-1.5">
          {period === "H1" && (
            <button onClick={endFirstHalf}
              className="text-[11px] font-bold px-3 py-1.5 rounded-lg bg-gray-900 text-white active:bg-gray-800">
              End 1st half
            </button>
          )}
          {(period === "H2" || period?.startsWith("OT")) && (
            <button onClick={endGameOrStartOT}
              className="text-[11px] font-bold px-3 py-1.5 rounded-lg bg-red-600 text-white active:bg-red-700">
              End game
            </button>
          )}
        </div>
      </div>
      {/* Row 2: timeouts, one line per team */}
      <div className="pt-2 border-t border-gray-100 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">
            {awayTeam} timeouts
          </span>
          {renderTimeoutPills(awayTeam, awayTOUsed)}
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">
            {homeTeam} timeouts
          </span>
          {renderTimeoutPills(homeTeam, homeTOUsed)}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Scorer controls: team claim, stat entry with rebound/assist
// prompts, undo, game state buttons
// ============================================================
function ScorerControls({ game, live, events, rosters, me, myRole, onReload, currentHalf, teamFoulsThisHalf, teamTimeoutsThisHalf, teamScore, box }) {
  const [showAdminForTakeover, setShowAdminForTakeover] = useState(null); // target team code
  const [pendingStat, setPendingStat] = useState(null); // {stat, player}
  const [promptMode, setPromptMode] = useState(null);   // rebound | assist
  const [busy, setBusy] = useState(false);

  const myTeamCode = myRole === "home_scorer" ? game.home_team : myRole === "away_scorer" ? game.away_team : null;
  const myRoster = myRole === "home_scorer" ? rosters.home : myRole === "away_scorer" ? rosters.away : [];

  const gameStatus = live?.status || "scheduled";
  const gameIsOver = gameStatus === "ended" || gameStatus === "approved";

  // ---- Team claim ----
  const claimTeam = async (teamCode) => {
    if (!me) { alert("Sign in with your PIN first."); return; }
    setBusy(true);
    // Initialize live_games row if missing
    const col = teamCode === game.home_team ? "home" : "away";
    const existing = live;
    const patch = {
      game_id: game.game_id,
      status: existing?.status || "live",
      period: existing?.period || "H1",
      started_at: existing?.started_at || new Date().toISOString(),
      home_timeouts_remaining: existing?.home_timeouts_remaining ?? 3,
      away_timeouts_remaining: existing?.away_timeouts_remaining ?? 3,
      [`${col}_scorer_pin`]: me.pin,
      [`${col}_scorer_name`]: me.name,
      updated_at: new Date().toISOString(),
    };
    const { error } = await supabase.from("live_games").upsert(patch);
    if (error) { alert("Error: " + error.message); setBusy(false); return; }
    await supabase.from("schedule").update({ status: "live" }).eq("game_id", game.game_id);
    await supabase.from("audit_log").insert({
      game_id: game.game_id, actor_pin: me.pin, actor_name: me.name,
      action: "claim_scorer", after_value: { team: teamCode },
    });
    setBusy(false);
    onReload();
  };

  // ---- Takeover (requires admin) ----
  const requestTakeover = (teamCode) => {
    if (!me) { alert("Sign in with your PIN first."); return; }
    if (!confirm(`Take over scoring for ${teamCode}? The current scorer will be kicked.`)) return;
    setShowAdminForTakeover(teamCode);
  };

  // When a scorer has been silent for 10+ minutes, anyone can claim their
  // slot without the admin password. Returns true if the slot is stale.
  const STALE_MS = 10 * 60 * 1000;
  const scorerIsStale = (teamCode) => {
    const col = teamCode === game.home_team ? "home" : "away";
    const pin = live?.[`${col}_scorer_pin`];
    if (!pin) return false;
    let latest = 0;
    for (const e of events) {
      if (e.deleted) continue;
      if (e.scorer_pin !== pin) continue;
      if (!e.event_ts) continue;
      const ts = new Date(e.event_ts).getTime();
      if (ts > latest) latest = ts;
    }
    // If they've never entered an event, fall back to started_at on live_games
    if (!latest && live?.started_at) latest = new Date(live.started_at).getTime();
    if (!latest) return false;
    return (Date.now() - latest) >= STALE_MS;
  };

  // Claim a stale slot: same as claimTeam but logs a different audit action
  // and shows a notice message about the auto-release.
  const claimStaleSlot = async (teamCode) => {
    if (!me) { alert("Sign in with your PIN first."); return; }
    if (!confirm(`The current scorer has been inactive for 10+ minutes. Claim ${teamCode}?`)) return;
    setBusy(true);
    const col = teamCode === game.home_team ? "home" : "away";
    const prev = { pin: live?.[`${col}_scorer_pin`], name: live?.[`${col}_scorer_name`] };
    const { error } = await supabase.from("live_games").update({
      [`${col}_scorer_pin`]: me.pin,
      [`${col}_scorer_name`]: me.name,
      updated_at: new Date().toISOString(),
    }).eq("game_id", game.game_id);
    if (error) { alert("Error: " + error.message); setBusy(false); return; }
    await supabase.from("audit_log").insert({
      game_id: game.game_id, actor_pin: me.pin, actor_name: me.name,
      action: "claim_stale",
      before_value: prev,
      after_value: { team: teamCode, new_pin: me.pin, new_name: me.name },
    });
    setBusy(false);
    onReload();
  };

  const executeTakeover = async (teamCode) => {
    setBusy(true);
    const col = teamCode === game.home_team ? "home" : "away";
    const prev = { pin: live?.[`${col}_scorer_pin`], name: live?.[`${col}_scorer_name`] };
    const { error } = await supabase.from("live_games").update({
      [`${col}_scorer_pin`]: me.pin,
      [`${col}_scorer_name`]: me.name,
      updated_at: new Date().toISOString(),
    }).eq("game_id", game.game_id);
    if (error) { alert("Error: " + error.message); setBusy(false); return; }
    await supabase.from("audit_log").insert({
      game_id: game.game_id, actor_pin: me.pin, actor_name: me.name,
      action: "takeover",
      before_value: prev,
      after_value: { team: teamCode, new_pin: me.pin, new_name: me.name },
    });
    setBusy(false);
    setShowAdminForTakeover(null);
    onReload();
  };

  // ---- Insert event ----
  const insertEvent = async (stat_type, player_name = null, extra = {}) => {
    if (!me) return;
    const team = myTeamCode;
    const payload = {
      game_id: game.game_id,
      period: live?.period || "H1",
      team,
      player_name,
      stat_type,
      scorer_pin: me.pin,
      scorer_name: me.name,
      ...extra,
    };
    const { error } = await supabase.from("live_events").insert(payload);
    if (error) { alert("Error: " + error.message); return; }
  };

  // ---- Stat button tap flow ----
  const tapStat = (statKey) => {
    if (!myTeamCode) return;
    const meta = STAT_BUTTONS.find(s => s.key === statKey);
    setPendingStat({ key: statKey, meta });
    setPromptMode(null);
  };

  const tapPlayerForStat = async (player) => {
    if (!pendingStat) return;
    const key = pendingStat.key;
    const meta = pendingStat.meta;

    // Insert the primary event
    await insertEvent(key, player.player_name);

    // If this is a miss, open rebound prompt
    if (meta.prompt === "rebound") {
      setPendingStat({ ...pendingStat, shooter: player });
      setPromptMode("rebound");
      return;
    }
    // If this is a make (2 or 3), open assist prompt
    if (meta.prompt === "assist") {
      setPendingStat({ ...pendingStat, shooter: player });
      setPromptMode("assist");
      return;
    }
    // Else done
    setPendingStat(null);
    setPromptMode(null);
  };

  // Technical / Spiritual foul: user tapped one of those buttons in the
  // foul player-picker INSTEAD of tapping a player. We drop into a second
  // prompt that collects (a) the offender and (b) an optional explanation.
  const startFoulSubtype = (subtype) => {
    setPendingStat(prev => ({ ...prev, foulSubtype: subtype, foulNote: "" }));
    setPromptMode("foul_subtype_player");
  };

  const chooseFoulSubtypePlayer = (player) => {
    setPendingStat(prev => ({ ...prev, foulPlayer: player }));
    setPromptMode("foul_subtype_note");
  };

  const saveFoulSubtype = async () => {
    const player = pendingStat?.foulPlayer;
    const subtype = pendingStat?.foulSubtype;
    const note = (pendingStat?.foulNote || "").trim();
    if (!player || !subtype) { cancelPrompt(); return; }
    await insertEvent("foul", player.player_name, {
      foul_subtype: subtype,
      foul_note: note ? note.slice(0, 200) : null,
    });
    setPendingStat(null);
    setPromptMode(null);
  };

  const chooseRebound = async (choice) => {
    if (choice === "own") {
      // Need to pick a player - keep the prompt open but in "own-reb-player" sub-mode
      setPromptMode("rebound_own_player");
      return;
    }
    if (choice === "other_team") {
      await insertEvent("reb_other_team", null);
    }
    // choice === "none" -> no event
    setPendingStat(null);
    setPromptMode(null);
  };

  const chooseReboundPlayer = async (player) => {
    await insertEvent("reb", player.player_name);
    setPendingStat(null);
    setPromptMode(null);
  };

  const chooseAssist = async (choice, player) => {
    if (choice === "player" && player) {
      await insertEvent("ast", player.player_name);
    }
    setPendingStat(null);
    setPromptMode(null);
  };

  const cancelPrompt = () => { setPendingStat(null); setPromptMode(null); };

  // ---- Undo helpers ----
  // "My events" for undo/history includes period_change entries so scorers
  // can back out an accidental "end half" tap. Excludes game_start/game_end/
  // reopen (those are locked and require admin tools).
  const myUndoableEvents = useMemo(() => {
    const EXCLUDE = new Set(["game_start", "game_end", "reopen"]);
    return events.filter(e =>
      !e.deleted
      && e.scorer_pin === me?.pin
      && !EXCLUDE.has(e.stat_type)
    );
  }, [events, me?.pin]);

  // Undo the most recent event by this scorer. If the last event was a
  // period_change, ask for confirmation and also reset the live_games
  // period back to the prior period (so the UI doesn't stay in H2 while
  // the event was deleted).
  const undoLast = async () => {
    if (myUndoableEvents.length === 0) return;
    const last = myUndoableEvents[myUndoableEvents.length - 1];
    if (last.stat_type === "period_change") {
      if (!confirm(`Undo end-of-half and go back to the previous period?`)) return;
      // Find the period before this period_change
      const prior = [...events]
        .filter(e => !e.deleted && e.stat_type === "period_change")
        .filter(e => e.event_id !== last.event_id);
      const priorPeriod = prior.length > 0
        ? prior[prior.length - 1].player_name
        : "H1";
      await supabase.from("live_games").update({
        period: priorPeriod, status: "live",
        updated_at: new Date().toISOString(),
      }).eq("game_id", game.game_id);
    }
    const { error } = await supabase.from("live_events").update({
      deleted: true, edited_at: new Date().toISOString(), edited_by: me.name,
    }).eq("event_id", last.event_id);
    if (error) { alert(error.message); return; }
    await supabase.from("audit_log").insert({
      game_id: game.game_id, actor_pin: me.pin, actor_name: me.name,
      action: "undo", event_id: last.event_id, before_value: last,
    });
  };

  // Undo a specific event id (used by last-3 history panel).
  const undoSpecific = async (ev) => {
    if (!ev) return;
    if (ev.stat_type === "period_change") {
      if (!confirm(`Undo this period change?`)) return;
      const prior = [...events]
        .filter(e => !e.deleted && e.stat_type === "period_change")
        .filter(e => e.event_id !== ev.event_id);
      const priorPeriod = prior.length > 0
        ? prior[prior.length - 1].player_name
        : "H1";
      await supabase.from("live_games").update({
        period: priorPeriod, status: "live",
        updated_at: new Date().toISOString(),
      }).eq("game_id", game.game_id);
    } else {
      if (!confirm(`Delete this event?`)) return;
    }
    const { error } = await supabase.from("live_events").update({
      deleted: true, edited_at: new Date().toISOString(), edited_by: me.name,
    }).eq("event_id", ev.event_id);
    if (error) { alert(error.message); return; }
    await supabase.from("audit_log").insert({
      game_id: game.game_id, actor_pin: me.pin, actor_name: me.name,
      action: "undo", event_id: ev.event_id, before_value: ev,
    });
  };

  // ---- Release scoring slot ----
  // Scorer voluntarily relinquishes their slot. Someone else can then
  // claim without the admin-takeover flow. Logs an audit entry.
  const releaseSlot = async () => {
    if (!confirm("Release scorer slot? You won't be scoring this game anymore.")) return;
    const col = myRole === "home_scorer" ? "home" : "away";
    await supabase.from("live_games").update({
      [`${col}_scorer_pin`]: null,
      [`${col}_scorer_name`]: null,
      updated_at: new Date().toISOString(),
    }).eq("game_id", game.game_id);
    await supabase.from("audit_log").insert({
      game_id: game.game_id, actor_pin: me.pin, actor_name: me.name,
      action: "release_scorer",
      before_value: { team: myTeamCode, pin: me.pin, name: me.name },
    });
    onReload();
  };

  // ---- Period/state controls ----
  // End of first half jumps straight to H2 (no halftime intermission).
  const endFirstHalf = async () => {
    if (!confirm("End 1st half and begin 2nd half?")) return;
    await supabase.from("live_games").update({
      period: "H2", status: "live",
      home_timeouts_remaining: 3, away_timeouts_remaining: 3,
      updated_at: new Date().toISOString(),
    }).eq("game_id", game.game_id);
    await supabase.from("live_events").insert({
      game_id: game.game_id, period: "H2", stat_type: "period_change",
      player_name: "H2", scorer_pin: me.pin, scorer_name: me.name,
    });
  };

  // ---- Timeout ----
  // Any scorer can record a timeout for either playing team. Timeouts are
  // tracked per half via live_events (stat_type='timeout'), computed from
  // teamTimeoutsThisHalf in computeBoxScore. Resets automatically on H2/OT.
  const callTimeout = async (teamCode) => {
    if (!me) return;
    const used = teamTimeoutsThisHalf?.[currentHalf]?.[teamCode] || 0;
    if (used >= 3) return;
    await supabase.from("live_events").insert({
      game_id: game.game_id,
      period: live?.period || "H1",
      team: teamCode,
      player_name: null,
      stat_type: "timeout",
      scorer_pin: me.pin,
      scorer_name: me.name,
    });
  };

  const endGameOrStartOT = async () => {
    // Use live teamScore already computed from events (single source of truth)
    const homeScore = teamScore?.[game.home_team] || 0;
    const awayScore = teamScore?.[game.away_team] || 0;
    if (homeScore === awayScore) {
      if (!confirm("Scores are tied. Start overtime?")) return;
      const curPeriod = live?.period || "H2";
      const nextOT = curPeriod === "H2" || curPeriod === "Halftime" ? "OT1" :
        curPeriod.startsWith("OT") ? `OT${parseInt(curPeriod.slice(2)) + 1}` : "OT1";
      await supabase.from("live_games").update({
        period: nextOT, status: "live",
        home_timeouts_remaining: 1, away_timeouts_remaining: 1,
        updated_at: new Date().toISOString(),
      }).eq("game_id", game.game_id);
      await supabase.from("live_events").insert({ game_id: game.game_id, period: nextOT, stat_type: "period_change", player_name: nextOT, scorer_pin: me.pin, scorer_name: me.name });
    } else {
      if (!confirm(`End game? Final: ${game.away_team} ${awayScore} - ${game.home_team} ${homeScore}`)) return;
      await supabase.from("live_games").update({ status: "ended", period: "Final", ended_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("game_id", game.game_id);
      await supabase.from("schedule").update({ status: "ended" }).eq("game_id", game.game_id);
      await supabase.from("live_events").insert({ game_id: game.game_id, period: "Final", stat_type: "game_end", scorer_pin: me.pin, scorer_name: me.name });
    }
  };

  const reopenGame = async () => {
    if (!confirm("Reopen this game for edits? Requires admin password next.")) return;
    setShowAdminForTakeover("__REOPEN__");
  };

  const executeReopen = async () => {
    await supabase.from("live_games").update({ status: "live", period: "H2", ended_at: null, updated_at: new Date().toISOString() }).eq("game_id", game.game_id);
    await supabase.from("schedule").update({ status: "live" }).eq("game_id", game.game_id);
    await supabase.from("live_events").insert({ game_id: game.game_id, period: "H2", stat_type: "reopen", scorer_pin: me.pin, scorer_name: me.name });
    await supabase.from("audit_log").insert({
      game_id: game.game_id, actor_pin: me.pin, actor_name: me.name, action: "reopen",
    });
    setShowAdminForTakeover(null);
  };

  // ---------- Render ----------
  if (!me) {
    return (
      <div className="rounded-2xl border border-gray-100 bg-gray-50 p-4 text-center">
        <div className="text-sm text-gray-700 mb-2">Sign in with your PIN to score.</div>
        <div className="text-[11px] text-gray-400">Go back and tap &quot;Sign in with PIN&quot; at the top of the Live tab.</div>
      </div>
    );
  }

  // If game not started yet, show team claim UI
  if (!live || gameStatus === "scheduled") {
    return (
      <div className="rounded-2xl border border-gray-100 bg-gray-50 p-4">
        <div className="text-[11px] text-gray-500 font-semibold uppercase tracking-wide mb-2">Claim team to score</div>
        <div className="grid grid-cols-2 gap-2">
          {[game.away_team, game.home_team].map(t => (
            <button key={t} onClick={() => claimTeam(t)} disabled={busy}
              className="py-4 rounded-xl bg-white border border-gray-200 active:bg-gray-50 transition-colors">
              <div className="text-xs text-gray-400 font-bold uppercase tracking-wide mb-1">
                {t === game.home_team ? "Home" : "Away"}
              </div>
              <div className="text-lg font-bold" style={{ color: TEAM_COLORS[t] || "#111827" }}>{t}</div>
              <div className="text-[10px] text-gray-400 mt-1">Tap to claim</div>
            </button>
          ))}
        </div>
      </div>
    );
  }

  // Game in progress or ended: show claim/takeover banner if I'm not a scorer
  if (myRole === "viewer" && !gameIsOver) {
    const homeTaken = !!live.home_scorer_pin;
    const awayTaken = !!live.away_scorer_pin;
    return (
      <div className="rounded-2xl border border-gray-100 bg-gray-50 p-4">
        <div className="text-[11px] text-gray-500 font-semibold uppercase tracking-wide mb-3">Scorers</div>
        {[[game.away_team, "away"], [game.home_team, "home"]].map(([t, side]) => {
          const taken = side === "home" ? homeTaken : awayTaken;
          const takenBy = side === "home" ? live.home_scorer_name : live.away_scorer_name;
          const stale = taken && scorerIsStale(t);
          return (
            <div key={t} className="flex items-center gap-2 py-2">
              <div className="flex-1">
                <div className="text-sm font-bold" style={{ color: TEAM_COLORS[t] || "#111827" }}>{t}</div>
                <div className="text-[11px] text-gray-500">
                  {taken ? (
                    <>
                      {formatName(takenBy)}
                      {stale && (
                        <span className="ml-1 text-orange-600 font-semibold">
                          (inactive 10+ min)
                        </span>
                      )}
                    </>
                  ) : "Unclaimed"}
                </div>
              </div>
              {!taken ? (
                <button onClick={() => claimTeam(t)}
                  className="text-[11px] font-bold text-white px-2 py-1 rounded bg-gray-900 active:bg-gray-800">
                  Claim
                </button>
              ) : stale ? (
                <button onClick={() => claimStaleSlot(t)}
                  className="text-[11px] font-bold text-white px-2 py-1 rounded bg-orange-600 active:bg-orange-700">
                  Claim (inactive)
                </button>
              ) : (
                <button onClick={() => requestTakeover(t)}
                  className="text-[11px] font-bold text-red-700 px-2 py-1 rounded bg-red-50 active:bg-red-100 border border-red-200">
                  Take over
                </button>
              )}
            </div>
          );
        })}

        {showAdminForTakeover && showAdminForTakeover !== "__REOPEN__" && (
          <AdminPasswordModal
            title="Confirm takeover"
            subtitle={`Replace current scorer for ${showAdminForTakeover}?`}
            onClose={() => setShowAdminForTakeover(null)}
            onOk={() => executeTakeover(showAdminForTakeover)}
          />
        )}
      </div>
    );
  }

  // If I am a scorer, show stat grid + roster + controls
  if (myRole === "home_scorer" || myRole === "away_scorer") {
    const period = live.period || "H1";

    // Stat meta for the current pending stat (for banner coloring and labels)
    const pendingLabel = pendingStat?.meta?.label || "";
    const pendingIsGreen = pendingStat?.meta?.color?.includes("green");
    const pendingIsRed = pendingStat?.meta?.color?.includes("red");

    // Stat grid rows. Row 1 and row 2 are 3 buttons each, row 3 is 4.
    const row1Keys = ["made_2", "made_3", "made_ft"];
    const row2Keys = ["missed_2", "missed_3", "missed_ft"];
    const row3Keys = ["reb", "stl", "blk", "foul"];
    const statByKey = Object.fromEntries(STAT_BUTTONS.map(s => [s.key, s]));

    const renderStatButton = (key) => {
      const s = statByKey[key];
      if (!s) return null;
      const active = pendingStat?.key === key;
      return (
        <button key={key} onClick={() => tapStat(key)}
          className={`py-3 rounded-xl text-sm font-black transition-all border-2 ${
            active
              ? `${s.color} border-gray-900 ring-4 ${s.activeRing}`
              : `${s.color} border-transparent opacity-90 active:opacity-100`
          }`}>
          {s.label}
        </button>
      );
    };

    // Partition the roster for the current stat (with-stat first, without
    // second, sorted by last name). For rebound/assist prompts we partition
    // on the relevant secondary stat instead.
    const partitionStatKey = (() => {
      if (promptMode === "rebound_own_player") return "reb";
      if (promptMode === "assist") return "ast";
      if (promptMode === "foul_subtype_player") return "foul";
      return pendingStat?.key || null;
    })();
    const partitioned = partitionStatKey
      ? partitionRosterByStat(myRoster, box, partitionStatKey)
      : null;

    // Renders a single player card in the box picker: big last name, jersey #
    // placeholder, and the per-stat count as a small chip in the corner.
    const renderPlayerCard = (p, opts = {}) => {
      const { onClick, disabled, showCount = true } = opts;
      const name = p.player_name || "";
      const parts = name.trim().split(/\s+/);
      const lastName = (parts[0] || "").replace(/^./, c => c.toUpperCase()).toLowerCase();
      const displayLast = parts[0] ? parts[0].charAt(0).toUpperCase() + parts[0].slice(1).toLowerCase() : name;
      const firstInitial = parts[1] ? parts[1].charAt(0).toUpperCase() + "." : "";
      const count = showCount && partitionStatKey
        ? statCountForPlayer(partitionStatKey, box[name])
        : 0;
      return (
        <button key={p.roster_id}
          onClick={onClick}
          disabled={disabled}
          className="relative py-4 px-2 rounded-xl bg-white border-2 border-gray-200 text-center active:bg-gray-50 disabled:opacity-40 disabled:active:bg-white">
          <div className="absolute top-1 left-2 text-[10px] font-bold text-gray-300">#</div>
          {showCount && count > 0 && (
            <div className="absolute top-1 right-2 text-[10px] font-black text-gray-500 tabular-nums">
              {count}
            </div>
          )}
          <div className="text-base font-black text-gray-900 truncate leading-tight">{displayLast}</div>
          {firstInitial && (
            <div className="text-[10px] text-gray-400 truncate">{firstInitial}</div>
          )}
        </button>
      );
    };

    // Scorer's last 3 events for the history panel (includes period_change).
    const lastThree = myUndoableEvents.slice(-3).reverse();

    return (
      <div className="space-y-3">
        {gameIsOver && (
          <div className="rounded-xl border border-gray-100 bg-gray-50 p-3 flex items-center justify-between">
            <div className="text-[11px] text-gray-500">
              Game ended. Tap &quot;Reopen&quot; (requires admin) to edit.
            </div>
            <button onClick={reopenGame}
              className="text-[11px] font-bold px-3 py-1.5 rounded-lg bg-gray-100 text-gray-700 active:bg-gray-200">
              Reopen
            </button>
          </div>
        )}

        {/* Stat buttons: Row 1 makes (green), Row 2 misses (red), Row 3 REB/STL/BLK/FOUL */}
        {!gameIsOver && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="text-[11px] text-gray-500 font-semibold uppercase tracking-wide">
                Tap stat &middot; {myTeamCode}
              </div>
              <button onClick={undoLast}
                className="text-[11px] font-bold px-2.5 py-1 rounded-lg bg-gray-100 text-gray-700 active:bg-gray-200">
                Undo last
              </button>
            </div>
            <div className="space-y-1.5">
              <div className="grid grid-cols-3 gap-1.5">
                {row1Keys.map(renderStatButton)}
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                {row2Keys.map(renderStatButton)}
              </div>
              <div className="grid grid-cols-4 gap-1.5">
                {row3Keys.map(renderStatButton)}
              </div>
            </div>
          </div>
        )}

        {/* Last-3 history panel (collapsible under the stat grid) */}
        {!gameIsOver && lastThree.length > 0 && (
          <LastThreePanel events={lastThree} onUndo={undoSpecific} />
        )}

        {/* Release scorer button (bottom of scoring UI, subtle) */}
        {!gameIsOver && (
          <div className="pt-2">
            <button onClick={releaseSlot}
              className="w-full py-2 rounded-lg text-[11px] font-semibold text-gray-400 border border-dashed border-gray-200 active:bg-gray-50 active:text-gray-600">
              Release scoring responsibility
            </button>
          </div>
        )}

        {/* Primary stat box picker (opens whenever a stat is tapped) */}
        {pendingStat && !promptMode && (
          <ModalShell
            title={
              <span className="flex items-center gap-2">
                <span className={`inline-block w-2 h-2 rounded-full ${
                  pendingIsGreen ? "bg-green-500" :
                  pendingIsRed ? "bg-red-500" :
                  "bg-gray-700"
                }`} />
                <span>Tap player for <span className="font-black">{pendingLabel}</span></span>
              </span>
            }
            onClose={cancelPrompt}
          >
            <div className="grid grid-cols-2 gap-1.5 max-h-80 overflow-y-auto">
              {partitioned?.withStat.map(p => renderPlayerCard(p, { onClick: () => tapPlayerForStat(p) }))}
              {partitioned?.withStat.length > 0 && partitioned?.withoutStat.length > 0 && (
                <div className="col-span-2 my-1 flex items-center gap-2">
                  <div className="flex-1 h-px bg-gray-200" />
                  <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                    {partitionStatKey === "reb" ? "No rebounds yet" :
                     partitionStatKey === "foul" ? "No fouls yet" :
                     partitionStatKey === "stl" ? "No steals yet" :
                     partitionStatKey === "blk" ? "No blocks yet" :
                     "No stat yet"}
                  </span>
                  <div className="flex-1 h-px bg-gray-200" />
                </div>
              )}
              {partitioned?.withoutStat.map(p => renderPlayerCard(p, { onClick: () => tapPlayerForStat(p) }))}
            </div>
            {/* For fouls, add Technical/Spiritual buttons at the bottom */}
            {pendingStat?.key === "foul" && (
              <div className="mt-3 pt-3 border-t border-gray-200 space-y-2">
                <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest text-center">
                  Or mark as
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button onClick={() => startFoulSubtype("technical")}
                    className="py-3 rounded-xl bg-orange-500 text-white font-black text-sm active:bg-orange-600">
                    Technical Foul
                  </button>
                  <button onClick={() => startFoulSubtype("spiritual")}
                    className="py-3 rounded-xl bg-purple-600 text-white font-black text-sm active:bg-purple-700">
                    Spiritual Foul
                  </button>
                </div>
              </div>
            )}
          </ModalShell>
        )}

        {/* Technical / Spiritual foul: pick player */}
        {promptMode === "foul_subtype_player" && (
          <ModalShell
            title={
              <span>
                {pendingStat?.foulSubtype === "technical" ? "Technical foul" : "Spiritual foul"}
                <span className="text-gray-500 font-normal"> &middot; tap player</span>
              </span>
            }
            onClose={cancelPrompt}
          >
            <div className="grid grid-cols-2 gap-1.5 max-h-80 overflow-y-auto">
              {partitioned?.withStat.map(p => renderPlayerCard(p, { onClick: () => chooseFoulSubtypePlayer(p) }))}
              {partitioned?.withStat.length > 0 && partitioned?.withoutStat.length > 0 && (
                <div className="col-span-2 my-1 flex items-center gap-2">
                  <div className="flex-1 h-px bg-gray-200" />
                  <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">No fouls yet</span>
                  <div className="flex-1 h-px bg-gray-200" />
                </div>
              )}
              {partitioned?.withoutStat.map(p => renderPlayerCard(p, { onClick: () => chooseFoulSubtypePlayer(p) }))}
            </div>
          </ModalShell>
        )}

        {/* Technical / Spiritual foul: optional explanation note */}
        {promptMode === "foul_subtype_note" && (
          <ModalShell
            title={
              <span>
                {pendingStat?.foulSubtype === "technical" ? "Technical foul" : "Spiritual foul"}
                <span className="text-gray-500 font-normal">
                  {" "}on {formatName(pendingStat?.foulPlayer?.player_name)}
                </span>
              </span>
            }
            onClose={cancelPrompt}
          >
            <div className="space-y-3">
              <div className="text-[12px] text-gray-600 leading-snug">
                Please explain what happened in less than 20 words, if possible. Feel free to use ref explanation.
              </div>
              <textarea
                value={pendingStat?.foulNote || ""}
                onChange={(e) => setPendingStat(prev => ({ ...prev, foulNote: e.target.value }))}
                maxLength={200}
                placeholder="(optional)"
                rows={3}
                className="w-full rounded-lg border border-gray-200 p-2 text-sm focus:outline-none focus:border-gray-400"
              />
              <div className="flex gap-2">
                <button onClick={cancelPrompt}
                  className="flex-1 py-2.5 rounded-lg bg-gray-100 text-gray-700 font-bold text-sm active:bg-gray-200">
                  Cancel
                </button>
                <button onClick={saveFoulSubtype}
                  className="flex-1 py-2.5 rounded-lg bg-gray-900 text-white font-bold text-sm active:bg-gray-800">
                  Save
                </button>
              </div>
            </div>
          </ModalShell>
        )}

        {/* Rebound prompt overlay (after a missed shot) */}
        {promptMode === "rebound" && (
          <ModalShell title="Rebound?" onClose={cancelPrompt}>
            <div className="space-y-2">
              <button onClick={() => chooseRebound("own")}
                className="w-full py-3 rounded-xl bg-gray-900 text-white font-bold text-sm active:bg-gray-800">
                {myTeamCode} rebound
              </button>
              <button onClick={() => chooseRebound("other_team")}
                className="w-full py-3 rounded-xl bg-gray-100 text-gray-700 font-bold text-sm active:bg-gray-200">
                Other team
              </button>
              <button onClick={() => chooseRebound("none")}
                className="w-full py-3 rounded-xl bg-gray-50 text-gray-500 font-bold text-sm active:bg-gray-100 border border-gray-200">
                No rebound
              </button>
            </div>
          </ModalShell>
        )}

        {promptMode === "rebound_own_player" && (
          <ModalShell title="Who got the rebound?" onClose={cancelPrompt}>
            <div className="grid grid-cols-2 gap-1.5 max-h-96 overflow-y-auto">
              {partitioned?.withStat.map(p => renderPlayerCard(p, { onClick: () => chooseReboundPlayer(p) }))}
              {partitioned?.withStat.length > 0 && partitioned?.withoutStat.length > 0 && (
                <div className="col-span-2 my-1 flex items-center gap-2">
                  <div className="flex-1 h-px bg-gray-200" />
                  <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">No rebounds yet</span>
                  <div className="flex-1 h-px bg-gray-200" />
                </div>
              )}
              {partitioned?.withoutStat.map(p => renderPlayerCard(p, { onClick: () => chooseReboundPlayer(p) }))}
            </div>
          </ModalShell>
        )}

        {promptMode === "assist" && (
          <ModalShell title="Assisted by?" onClose={cancelPrompt}>
            <div className="grid grid-cols-2 gap-1.5 max-h-80 overflow-y-auto">
              {partitioned?.withStat
                .filter(p => p.player_name !== pendingStat?.shooter?.player_name)
                .map(p => renderPlayerCard(p, { onClick: () => chooseAssist("player", p) }))}
              {partitioned?.withStat.filter(p => p.player_name !== pendingStat?.shooter?.player_name).length > 0 && (
                <div className="col-span-2 my-1 flex items-center gap-2">
                  <div className="flex-1 h-px bg-gray-200" />
                  <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">No assists yet</span>
                  <div className="flex-1 h-px bg-gray-200" />
                </div>
              )}
              {partitioned?.withoutStat
                .filter(p => p.player_name !== pendingStat?.shooter?.player_name)
                .map(p => renderPlayerCard(p, { onClick: () => chooseAssist("player", p) }))}
            </div>
            <button onClick={() => chooseAssist("none")}
              className="w-full mt-2 py-3 rounded-xl bg-gray-50 text-gray-500 font-bold text-sm active:bg-gray-100 border border-gray-200">
              No assist
            </button>
          </ModalShell>
        )}

        {showAdminForTakeover === "__REOPEN__" && (
          <AdminPasswordModal
            title="Confirm reopen"
            subtitle="Reopen this game for edits?"
            onClose={() => setShowAdminForTakeover(null)}
            onOk={executeReopen}
          />
        )}
      </div>
    );
  }

  // Game ended & I'm a viewer
  return (
    <div className="rounded-2xl border border-gray-100 bg-gray-50 p-4 text-center">
      <div className="text-sm text-gray-700">Game ended. See box score or play-by-play.</div>
    </div>
  );
}

// Collapsible panel showing the scorer's last 3 events, with a per-item
// undo X. Included because "Undo last" alone forces scorers to undo good
// entries just to reach a bad one.
function LastThreePanel({ events, onUndo }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-xl border border-gray-100 bg-gray-50">
      <button onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-3 py-2 text-left">
        <span className="text-[11px] font-semibold text-gray-500 uppercase tracking-widest">
          My last {events.length}
        </span>
        <span className="text-[10px] text-gray-400">{open ? "\u25B4 hide" : "\u25BE show"}</span>
      </button>
      {open && (
        <div className="px-3 pb-2 space-y-1">
          {events.map(e => (
            <div key={e.event_id || Math.random()}
              className="flex items-center justify-between gap-2 py-1.5 border-t border-gray-100">
              <span className="text-[11px] text-gray-700 flex-1 truncate">
                {formatEventText(e)}
              </span>
              <button onClick={() => onUndo(e)}
                className="text-[10px] font-bold text-red-600 px-2 py-1 rounded bg-red-50 active:bg-red-100 border border-red-200">
                Undo
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================
// Box score view (tabular)
// ============================================================
function BoxScoreView({ game, box, rosters }) {
  const renderTeam = (team, roster) => {
    const rows = roster
      .map(p => ({ name: p.player_name, ...(box[p.player_name] || { pts:0,reb:0,ast:0,stl:0,blk:0,fgm:0,fga:0,tpm:0,tpa:0,ftm:0,fta:0,foul:0 }) }))
      .filter(r => (r.pts || r.reb || r.ast || r.stl || r.blk || r.foul || r.fga || r.fta));
    // Also include players not in roster but scored
    const nameSet = new Set(roster.map(p => p.player_name));
    Object.entries(box).forEach(([n, s]) => {
      if (s.team === team && !nameSet.has(n)) {
        rows.push({ name: n, ...s });
      }
    });

    return (
      <div className="mb-3">
        <div className="flex items-center gap-1.5 mb-2">
          <span className="w-2.5 h-2.5 rounded-full" style={{ background: TEAM_COLORS[team] || "#111827" }} />
          <span className="text-sm font-bold text-gray-900">{TEAM_NAMES[team] || team}</span>
        </div>
        {rows.length === 0 ? (
          <div className="text-xs text-gray-400 px-2 py-3">No stats yet.</div>
        ) : (
          <div className="overflow-x-auto -mx-4 px-4">
            <table className="w-full text-[11px] min-w-[500px]">
              <thead>
                <tr className="text-gray-400 uppercase tracking-wider text-[9px] border-b border-gray-100">
                  <th className="text-left py-1.5 pr-2">Player</th>
                  <th className="text-right py-1.5 px-1">PTS</th>
                  <th className="text-right py-1.5 px-1">REB</th>
                  <th className="text-right py-1.5 px-1">AST</th>
                  <th className="text-right py-1.5 px-1">STL</th>
                  <th className="text-right py-1.5 px-1">BLK</th>
                  <th className="text-right py-1.5 px-1">FG</th>
                  <th className="text-right py-1.5 px-1">3P</th>
                  <th className="text-right py-1.5 px-1">FT</th>
                  <th className="text-right py-1.5 pl-1">PF</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-b border-gray-50">
                    <td className="py-1.5 pr-2 font-semibold text-gray-900 truncate max-w-[140px]">{formatName(r.name)}</td>
                    <td className="text-right py-1.5 px-1 font-bold">{r.pts}</td>
                    <td className="text-right py-1.5 px-1">{r.reb}</td>
                    <td className="text-right py-1.5 px-1">{r.ast}</td>
                    <td className="text-right py-1.5 px-1">{r.stl}</td>
                    <td className="text-right py-1.5 px-1">{r.blk}</td>
                    <td className="text-right py-1.5 px-1 tabular-nums">{r.fgm}/{r.fga}</td>
                    <td className="text-right py-1.5 px-1 tabular-nums">{r.tpm}/{r.tpa}</td>
                    <td className="text-right py-1.5 px-1 tabular-nums">{r.ftm}/{r.fta}</td>
                    <td className="text-right py-1.5 pl-1">{r.foul}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  };

  return (
    <div>
      {renderTeam(game.away_team, rosters.away)}
      {renderTeam(game.home_team, rosters.home)}
    </div>
  );
}

// ============================================================
// Play-by-play with edit/delete for scorer's own events
// ============================================================
function formatEventText(e) {
  const name = e.player_name ? formatName(e.player_name) : "";
  // Fouls: prefix with subtype so scorers and viewers see Technical/Spiritual.
  const foulLabel = e.foul_subtype === "technical"
    ? `${name} technical foul`
    : e.foul_subtype === "spiritual"
      ? `${name} spiritual foul`
      : `${name} foul`;
  const periodLabel = e.player_name === "H2" ? "End of 1st half"
    : e.player_name === "OT1" ? "Start of OT"
    : e.player_name === "Halftime" ? "Halftime"
    : e.player_name?.startsWith("OT") ? `Start of ${e.player_name}`
    : `${e.player_name}`;
  const map = {
    made_2: `${name} made 2`,
    missed_2: `${name} missed 2`,
    made_3: `${name} made 3`,
    missed_3: `${name} missed 3`,
    made_ft: `${name} made FT`,
    missed_ft: `${name} missed FT`,
    reb: `${name} rebound`,
    reb_other_team: `Other team rebound`,
    ast: `${name} assist`,
    stl: `${name} steal`,
    blk: `${name} block`,
    foul: foulLabel,
    period_change: periodLabel,
    game_start: "Game started",
    game_end: "Game ended",
    reopen: "Game reopened",
    timeout: `${e.team} timeout`,
  };
  const base = map[e.stat_type] || e.stat_type;
  // period_change and timeout already carry the team in their label (or none),
  // so don't double-tag. For shots/defensive events, add a team tag.
  const teamTag = (e.team && e.stat_type !== "period_change" && e.stat_type !== "timeout")
    ? `(${e.team})`
    : "";
  return `${base}${teamTag ? " " + teamTag : ""}`.trim();
}

function PlayByPlay({ events, me, myRole, game }) {
  const canEdit = myRole === "home_scorer" || myRole === "away_scorer";
  const visible = events.filter(e => !e.deleted).slice().reverse();

  const [editing, setEditing] = useState(null); // event object

  const deleteEvent = async (ev) => {
    if (!confirm("Delete this event?")) return;
    const { error } = await supabase.from("live_events").update({
      deleted: true, edited_at: new Date().toISOString(), edited_by: me.name,
    }).eq("event_id", ev.event_id);
    if (error) { alert(error.message); return; }
    await supabase.from("audit_log").insert({
      game_id: game.game_id, actor_pin: me.pin, actor_name: me.name,
      action: "delete_event", event_id: ev.event_id, before_value: ev,
    });
  };

  const updateEvent = async (ev, changes) => {
    const { error } = await supabase.from("live_events").update({
      ...changes, edited_at: new Date().toISOString(), edited_by: me.name,
    }).eq("event_id", ev.event_id);
    if (error) { alert(error.message); return; }
    await supabase.from("audit_log").insert({
      game_id: game.game_id, actor_pin: me.pin, actor_name: me.name,
      action: "edit_event", event_id: ev.event_id, before_value: ev, after_value: changes,
    });
    setEditing(null);
  };

  return (
    <div className="space-y-1">
      {visible.length === 0 && (
        <div className="text-center py-6 text-xs text-gray-400">No events yet.</div>
      )}
      {visible.map(e => {
        const mine = e.scorer_pin === me?.pin;
        return (
          <div key={e.event_id} className="flex items-center gap-2 py-1.5 px-2 rounded-lg border border-gray-100 bg-white text-[11px]">
            <span className="text-gray-400 tabular-nums w-16">{formatTime(e.event_ts)}</span>
            <span className="text-gray-400 w-10 font-bold">{e.period}</span>
            <span className="flex-1 text-gray-700">{formatEventText(e)}</span>
            {e.edited_at && <span className="text-[9px] text-gray-400 italic">edited</span>}
            {canEdit && mine && (
              <div className="flex gap-1">
                <button onClick={() => setEditing(e)} className="text-[10px] text-gray-500 font-bold px-1.5 py-0.5 rounded bg-gray-50 active:bg-gray-100">Edit</button>
                <button onClick={() => deleteEvent(e)} className="text-[10px] text-red-600 font-bold px-1.5 py-0.5 rounded bg-red-50 active:bg-red-100">Del</button>
              </div>
            )}
          </div>
        );
      })}
      {editing && <EditEventModal ev={editing} onClose={() => setEditing(null)} onSave={updateEvent} />}
    </div>
  );
}

function EditEventModal({ ev, onClose, onSave }) {
  const [statType, setStatType] = useState(ev.stat_type);
  const [playerName, setPlayerName] = useState(ev.player_name || "");
  return (
    <ModalShell title="Edit event" onClose={onClose}>
      <label className="block text-[11px] text-gray-500 font-bold uppercase tracking-wide mb-1">Stat</label>
      <select value={statType} onChange={e => setStatType(e.target.value)}
        className="w-full py-2 px-2 rounded-xl border border-gray-200 bg-gray-50 text-sm mb-2">
        {STAT_BUTTONS.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
        <option value="reb">Rebound</option>
        <option value="ast">Assist</option>
      </select>
      <label className="block text-[11px] text-gray-500 font-bold uppercase tracking-wide mb-1">Player</label>
      <input value={playerName} onChange={e => setPlayerName(e.target.value)}
        className="w-full py-2 px-2 rounded-xl border border-gray-200 bg-gray-50 text-sm mb-3" />
      <div className="flex gap-2">
        <button onClick={onClose} className="flex-1 py-3 rounded-xl bg-gray-100 text-gray-700 font-bold text-sm active:bg-gray-200">Cancel</button>
        <button onClick={() => onSave(ev, { stat_type: statType, player_name: playerName })}
          className="flex-1 py-3 rounded-xl bg-gray-900 text-white font-bold text-sm active:bg-gray-800">Save</button>
      </div>
    </ModalShell>
  );
}

// ============================================================
// Admin review queue (approve ended games, writes to game_log)
// ============================================================
function ReviewQueue({ onBack, onOpen }) {
  const [games, setGames] = useState([]);
  const [loading, setLoading] = useState(true);
  const [needPw, setNeedPw] = useState(true);
  const [approving, setApproving] = useState(null);

  useEffect(() => {
    if (needPw) return;
    (async () => {
      setLoading(true);
      const { data: ended } = await supabase
        .from("live_games")
        .select("*, schedule!inner(*)")
        .eq("status", "ended");
      setGames(ended || []);
      setLoading(false);
    })();
  }, [needPw]);

  if (needPw) {
    return (
      <div>
        <BackRow onBack={onBack} />
        <AdminPasswordModal onClose={onBack} onOk={() => setNeedPw(false)}
          title="Admin password required" subtitle="Access the review queue." />
      </div>
    );
  }

  return (
    <div>
      <BackRow onBack={onBack} />
      <p className="text-xs text-gray-400 uppercase tracking-widest font-medium mb-3">Review Queue</p>
      {loading && <div className="text-center py-8 text-gray-400 text-sm">Loading...</div>}
      {!loading && games.length === 0 && (
        <div className="rounded-2xl border border-gray-100 bg-gray-50 p-6 text-center text-sm text-gray-500">
          No games waiting for approval.
        </div>
      )}
      {games.map(g => (
        <div key={g.game_id} className="rounded-2xl border border-gray-100 bg-white p-3 mb-2 flex items-center gap-2">
          <div className="flex-1">
            <div className="text-[10px] text-gray-400 uppercase tracking-wide">Week {g.schedule.week} &middot; {g.schedule.game_date}</div>
            <div className="text-sm font-bold text-gray-900">{g.schedule.away_team} at {g.schedule.home_team}</div>
          </div>
          <button onClick={() => onOpen(g.game_id)} className="text-[11px] font-bold text-white px-3 py-1.5 rounded-lg bg-gray-900 active:bg-gray-800">Open</button>
          <button onClick={() => setApproving(g)} className="text-[11px] font-bold text-green-700 px-3 py-1.5 rounded-lg bg-green-50 border border-green-200 active:bg-green-100">Approve</button>
        </div>
      ))}
      {approving && (
        <ApproveModal game={approving} onClose={() => setApproving(null)} onDone={() => { setApproving(null); setNeedPw(true); }} />
      )}
    </div>
  );
}

function ApproveModal({ game, onClose, onDone }) {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("live_events")
        .select("*")
        .eq("game_id", game.game_id)
        .order("event_ts", { ascending: true });
      setEvents(data || []);
      setLoading(false);
    })();
  }, [game.game_id]);

  const approve = async () => {
    // Compute box score from events -> insert rows into game_log table
    const { box } = computeBoxScore(events);
    const rows = Object.entries(box).map(([player, s]) => ({
      player, team: s.team,
      opp: s.team === game.schedule.home_team ? game.schedule.away_team : game.schedule.home_team,
      week: game.schedule.week, date: game.schedule.game_date,
      game_type: "R", g: 1,
      pts: s.pts, reb: s.reb, stl: s.stl, ast: s.ast, blk: s.blk,
      fgm: s.fgm, fga: s.fga, ftm: s.ftm, fta: s.fta, tpm: s.tpm, tpa: s.tpa,
      foul: s.foul, gmsc: 0, year: game.schedule.season,
    }));
    const { error } = await supabase.from("game_log").insert(rows);
    if (error) {
      alert("Error writing to game_log: " + error.message + "\n\nThis may mean the game_log table schema doesn't match. You can still mark approved.");
    }
    await supabase.from("live_games").update({
      status: "approved", approved_at: new Date().toISOString(), approved_by: "admin",
      updated_at: new Date().toISOString(),
    }).eq("game_id", game.game_id);
    await supabase.from("schedule").update({ status: "approved" }).eq("game_id", game.game_id);
    await supabase.from("audit_log").insert({
      game_id: game.game_id, action: "approve", after_value: { rows_written: rows.length },
    });
    onDone();
  };

  return (
    <ModalShell title="Approve and write to game_log" onClose={onClose}>
      {loading ? <div className="text-xs text-gray-400">Loading...</div> : (
        <div>
          <div className="text-xs text-gray-500 mb-3">
            {events.filter(e => !e.deleted).length} events. Open the game first to edit; tap &quot;Approve&quot; to write rows into the game_log table.
          </div>
          <button onClick={approve}
            className="w-full py-3 rounded-xl bg-gray-900 text-white font-bold text-sm active:bg-gray-800">
            Approve and write
          </button>
        </div>
      )}
    </ModalShell>
  );
}
