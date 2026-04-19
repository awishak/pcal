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

import React, { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { supabase } from "./supabase.js";

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

// Small team badge used where logos would live in the main app.
// LiveSection doesn't have access to the base64 logo strings baked into App.jsx,
// so it renders a colored circle with the team code. If logos are later passed
// in as a prop or via context, swap the inside of this component.
function TeamLogoLocal({ team, size = 24, className = "" }) {
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
// Stat type definitions: all events we can enter during a game
// ------------------------------------------------------------
const STAT_BUTTONS = [
  { key: "made_2",   label: "Made 2",   pts: 2, prompt: "assist",  color: "bg-gray-900 text-white" },
  { key: "missed_2", label: "Miss 2",   pts: 0, prompt: "rebound", color: "bg-gray-100 text-gray-700" },
  { key: "made_3",   label: "Made 3",   pts: 3, prompt: "assist",  color: "bg-gray-900 text-white" },
  { key: "missed_3", label: "Miss 3",   pts: 0, prompt: "rebound", color: "bg-gray-100 text-gray-700" },
  { key: "made_ft",  label: "Made FT",  pts: 1, prompt: null,      color: "bg-gray-900 text-white" },
  { key: "missed_ft",label: "Miss FT",  pts: 0, prompt: "rebound", color: "bg-gray-100 text-gray-700" },
  { key: "stl",      label: "Steal",    pts: 0, prompt: null,      color: "bg-gray-100 text-gray-700" },
  { key: "blk",      label: "Block",    pts: 0, prompt: null,      color: "bg-gray-100 text-gray-700" },
  { key: "foul",     label: "Foul",     pts: 0, prompt: null,      color: "bg-gray-100 text-gray-700" },
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
      // e.scorer_name holds new period
      if (e.player_name === "H2" || e.player_name === "Halftime") currentHalf = "H2";
      else if (e.player_name === "H1") currentHalf = "H1";
      // OT counts as its own "half" for team-foul reset purposes
      if (e.player_name && e.player_name.startsWith("OT")) {
        currentHalf = e.player_name;
        teamFoulsThisHalf[currentHalf] = {};
      }
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

  return { box, teamScore, teamFoulsThisHalf, currentHalf };
}

// ------------------------------------------------------------
// Main Live Section
// ------------------------------------------------------------
export default function LiveSection({ initialGameId = null, onConsumeInitialGameId = () => {} } = {}) {
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

  const { box, teamScore, teamFoulsThisHalf, currentHalf } = useMemo(() => computeBoxScore(events), [events]);

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

      {/* Scoreboard */}
      <Scoreboard
        game={game}
        live={live}
        teamScore={teamScore}
        teamFoulsThisHalf={teamFoulsThisHalf}
        currentHalf={currentHalf}
        topScorerByTeam={topScorerByTeam}
        events={events}
      />

      {/* Mode tabs */}
      <div className="flex gap-1.5 mb-3">
        {["score","box","log"].map(m => (
          <button key={m} onClick={() => setMode(m)}
            className={`flex-1 py-2 rounded-lg text-xs font-bold transition-colors ${mode === m ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-600"}`}>
            {m === "score" ? "Scoreboard" : m === "box" ? "Box Score" : "Play-by-play"}
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
          teamScore={teamScore}
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
function Scoreboard({ game, live, teamScore, teamFoulsThisHalf, currentHalf, topScorerByTeam, events }) {
  const home = game.home_team;
  const away = game.away_team;
  const hs = teamScore[home] || 0;
  const as = teamScore[away] || 0;
  const homeColor = TEAM_COLORS[home] || "#111827";
  const awayColor = TEAM_COLORS[away] || "#111827";
  const period = live?.period || "H1";
  const periodLabel = period === "Halftime" ? "Halftime" : period;

  const homeFouls = teamFoulsThisHalf?.[currentHalf]?.[home] || 0;
  const awayFouls = teamFoulsThisHalf?.[currentHalf]?.[away] || 0;
  const homeTimeouts = live?.home_timeouts_remaining ?? 3;
  const awayTimeouts = live?.away_timeouts_remaining ?? 3;

  // Last play
  const lastPlay = useMemo(() => {
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i];
      if (e.deleted) continue;
      if (["made_2","made_3","made_ft","stl","blk","foul"].includes(e.stat_type)) return e;
    }
    return null;
  }, [events]);

  return (
    <div className="rounded-2xl overflow-hidden mb-3 border border-gray-200 bg-white">
      <div className="p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">{periodLabel}</div>
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
             live?.status === "halftime" ? <span className="text-gray-500">HALFTIME</span> :
             <span className="text-gray-400">SCHEDULED</span>}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {/* Away */}
          <TeamScorePanel team={away} score={as} color={awayColor}
            fouls={awayFouls} timeouts={awayTimeouts} topScorer={topScorerByTeam[away]} />
          {/* Home */}
          <TeamScorePanel team={home} score={hs} color={homeColor}
            fouls={homeFouls} timeouts={homeTimeouts} topScorer={topScorerByTeam[home]} />
        </div>
        {lastPlay && (
          <div className="mt-3 pt-3 border-t border-gray-100 text-[11px] text-gray-600">
            <span className="text-gray-400 mr-1">Last:</span>
            {formatEventText(lastPlay)}
          </div>
        )}
      </div>
    </div>
  );
}

function TeamScorePanel({ team, score, color, fouls, timeouts, topScorer }) {
  const foulRed = fouls >= 10;
  return (
    <div className="rounded-xl p-3 bg-gray-50 border border-gray-100">
      <div className="flex items-center gap-1.5 mb-1">
        <TeamLogoLocal team={team} size={18} />
        <span className="text-sm font-bold text-gray-900">{team}</span>
      </div>
      <div className="text-4xl font-black text-gray-900 leading-none tracking-tight">{score}</div>
      <div className="mt-2 flex items-center gap-2 text-[10px]">
        <span className={`font-bold ${foulRed ? "text-red-600" : "text-gray-500"}`}>
          FOULS {fouls}
        </span>
        <span className="text-gray-300">|</span>
        <span className="font-bold text-gray-500">TO {timeouts}</span>
      </div>
      {topScorer && topScorer.pts > 0 && (
        <div className="mt-1 text-[10px] text-gray-500 truncate">
          {formatName(topScorer.name)} {topScorer.pts}pts
        </div>
      )}
    </div>
  );
}

// ============================================================
// Scorer controls: team claim, stat entry with rebound/assist
// prompts, undo, game state buttons
// ============================================================
function ScorerControls({ game, live, events, rosters, me, myRole, onReload, currentHalf, teamFoulsThisHalf, teamScore }) {
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

  // ---- Undo last (own events only) ----
  const undoLast = async () => {
    const mine = events.filter(e => !e.deleted && e.scorer_pin === me?.pin && e.stat_type !== "period_change" && e.stat_type !== "game_start" && e.stat_type !== "game_end");
    if (mine.length === 0) return;
    const last = mine[mine.length - 1];
    const { error } = await supabase.from("live_events").update({
      deleted: true, edited_at: new Date().toISOString(), edited_by: me.name,
    }).eq("event_id", last.event_id);
    if (error) { alert(error.message); return; }
    await supabase.from("audit_log").insert({
      game_id: game.game_id, actor_pin: me.pin, actor_name: me.name,
      action: "undo", event_id: last.event_id, before_value: last,
    });
  };

  // ---- Period/state controls ----
  const endFirstHalf = async () => {
    if (!confirm("End 1st half?")) return;
    await supabase.from("live_games").update({ period: "Halftime", status: "halftime", updated_at: new Date().toISOString() }).eq("game_id", game.game_id);
    await supabase.from("live_events").insert({ game_id: game.game_id, period: "Halftime", stat_type: "period_change", player_name: "Halftime", scorer_pin: me.pin, scorer_name: me.name });
  };
  const startSecondHalf = async () => {
    // Reset timeouts per half? PCAL rule was 3 per half, no carryover
    await supabase.from("live_games").update({
      period: "H2", status: "live",
      home_timeouts_remaining: 3, away_timeouts_remaining: 3,
      updated_at: new Date().toISOString(),
    }).eq("game_id", game.game_id);
    await supabase.from("live_events").insert({ game_id: game.game_id, period: "H2", stat_type: "period_change", player_name: "H2", scorer_pin: me.pin, scorer_name: me.name });
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
          return (
            <div key={t} className="flex items-center gap-2 py-2">
              <div className="flex-1">
                <div className="text-sm font-bold" style={{ color: TEAM_COLORS[t] || "#111827" }}>{t}</div>
                <div className="text-[11px] text-gray-500">{taken ? formatName(takenBy) : "Unclaimed"}</div>
              </div>
              {taken ? (
                <button onClick={() => requestTakeover(t)}
                  className="text-[11px] font-bold text-red-700 px-2 py-1 rounded bg-red-50 active:bg-red-100 border border-red-200">
                  Take over
                </button>
              ) : (
                <button onClick={() => claimTeam(t)}
                  className="text-[11px] font-bold text-white px-2 py-1 rounded bg-gray-900 active:bg-gray-800">
                  Claim
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
    return (
      <div className="space-y-3">
        {/* State control bar */}
        <div className="flex gap-1.5 flex-wrap">
          {(live.period === "H1" || live.period === "H2" || live.period?.startsWith("OT")) && (
            <>
              {live.period === "H1" && (
                <button onClick={endFirstHalf} className="text-[11px] font-bold px-3 py-1.5 rounded-lg bg-gray-100 text-gray-700 active:bg-gray-200">End 1st half</button>
              )}
              {live.period === "Halftime" && (
                <button onClick={startSecondHalf} className="text-[11px] font-bold px-3 py-1.5 rounded-lg bg-gray-900 text-white active:bg-gray-800">Start 2nd half</button>
              )}
              {(live.period === "H2" || live.period?.startsWith("OT")) && (
                <button onClick={endGameOrStartOT} className="text-[11px] font-bold px-3 py-1.5 rounded-lg bg-red-600 text-white active:bg-red-700">End game</button>
              )}
            </>
          )}
          {live.period === "Halftime" && (
            <button onClick={startSecondHalf} className="text-[11px] font-bold px-3 py-1.5 rounded-lg bg-gray-900 text-white active:bg-gray-800">Start 2nd half</button>
          )}
          {gameIsOver && (
            <button onClick={reopenGame} className="text-[11px] font-bold px-3 py-1.5 rounded-lg bg-gray-100 text-gray-700 active:bg-gray-200">Reopen</button>
          )}
          <div className="flex-1" />
          <button onClick={undoLast} className="text-[11px] font-bold px-3 py-1.5 rounded-lg bg-gray-100 text-gray-700 active:bg-gray-200">Undo last</button>
        </div>

        {gameIsOver && (
          <div className="rounded-xl border border-gray-100 bg-gray-50 p-3 text-[11px] text-gray-500">
            Game ended. Tap &quot;Reopen&quot; (requires admin) to edit.
          </div>
        )}

        {/* Stat buttons */}
        {!gameIsOver && (
          <>
            <div>
              <div className="text-[11px] text-gray-500 font-semibold uppercase tracking-wide mb-2">
                1. Tap stat &middot; {myTeamCode}
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                {STAT_BUTTONS.map(s => {
                  const active = pendingStat?.key === s.key;
                  return (
                    <button key={s.key} onClick={() => tapStat(s.key)}
                      className={`py-3 rounded-xl text-xs font-bold transition-all border ${
                        active ? "bg-gray-900 text-white border-gray-900 ring-2 ring-gray-900/20" :
                        s.color + " border-transparent active:bg-gray-200"
                      }`}>
                      {s.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Roster (2. tap player) */}
            <div>
              <div className="text-[11px] text-gray-500 font-semibold uppercase tracking-wide mb-2">
                2. Tap player
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                {myRoster.map(p => (
                  <button key={p.roster_id}
                    disabled={!pendingStat || promptMode}
                    onClick={() => tapPlayerForStat(p)}
                    className="py-3 px-2 rounded-xl bg-white border border-gray-200 text-left active:bg-gray-50 disabled:opacity-40 disabled:active:bg-white">
                    <div className="text-xs font-bold text-gray-900 truncate">{formatName(p.player_name)}</div>
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

        {/* Rebound/assist prompt overlay */}
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
              {myRoster.map(p => (
                <button key={p.roster_id} onClick={() => chooseReboundPlayer(p)}
                  className="py-3 px-2 rounded-xl bg-white border border-gray-200 text-left active:bg-gray-50">
                  <div className="text-xs font-bold text-gray-900 truncate">{formatName(p.player_name)}</div>
                </button>
              ))}
            </div>
          </ModalShell>
        )}

        {promptMode === "assist" && (
          <ModalShell title="Assisted by?" onClose={cancelPrompt}>
            <div className="grid grid-cols-2 gap-1.5 max-h-80 overflow-y-auto">
              {myRoster
                .filter(p => p.player_name !== pendingStat?.shooter?.player_name)
                .map(p => (
                  <button key={p.roster_id} onClick={() => chooseAssist("player", p)}
                    className="py-3 px-2 rounded-xl bg-white border border-gray-200 text-left active:bg-gray-50">
                    <div className="text-xs font-bold text-gray-900 truncate">{formatName(p.player_name)}</div>
                  </button>
                ))}
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
    foul: `${name} foul`,
    period_change: `-- ${e.player_name} --`,
    game_start: "Game started",
    game_end: "Game ended",
    reopen: "Game reopened",
    timeout: `${e.team} timeout`,
  };
  const base = map[e.stat_type] || e.stat_type;
  const teamTag = e.team ? `(${e.team})` : "";
  return `${base} ${teamTag}`.trim();
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
