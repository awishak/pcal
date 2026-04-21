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
import { supabase, adminInsertGameLog, adminDeleteGameLogForGame, bumpGameLogCache,
  requestLoginCode, verifyLoginCode, signOutUser, getCurrentSession, onAuthStateChange } from "./supabase.js";

// Context carries the base64 team logo map from App.jsx down to
// components that need to render logos. Falls back to null (colored
// circle fallback) if LiveSection was instantiated without a logos prop.
const LogosContext = createContext(null);
const useLogos = () => useContext(LogosContext);

// Context carries player photo URLs keyed by "LASTNAME Firstname" (matching
// rosters.player_name). Fetched from the player_photos table in LiveGameView
// at load time. Falls back to initials avatar when a key is missing.
const PhotosContext = createContext({});
const usePhotos = () => useContext(PhotosContext);

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

// The six teams participating in the 2026 season. Used for the team
// filter pill row on the Games page.
const TEAMS_2026 = ["SAC", "PDF", "MOD", "SJO", "HAY", "PLE"];

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

// PCAL Game Score formula. Derived from historical data by matching the
// stored `gmsc` value across 21 seasons of game_log rows. Equals Hollinger's
// standard GmSc with two notable differences: (a) rebound weight is 0.5 (no
// ORB/DRB split since we only track total REB), and (b) missed free throws
// ADD 0.4 rather than subtract, which is non-standard but is how every
// historical PCAL row was computed.
//
//   GmSc = PTS + 0.4*FGM - 0.7*FGA + 0.4*(FTA-FTM)
//        + 0.5*REB + STL + 0.7*AST + 0.7*BLK - 0.4*PF
//
// Returns a number rounded to one decimal place, matching the stored format.
function computeGmSc(s) {
  const v = (
    (s.pts || 0)
    + 0.4 * (s.fgm || 0)
    - 0.7 * (s.fga || 0)
    + 0.4 * ((s.fta || 0) - (s.ftm || 0))
    + 0.5 * (s.reb || 0)
    + (s.stl || 0)
    + 0.7 * (s.ast || 0)
    + 0.7 * (s.blk || 0)
    - 0.4 * (s.foul || 0)
  );
  return Math.round(v * 10) / 10;
}

// Convert a Supabase DATE string ("2026-06-15") to the short M/D format
// that historical game_log rows use ("6/15"). No zero-padding on month or
// day, matching the existing data shape.
function formatGameDateShort(isoDate) {
  if (!isoDate) return "";
  const parts = String(isoDate).split("-");
  if (parts.length !== 3) return isoDate;
  const month = parseInt(parts[1], 10);
  const day = parseInt(parts[2], 10);
  return `${month}/${day}`;
}

// ------------------------------------------------------------
// Stat type definitions: all events we can enter during a game.
// Grid is 3x4 (rows of 3,3,4), row-major. Row 1: makes (green).
// Row 2: misses (red). Row 3: REB/STL/BLK/FOUL (gray, 4-across).
// ------------------------------------------------------------
const STAT_BUTTONS = [
  { key: "made_2",   label: "Made 2",   pts: 2, prompt: "assist",  color: "bg-green-500 text-white", activeRing: "ring-green-300" },
  { key: "made_3",   label: "Made 3",   pts: 3, prompt: "assist",  color: "bg-green-500 text-white", activeRing: "ring-green-300" },
  { key: "made_ft",  label: "Made FT",  pts: 1, prompt: null,      color: "bg-green-500 text-white", activeRing: "ring-green-300" },
  { key: "missed_2", label: "Miss 2",   pts: 0, prompt: "rebound", color: "bg-red-500 text-white",   activeRing: "ring-red-300" },
  { key: "missed_3", label: "Miss 3",   pts: 0, prompt: "rebound", color: "bg-red-500 text-white",   activeRing: "ring-red-300" },
  { key: "missed_ft",label: "Miss FT",  pts: 0, prompt: "rebound", color: "bg-red-500 text-white",   activeRing: "ring-red-300" },
  { key: "reb",      label: "REB",      pts: 0, prompt: null,      color: "bg-gray-100 text-gray-700", activeRing: "ring-gray-300" },
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

// For a given stat key, return { count, label } to render on the player card.
// ALL shot-related stats (makes, misses, free throws) surface the player's
// total points, not shot counts. Defensive/bucket stats show their own count.
// Label is pluralized ("1 pt" / "2 pts").
function statLabelForPlayer(statKey, boxEntry) {
  if (!boxEntry) return { count: 0, label: "0 pts" };
  const SHOT_KEYS = new Set(["made_2","made_3","made_ft","missed_2","missed_3","missed_ft"]);
  if (SHOT_KEYS.has(statKey)) {
    const n = boxEntry.pts || 0;
    return { count: n, label: `${n} pt${n === 1 ? "" : "s"}` };
  }
  if (statKey === "reb") {
    const n = boxEntry.reb || 0;
    return { count: n, label: `${n} rebound${n === 1 ? "" : "s"}` };
  }
  if (statKey === "stl") {
    const n = boxEntry.stl || 0;
    return { count: n, label: `${n} steal${n === 1 ? "" : "s"}` };
  }
  if (statKey === "blk") {
    const n = boxEntry.blk || 0;
    return { count: n, label: `${n} block${n === 1 ? "" : "s"}` };
  }
  if (statKey === "foul") {
    const n = boxEntry.foul || 0;
    return { count: n, label: `${n} foul${n === 1 ? "" : "s"}` };
  }
  if (statKey === "ast") {
    const n = boxEntry.ast || 0;
    return { count: n, label: `${n} assist${n === 1 ? "" : "s"}` };
  }
  return { count: 0, label: "" };
}

// Legacy helper: raw count only, used for partition-by-has-stat logic.
function statCountForPlayer(statKey, boxEntry) {
  return statLabelForPlayer(statKey, boxEntry).count;
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

// Player avatar: photo if available via PhotosContext, otherwise a colored
// circle with the player's initials. Team color provides the backdrop so
// rosters stay visually cohesive.
function PlayerAvatar({ name, team, size = 40 }) {
  const photos = usePhotos();
  const url = photos?.[name];
  const parts = (name || "").trim().split(/\s+/);
  const lastInit = (parts[0]?.charAt(0) || "").toUpperCase();
  const firstInit = (parts[1]?.charAt(0) || "").toUpperCase();
  const initials = `${firstInit}${lastInit}`;
  const bg = TEAM_COLORS[team] || "#6b7280";
  const fg = textOnTeam(team);
  if (url) {
    return (
      <img src={url} alt={name}
        style={{ width: size, height: size, objectFit: "cover" }}
        className="rounded-full border border-gray-200 flex-shrink-0 bg-gray-100"
        onError={(e) => { e.currentTarget.style.display = "none"; }}
      />
    );
  }
  return (
    <div
      className="rounded-full flex items-center justify-center flex-shrink-0 border border-gray-200"
      style={{ width: size, height: size, backgroundColor: bg }}
    >
      <span style={{ fontSize: Math.max(9, size * 0.36), color: fg }} className="font-black">
        {initials}
      </span>
    </div>
  );
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
  const logout = async () => {
    localStorage.removeItem("pcal_me");
    setMe(null);
    // Sign out of Supabase Auth so the session is fully cleared.
    await signOutUser();
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
          <LiveGameView gameId={activeGameId} me={me} onLogin={login} onBack={() => { setView("home"); setActiveGameId(null); }} />
        )}
        {view === "review" && (
          <ReviewQueue onBack={() => setView("home")} onOpen={openGame} />
        )}
      </div>
    </LogosContext.Provider>
  );
}

// ============================================================
// Live Home: Games page with current-window scoreboard, upcoming
// 2026 games, and past 2026 games.
// ============================================================
function LiveHome({ me, onLogin, onLogout, onOpenGame, onReview }) {
  // allGames: full 2026 season from schedule.
  // liveStates: game_id -> live_games row (used for live/ended status + scorer names)
  // liveScores: game_id -> { [team]: points } derived from live_events
  const [allGames, setAllGames] = useState([]);
  const [liveStates, setLiveStates] = useState({});
  const [liveScores, setLiveScores] = useState({});
  const [loading, setLoading] = useState(true);
  const [showLogin, setShowLogin] = useState(false);
  // Team filter: when null, show all games. When set to a team code, only
  // show games where that team is playing OR scoring. Scoring-only games
  // get the light yellow highlight treatment in MiniGameCard.
  const [teamFilter, setTeamFilter] = useState(null);

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
      setAllGames([]); setLoading(false); return;
    }

    const games = sched || [];
    setAllGames(games);

    // Fetch live_games rows for all games that have started or might be live.
    // In practice we only need rows for games within the current-window
    // (live cards) and ended games (to show FINAL + final scores). For
    // simplicity we fetch all game_ids and let the consumer filter.
    const ids = games.map(g => g.game_id);
    let live = {};
    if (ids.length) {
      const { data: lg } = await supabase
        .from("live_games")
        .select("*")
        .in("game_id", ids);
      (lg || []).forEach(row => { live[row.game_id] = row; });
    }
    setLiveStates(live);

    // For games with live state (live, halftime, ended, approved), sum
    // scoring events to compute team scores.
    const gameIdsWithState = Object.keys(live).map(id => parseInt(id, 10));
    if (gameIdsWithState.length > 0) {
      const { data: evs } = await supabase
        .from("live_events")
        .select("game_id, team, stat_type, deleted")
        .in("game_id", gameIdsWithState)
        .in("stat_type", ["made_2", "made_3", "made_ft"]);
      const scoreMap = {};
      (evs || []).forEach(ev => {
        if (ev.deleted) return;
        if (!ev.team) return;
        if (!scoreMap[ev.game_id]) scoreMap[ev.game_id] = {};
        const pts = ev.stat_type === "made_3" ? 3 : ev.stat_type === "made_2" ? 2 : 1;
        scoreMap[ev.game_id][ev.team] = (scoreMap[ev.game_id][ev.team] || 0) + pts;
      });
      setLiveScores(scoreMap);
    } else {
      setLiveScores({});
    }
    setLoading(false);
  }, []);

  useEffect(() => { loadGames(); }, [loadGames]);

  // Subscribe to live_games changes so statuses update in real time.
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

  // Bucket games into three groups:
  //   currentWindow: games within 96 hours past or future, not yet approved.
  //                  These get the fancy live-scoreboard card at top.
  //   upcoming: future 2026 games outside the current window.
  //   past: 2026 games in the past with status = approved or ended.
  //
  // If a team filter is active, we include games where that team is
  // playing OR scoring. Scoring-only games still appear but with a light
  // yellow highlight (handled in MiniGameCard via highlightScoring prop).
  const { currentWindow, upcoming, past } = useMemo(() => {
    const cw = [];
    const up = [];
    const pa = [];
    const now = Date.now();
    const matchesFilter = (g) => {
      if (!teamFilter) return true;
      return g.home_team === teamFilter || g.away_team === teamFilter || g.scoring_team === teamFilter;
    };
    allGames.forEach(g => {
      if (!matchesFilter(g)) return;
      const inWindow = within96Hours(g.game_date, g.game_time);
      const isApproved = g.status === "approved";
      const isEnded = g.status === "ended";
      const gameTs = new Date(`${g.game_date}T${g.game_time}`).getTime();
      if (inWindow && !isApproved) {
        cw.push(g);
      } else if (gameTs > now && !isApproved && !isEnded) {
        up.push(g);
      } else {
        pa.push(g);
      }
    });
    // Past games newest first for quick reference.
    pa.sort((a, b) => {
      const aTs = new Date(`${a.game_date}T${a.game_time}`).getTime();
      const bTs = new Date(`${b.game_date}T${b.game_time}`).getTime();
      return bTs - aTs;
    });
    return { currentWindow: cw, upcoming: up, past: pa };
  }, [allGames, teamFilter]);

  // For the current-window section, pick the earliest week represented.
  // This mirrors the home-page LiveHomeCard behavior: show one week's
  // worth of games, not a rolling 96-hour mixed batch across weeks.
  const currentWeekGames = useMemo(() => {
    if (currentWindow.length === 0) return [];
    const first = currentWindow[0];
    return currentWindow.filter(g => g.season === first.season && g.week === first.week);
  }, [currentWindow]);

  const fmtDate = (d) => {
    if (!d) return "";
    const dt = new Date(d + "T12:00:00");
    return dt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  };

  return (
    <div>
      {/* Tentative-schedule warning banner. Shown at the very top of the
          Games page until the schedule is finalized. Remove or toggle via
          code change once finalized. */}
      <div className="mb-4 rounded-2xl bg-amber-50 border border-amber-200 p-3 flex items-start gap-2">
        <svg className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
        <p className="text-xs text-amber-800 font-medium leading-relaxed">
          This is a tentative schedule with placeholder games. The schedule will be confirmed in late May.
        </p>
      </div>

      {loading && <div className="text-center py-8 text-gray-400 text-sm">Loading...</div>}

      {/* Team filter: pill row. Tap a team to show only their games
          (plus any games they're scoring, highlighted in yellow). */}
      {!loading && allGames.length > 0 && (
        <div className="mb-4 flex gap-1 flex-wrap">
          <button
            onClick={() => setTeamFilter(null)}
            className={`px-2.5 py-1.5 rounded-lg text-xs font-bold flex-shrink-0 transition ${
              teamFilter === null ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-600"
            }`}>
            All
          </button>
          {TEAMS_2026.map(t => {
            const active = teamFilter === t;
            return (
              <button key={t} onClick={() => setTeamFilter(active ? null : t)}
                className={`px-2 py-1.5 rounded-lg text-xs font-bold flex-shrink-0 flex items-center gap-1 transition ${
                  active ? "text-white" : "bg-gray-100 text-gray-600"
                }`}
                style={active ? { backgroundColor: TEAM_COLORS[t] || "#374151" } : {}}>
                <TeamLogoLocal team={t} size={16} />
                {t}
              </button>
            );
          })}
        </div>
      )}

      {!loading && allGames.length === 0 && (
        <div className="rounded-2xl border border-gray-100 bg-gray-50 p-6 text-center">
          <div className="text-sm text-gray-500">No 2026 games scheduled yet.</div>
        </div>
      )}

      {!loading && allGames.length > 0 && currentWeekGames.length === 0 && upcoming.length === 0 && past.length === 0 && (
        <div className="rounded-2xl border border-gray-100 bg-gray-50 p-6 text-center">
          <div className="text-sm text-gray-500">No games for this team.</div>
        </div>
      )}

      {/* ===== CURRENT WINDOW ===== */}
      {!loading && currentWeekGames.length > 0 && (
        <div className="mb-5">
          <LiveWeekCard
            games={currentWeekGames}
            liveStates={liveStates}
            liveScores={liveScores}
            onOpenGame={onOpenGame}
            fmtDate={fmtDate}
            activeTeamFilter={teamFilter}
          />
        </div>
      )}

      {/* ===== UPCOMING ===== */}
      {!loading && upcoming.length > 0 && (
        <div className="mb-5">
          <div className="text-[11px] text-gray-500 font-semibold uppercase tracking-wide mb-2">Upcoming 2026</div>
          <UpcomingByWeek games={upcoming} onOpenGame={onOpenGame} fmtDate={fmtDate} activeTeamFilter={teamFilter} />
        </div>
      )}

      {/* ===== PAST ===== */}
      {!loading && past.length > 0 && (
        <div className="mb-5">
          <div className="text-[11px] text-gray-500 font-semibold uppercase tracking-wide mb-2">Past 2026</div>
          <PastByWeek games={past} liveStates={liveStates} liveScores={liveScores} onOpenGame={onOpenGame} fmtDate={fmtDate} activeTeamFilter={teamFilter} />
        </div>
      )}

      {/* Admin review link at the bottom of the page (moved from top to
          declutter the header; admin review is rare and doesn't need to
          be prominent). */}
      <div className="mt-8 pt-4 border-t border-gray-100 flex items-center justify-center">
        <button onClick={onReview} className="text-[10px] text-gray-300 hover:text-gray-500">
          Admin review
        </button>
      </div>

      {showLogin && <LoginModal onClose={() => setShowLogin(false)} onLogin={(p) => { onLogin(p); setShowLogin(false); }} />}
    </div>
  );
}

// ============================================================
// LiveWeekCard: current week's games with the fancy "LIVE" full-width
// card for any in-progress game plus a mini-grid for the rest. Mirrors
// the style of the home-page LiveHomeCard in App.jsx.
//
// The header is a full-width banner with date + location prominently
// displayed, with the week number as a smaller eyebrow above.
// ============================================================
function LiveWeekCard({ games, liveStates, liveScores, onOpenGame, fmtDate, activeTeamFilter }) {
  const liveGame = games.find(g => (liveStates[g.game_id]?.status || g.status) === "live");
  const otherGames = liveGame ? games.filter(g => g.game_id !== liveGame.game_id) : games;
  const weekMeta = games[0];
  const weekLabel = weekMeta.week === 0 ? "Preseason" : `Week ${weekMeta.week}`;

  return (
    <div className="rounded-2xl bg-white border border-gray-200 p-4">
      {/* Prominent week header: eyebrow + big date + location */}
      <div className="mb-4">
        <p className="text-[10px] uppercase tracking-widest text-gray-400 font-bold">This Week &middot; {weekLabel}</p>
        <h3 className="text-lg font-black text-gray-900 mt-0.5 leading-tight">{fmtDate(weekMeta.game_date)}</h3>
        {weekMeta.location && (
          <p className="text-sm text-gray-600 font-semibold mt-0.5">{weekMeta.location}</p>
        )}
      </div>

      {liveGame && (
        <LiveFullCard
          game={liveGame}
          liveState={liveStates[liveGame.game_id]}
          scores={liveScores[liveGame.game_id]}
          onTap={() => onOpenGame(liveGame.game_id)}
        />
      )}

      {otherGames.length > 0 && (
        <div className={`grid gap-1.5 ${liveGame ? "mt-3" : ""}`}
             style={{ gridTemplateColumns: `repeat(${Math.min(otherGames.length, 3)}, minmax(0, 1fr))` }}>
          {otherGames.map(g => (
            <MiniGameCard
              key={g.game_id}
              game={g}
              liveState={liveStates[g.game_id]}
              scores={liveScores[g.game_id]}
              onTap={() => onOpenGame(g.game_id)}
              highlightScoring={activeTeamFilter && g.scoring_team === activeTeamFilter && g.home_team !== activeTeamFilter && g.away_team !== activeTeamFilter}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================
// LiveFullCard: pulsing-red card shown when a game is currently live.
// ============================================================
function LiveFullCard({ game, liveState, scores, onTap }) {
  const home = game.home_team;
  const away = game.away_team;
  const homeScore = (scores && scores[home]) || 0;
  const awayScore = (scores && scores[away]) || 0;
  const period = (liveState && liveState.period) || "H1";
  const homeName = TEAM_NAMES[home] || home;
  const awayName = TEAM_NAMES[away] || away;
  const formatScorer = (n) => {
    if (!n) return null;
    const p = n.trim().split(/\s+/);
    if (p.length < 2) return n;
    const last = p[0];
    const first = p.slice(1).join(" ");
    const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
    return `${first.charAt(0).toUpperCase()}. ${cap(last)}`;
  };
  const homeScorer = formatScorer(liveState && liveState.home_scorer_name);
  const awayScorer = formatScorer(liveState && liveState.away_scorer_name);

  const TeamRow = ({ code, name, score, scorer }) => (
    <div className="flex items-center gap-3">
      <TeamLogoLocal team={code} size={36} />
      <div className="flex-1 min-w-0">
        <div className="text-base font-black text-gray-900 truncate leading-tight">{name}</div>
        <div className="text-[9px] text-gray-500 truncate leading-tight">
          {scorer ? (
            <>Scored by: <span className="text-gray-700">{scorer}</span></>
          ) : (
            <span className="text-gray-300">No scorer yet</span>
          )}
        </div>
      </div>
      <span className="text-3xl font-black tabular-nums text-gray-900">{score}</span>
    </div>
  );

  return (
    <button onClick={onTap}
      className="w-full rounded-xl border-2 border-red-500 bg-white p-3 text-left active:scale-[0.99] transition">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-1.5">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
          </span>
          <span className="text-[10px] font-black uppercase tracking-widest text-red-600">Live</span>
          <span className="text-[10px] text-gray-400 ml-1">{period}</span>
        </div>
        <span className="text-[10px] text-gray-400">Tap to view</span>
      </div>
      <div className="space-y-2">
        <TeamRow code={away} name={awayName} score={awayScore} scorer={awayScorer} />
        <TeamRow code={home} name={homeName} score={homeScore} scorer={homeScorer} />
      </div>
    </button>
  );
}

// ============================================================
// MiniGameCard: small card showing matchup + time (or final score).
// Used in the week card grid and in upcoming/past lists.
//
// Visual notes:
//   - Team codes at text-xs (12px, bumped from 10px).
//   - Time at text-sm formatted as "3pm" (bumped from 11px "3p").
//   - Always shows the scoring team label below the matchup.
//   - When `highlightScoring` is true (the scoring team matches the
//     active team filter), the card renders with a light yellow
//     background to distinguish scoring duty from playing.
// ============================================================
function MiniGameCard({ game, liveState, scores, onTap, highlightScoring = false }) {
  const home = game.home_team;
  const away = game.away_team;
  const status = liveState?.status || game.status;
  const isEnded = status === "ended" || status === "approved";
  const homeScore = (scores && scores[home]) || 0;
  const awayScore = (scores && scores[away]) || 0;
  const homeWon = isEnded && homeScore > awayScore;
  const awayWon = isEnded && awayScore > homeScore;
  const timeStr = (() => {
    if (!game.game_time) return "";
    const [hh, mm] = game.game_time.split(":");
    const h = parseInt(hh, 10);
    const hour12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
    const ampm = h >= 12 ? "pm" : "am";
    return `${hour12}${ampm}`;
  })();

  const teamRow = (team, score, won, showScore) => (
    <div className="flex items-center justify-between gap-1">
      <div className="flex items-center gap-1.5">
        <TeamLogoLocal team={team} size={20} />
        <span className="text-xs font-black text-gray-900">{team}</span>
      </div>
      {showScore && (
        <div className="flex items-center gap-0.5">
          {won && (
            <svg className="w-2.5 h-2.5 text-gray-900" viewBox="0 0 8 8" fill="currentColor">
              <path d="M0 1 L8 4 L0 7 Z" />
            </svg>
          )}
          <span className={`text-base font-black tabular-nums ${
            won ? "text-gray-900" : "text-gray-400"
          }`}>{score}</span>
        </div>
      )}
    </div>
  );

  // Card background: two states.
  //   isEnded: white with black border (completed game)
  //   default: light gray
  // Note: previously we highlighted the whole card yellow when filtered
  // to a team's scoring duties; now we always highlight the scoring team
  // label itself with a yellow pill regardless of filter. More scannable.
  const cardClass = isEnded
    ? "bg-white border-2 border-gray-900"
    : "bg-gray-50 border border-gray-200";

  return (
    <button onClick={onTap}
      className={`rounded-lg p-2 active:scale-95 transition flex flex-col items-center gap-1.5 ${cardClass}`}>
      <div className="flex items-center justify-center gap-1.5">
        <span className="text-sm text-gray-600 font-bold">{timeStr}</span>
        {isEnded && (
          <span className="text-xs font-black text-gray-900 uppercase tracking-wide">
            Final
          </span>
        )}
      </div>
      <div className="flex flex-col gap-1 w-full">
        {teamRow(away, awayScore, awayWon, isEnded)}
        {teamRow(home, homeScore, homeWon, isEnded)}
      </div>
      {/* Scoring team. Normally muted gray; turns yellow when a team
          filter is active and this is a game that team is scoring (not
          playing). Helps the scorekeeper's games stand out when drilling
          into one team. */}
      {game.scoring_team && (
        highlightScoring ? (
          <div className="mt-0.5 inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-yellow-100 border border-yellow-300 text-[10px]">
            <span className="uppercase tracking-wide text-yellow-800 font-bold">Scoring:</span>
            <TeamLogoLocal team={game.scoring_team} size={14} />
            <span className="font-black text-yellow-900">{game.scoring_team}</span>
          </div>
        ) : (
          <div className="mt-0.5 flex items-center gap-1 text-[10px] text-gray-500">
            <span className="uppercase tracking-wide">Scoring:</span>
            <TeamLogoLocal team={game.scoring_team} size={14} />
            <span className="font-bold text-gray-700">{game.scoring_team}</span>
          </div>
        )
      )}
    </button>
  );
}

// ============================================================
// UpcomingByWeek: future 2026 games, grouped by week, rendered as a
// header card per week with mini cards below. Matches LiveWeekCard's
// visual language (prominent date + location header, then grid).
// ============================================================
function UpcomingByWeek({ games, onOpenGame, fmtDate, activeTeamFilter }) {
  const byWeek = useMemo(() => {
    const m = new Map();
    games.forEach(g => {
      const k = g.week;
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(g);
    });
    return Array.from(m.entries()).sort((a, b) => a[0] - b[0]);
  }, [games]);

  return (
    <div className="space-y-3">
      {byWeek.map(([week, weekGames]) => {
        const first = weekGames[0];
        const weekLabel = week === 0 ? "Preseason" : `Week ${week}`;
        return (
          <div key={week} className="rounded-2xl bg-white border border-gray-200 p-4">
            <div className="mb-4">
              <p className="text-[10px] uppercase tracking-widest text-gray-400 font-bold">Upcoming &middot; {weekLabel}</p>
              <h3 className="text-lg font-black text-gray-900 mt-0.5 leading-tight">{fmtDate(first.game_date)}</h3>
              {first.location && (
                <p className="text-sm text-gray-600 font-semibold mt-0.5">{first.location}</p>
              )}
            </div>
            <div className="grid gap-1.5"
                 style={{ gridTemplateColumns: `repeat(${Math.min(weekGames.length, 3)}, minmax(0, 1fr))` }}>
              {weekGames.map(g => (
                <MiniGameCard
                  key={g.game_id}
                  game={g}
                  liveState={null}
                  scores={null}
                  onTap={() => onOpenGame(g.game_id)}
                  highlightScoring={activeTeamFilter && g.scoring_team === activeTeamFilter && g.home_team !== activeTeamFilter && g.away_team !== activeTeamFilter}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ============================================================
// PastByWeek: same visual as UpcomingByWeek but for ended/approved
// games. Mini cards will show FINAL + final scores thanks to live_states
// and live_scores props being populated.
// ============================================================
function PastByWeek({ games, liveStates, liveScores, onOpenGame, fmtDate, activeTeamFilter }) {
  const byWeek = useMemo(() => {
    const m = new Map();
    games.forEach(g => {
      const k = g.week;
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(g);
    });
    // Past: newest week first.
    return Array.from(m.entries()).sort((a, b) => b[0] - a[0]);
  }, [games]);

  return (
    <div className="space-y-3">
      {byWeek.map(([week, weekGames]) => {
        const first = weekGames[0];
        const weekLabel = week === 0 ? "Preseason" : `Week ${week}`;
        return (
          <div key={week} className="rounded-2xl bg-white border border-gray-200 p-4">
            <div className="mb-4">
              <p className="text-[10px] uppercase tracking-widest text-gray-400 font-bold">Past &middot; {weekLabel}</p>
              <h3 className="text-lg font-black text-gray-900 mt-0.5 leading-tight">{fmtDate(first.game_date)}</h3>
              {first.location && (
                <p className="text-sm text-gray-600 font-semibold mt-0.5">{first.location}</p>
              )}
            </div>
            <div className="grid gap-1.5"
                 style={{ gridTemplateColumns: `repeat(${Math.min(weekGames.length, 3)}, minmax(0, 1fr))` }}>
              {weekGames.map(g => (
                <MiniGameCard
                  key={g.game_id}
                  game={g}
                  liveState={liveStates[g.game_id]}
                  scores={liveScores[g.game_id]}
                  onTap={() => onOpenGame(g.game_id)}
                  highlightScoring={activeTeamFilter && g.scoring_team === activeTeamFilter && g.home_team !== activeTeamFilter && g.away_team !== activeTeamFilter}
                />
              ))}
            </div>
          </div>
        );
      })}
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
// Login modal: email OTP
// ============================================================
// Replaces the legacy PIN login. User enters their email, receives a
// 6-digit code (or magic link) via Supabase Auth, enters the code, and is
// signed in. We then look up their registration to get team info. The
// resulting "player" object has the same shape the old PIN flow produced
// so downstream code doesn't need changes.
//
// Scorer identity: instead of player_pin we use the Supabase user id as
// the scorer identifier. It gets stored in live_games.home_scorer_pin /
// away_scorer_pin (both text columns, so this works without a schema
// change). Events the scorer writes will have their user id in
// scorer_pin, which remains a stable per-user identifier.
function LoginModal({ onClose, onLogin }) {
  const [mode, setMode] = useState("email");          // 'email' | 'code'
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [status, setStatus] = useState("");

  const sendCode = async () => {
    const addr = email.trim().toLowerCase();
    if (!addr || !addr.includes("@")) {
      setErr("Enter a valid email address.");
      return;
    }
    setBusy(true); setErr(""); setStatus("");
    const res = await requestLoginCode(addr);
    setBusy(false);
    if (res.error) { setErr(res.error); return; }
    setEmail(addr);
    setStatus("Login code sent to " + addr + ".");
    setMode("code");
  };

  const submitCode = async () => {
    if (!code.trim()) return;
    setBusy(true); setErr("");
    const res = await verifyLoginCode(email, code);
    if (res.error) { setBusy(false); setErr(res.error); return; }

    // Logged in. Now look up the player's registration to get name/team.
    // Fall back to a generic record using just the email if they don't
    // have a registration (this covers scorekeepers, photographers, etc.).
    const { data: reg } = await supabase
      .from("registrations")
      .select("*")
      .eq("email", email)
      .limit(1);
    const user = res.user;
    const userId = user && user.id ? user.id : "auth-" + email;

    let record;
    if (reg && reg.length > 0) {
      const r = reg[0];
      record = {
        pin: userId,
        name: (r.first_name + " " + r.last_name).toUpperCase(),
        team: r.team_pref || "",
        season: CURRENT_SEASON,
        email: email,
      };
    } else {
      record = {
        pin: userId,
        name: email.split("@")[0].toUpperCase(),
        team: "",
        season: CURRENT_SEASON,
        email: email,
      };
    }

    setBusy(false);
    onLogin(record);
  };

  return (
    <ModalShell onClose={onClose} title={mode === "email" ? "Log in to score" : "Enter your code"}>
      {mode === "email" && (
        <>
          <div className="text-[11px] text-gray-500 mb-3">
            Enter your email to receive a login code.
          </div>
          <input
            type="email"
            autoFocus
            value={email}
            onChange={e => setEmail(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") sendCode(); }}
            disabled={busy}
            placeholder="you@example.com"
            className="w-full py-3 px-3 rounded-xl border border-gray-200 bg-gray-50 text-sm focus:outline-none focus:border-gray-900"
          />
          {err && <div className="text-xs text-red-600 mt-2">{err}</div>}
          <button onClick={sendCode} disabled={busy || !email}
            className="w-full mt-3 py-3 rounded-xl bg-emerald-500 text-white font-bold text-sm active:bg-emerald-600 disabled:bg-gray-200 disabled:text-gray-400">
            {busy ? "Sending..." : "Send code"}
          </button>
        </>
      )}

      {mode === "code" && (
        <>
          <div className="text-[11px] text-gray-500 mb-3">
            {status || ("Code sent to " + email + ".")}
            <br />
            You can also click the link in the email.
          </div>
          <input
            type="text"
            inputMode="numeric"
            autoFocus
            value={code}
            onChange={e => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            onKeyDown={e => { if (e.key === "Enter") submitCode(); }}
            disabled={busy}
            placeholder="6-digit code"
            className="w-full text-center text-2xl font-bold tracking-widest py-3 rounded-xl border border-gray-200 bg-gray-50 focus:outline-none focus:border-gray-900"
          />
          {err && <div className="text-xs text-red-600 mt-2">{err}</div>}
          <div className="flex gap-2 mt-3">
            <button onClick={() => { setMode("email"); setCode(""); setErr(""); }} disabled={busy}
              className="flex-1 py-3 rounded-xl bg-gray-100 text-gray-600 font-bold text-sm">
              Back
            </button>
            <button onClick={submitCode} disabled={busy || code.length < 6}
              className="flex-1 py-3 rounded-xl bg-emerald-500 text-white font-bold text-sm active:bg-emerald-600 disabled:bg-gray-200 disabled:text-gray-400">
              {busy ? "Checking..." : "Log in"}
            </button>
          </div>
          <div className="text-center mt-3">
            <button onClick={sendCode} disabled={busy}
              className="text-[10px] text-gray-400 hover:text-gray-600">
              Resend code
            </button>
          </div>
        </>
      )}
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
function LiveGameView({ gameId, me, onLogin, onBack }) {
  const [game, setGame] = useState(null);
  const [live, setLive] = useState(null);
  const [events, setEvents] = useState([]);
  const [rosters, setRosters] = useState({ home: [], away: [] });
  const [playerPhotos, setPlayerPhotos] = useState({}); // { "LASTNAME FIRSTNAME": image_url }
  const [mode, setMode] = useState("score"); // score | box | log
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Load game + state + events + rosters + player photos
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

    // Fetch player photos for both rosters. Keyed by player_name (the "id"
    // column in player_photos is the LASTNAME Firstname string matching
    // rosters.player_name). Missing rows fall back to initials avatar.
    const names = (rosterRows || []).map(r => r.player_name).filter(Boolean);
    let photoMap = {};
    if (names.length > 0) {
      const { data: photoRows } = await supabase
        .from("player_photos")
        .select("id,image_url")
        .in("id", names);
      for (const row of (photoRows || [])) {
        if (row.image_url) photoMap[row.id] = row.image_url;
      }
    }

    setGame(sch);
    setLive(lg);
    setEvents(evs || []);
    setRosters({ home, away });
    setPlayerPhotos(photoMap);
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
    <PhotosContext.Provider value={playerPhotos}>
      <div>
        <BackRow onBack={onBack} />

      {/* Compact matchup header: week & location on top, date + time on one line */}
      <div className="mb-3 text-center">
        <div className="text-[11px] font-bold text-gray-400 uppercase tracking-widest mb-1">
          Week {game.week === 0 ? "Preseason" : game.week}{game.location ? ` \u00b7 ${game.location}` : ""}
        </div>
        <div className="text-base font-black text-gray-900 leading-tight">
          {formatGameDate(game.game_date)}
          {" \u00b7 "}
          <span className="font-bold text-gray-700">{formatGameTime(game.game_time)}</span>
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
          onLogin={onLogin}
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
    </PhotosContext.Provider>
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
                    const milestone = milestoneForEvent(events, e);
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
                          {milestone && (
                            <span className="ml-1 inline-block px-1.5 py-0.5 rounded-full text-[9px] font-black bg-amber-500 text-white tabular-nums align-middle">
                              {milestone.label}
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

// For play-by-play: if this event caused the player's running total in the
// event's relevant stat to reach 10 or more, return { stat, label, count }.
// Otherwise return null. "keep going" semantics: shows up at 10, 11, 12, ...
function milestoneForEvent(events, target) {
  if (!target || !target.player_name || target.deleted) return null;
  const key = target.stat_type;
  const STAT_FIELD = {
    made_2: { pts: 2, field: "pts", singular: "pt", plural: "pts" },
    made_3: { pts: 3, field: "pts", singular: "pt", plural: "pts" },
    made_ft: { pts: 1, field: "pts", singular: "pt", plural: "pts" },
    reb: { field: "reb", singular: "rebound", plural: "rebounds" },
    ast: { field: "ast", singular: "assist", plural: "assists" },
    stl: { field: "stl", singular: "steal", plural: "steals" },
    blk: { field: "blk", singular: "block", plural: "blocks" },
  };
  const spec = STAT_FIELD[key];
  if (!spec) return null;
  // Sum prior contributions by this player in the relevant field
  let total = 0;
  for (const e of events) {
    if (e.deleted) continue;
    if (e.player_name !== target.player_name) continue;
    if (e.event_id === target.event_id) {
      // Include the target itself, then stop
      if (spec.pts != null) total += spec.pts;
      else if (e.stat_type === key) total += 1;
      break;
    }
    if (spec.field === "pts") {
      if (e.stat_type === "made_2") total += 2;
      else if (e.stat_type === "made_3") total += 3;
      else if (e.stat_type === "made_ft") total += 1;
    } else if (e.stat_type === key) {
      total += 1;
    }
  }
  if (total < 10) return null;
  return {
    stat: key,
    count: total,
    label: `${total} ${total === 1 ? spec.singular : spec.plural}`,
  };
}

// For play-by-play hot streak: was this event part of a 3-in-a-row (FGs only)
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
        <span className="text-[10px] font-bold text-red-600">
          No TO left
        </span>
      );
    }
    const remaining = 3 - usedCount;
    const pills = [];
    // Used pills on the left
    for (let i = 0; i < usedCount; i++) {
      pills.push(
        <div key={`u${i}`}
          className="relative w-6 h-6 rounded-md bg-gray-200 border border-gray-300 flex items-center justify-center flex-shrink-0"
          title="Used"
        >
          <svg viewBox="0 0 20 20" className="w-3 h-3 text-gray-400" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="5" y1="5" x2="15" y2="15" />
            <line x1="15" y1="5" x2="5" y2="15" />
          </svg>
        </div>
      );
    }
    // Remaining green pills, renumbered 1..remaining
    for (let i = 0; i < remaining; i++) {
      const label = i + 1;
      const isNext = i === 0;
      pills.push(
        <button key={`r${i}`}
          onClick={() => isNext && iCanTap && callTimeout(teamCode)}
          disabled={!isNext || !iCanTap}
          className={`w-6 h-6 rounded-md text-[10px] font-black flex items-center justify-center flex-shrink-0 transition-all ${
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
    <div className="rounded-xl border border-gray-200 bg-white px-3 py-2 mb-3 space-y-1.5">
      {/* Row 1: period (left), end-half/end-game (center-right). Tight. */}
      <div className="flex items-center justify-between gap-2">
        <div className="text-lg font-black text-gray-900">{period}</div>
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
      {/* Row 2: team timeouts. Away on the left, home on the right,
          each aligned to its side to mirror the scoreboard layout. */}
      <div className="flex items-center justify-between gap-2 pt-1 border-t border-gray-100">
        <div className="flex items-center gap-1.5">
          <span className="text-[9px] font-bold text-gray-400 uppercase tracking-widest">{awayTeam}</span>
          {renderTimeoutPills(awayTeam, awayTOUsed)}
        </div>
        <div className="flex items-center gap-1.5">
          {renderTimeoutPills(homeTeam, homeTOUsed)}
          <span className="text-[9px] font-bold text-gray-400 uppercase tracking-widest">{homeTeam}</span>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Scorer controls: team claim, stat entry with rebound/assist
// prompts, undo, game state buttons
// ============================================================
function ScorerControls({ game, live, events, rosters, me, onLogin, myRole, onReload, currentHalf, teamFoulsThisHalf, teamTimeoutsThisHalf, teamScore, box }) {
  const [showInlineLogin, setShowInlineLogin] = useState(false);
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
    if (!me) { alert("Log in to score."); return; }
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
    if (!me) { alert("Log in to score."); return; }
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
    if (!me) { alert("Log in to score."); return; }
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
      <>
        <div className="rounded-2xl border border-gray-100 bg-gray-50 p-4 text-center">
          <div className="text-sm text-gray-700 mb-3">Log in to score this game.</div>
          <button
            onClick={() => {
              try {
                window.localStorage.setItem("pcal_pending_section", JSON.stringify({
                  section: "live", tab: "live", ts: Date.now(),
                }));
              } catch {}
              setShowInlineLogin(true);
            }}
            className="px-4 py-2 rounded-xl bg-emerald-500 text-white font-bold text-sm active:bg-emerald-600"
          >
            Log in
          </button>
        </div>
        {showInlineLogin && (
          <LoginModal
            onClose={() => setShowInlineLogin(false)}
            onLogin={(rec) => { setShowInlineLogin(false); onLogin(rec); }}
          />
        )}
      </>
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

    // Renders a single player card in the box picker. Layout, top to bottom:
    //   [avatar 36px] [milestone badge if >=10]  [stat chip top-right]
    //   F. LastName
    //       <BIG jersey #>
    // Avatar is a photo if available (from PhotosContext) otherwise initials.
    // Stat chip shows labeled count ("2 fouls", "14 pts", etc). When the
    // player crosses 10+ in the displayed stat, a small gold badge sits
    // next to the avatar showing that count (keeps climbing past 10).
    const renderPlayerCard = (p, opts = {}) => {
      const { onClick, disabled, showCount = true } = opts;
      const name = p.player_name || "";
      const parts = name.trim().split(/\s+/);
      const displayLast = parts[0]
        ? parts[0].charAt(0).toUpperCase() + parts[0].slice(1).toLowerCase()
        : name;
      const firstInit = parts[1] ? parts[1].charAt(0).toUpperCase() + "." : "";
      const displayName = firstInit ? `${firstInit} ${displayLast}` : displayLast;
      const statInfo = showCount && partitionStatKey
        ? statLabelForPlayer(partitionStatKey, box[name])
        : { count: 0, label: "" };
      const jersey = p.jersey_number || "";
      // Milestone chip: show for any countable stat where they have >=10.
      // Uses the PARTITION stat, which for shot keys is points (so "10 pts"
      // triggers it, which is the right semantic: double-digit scorer).
      const hasMilestone = statInfo.count >= 10;
      return (
        <button key={p.roster_id}
          onClick={onClick}
          disabled={disabled}
          className="relative py-3 px-2 rounded-xl bg-white border-2 border-gray-200 text-center active:bg-gray-50 disabled:opacity-40 disabled:active:bg-white min-h-[112px]">
          {/* Top-left: avatar */}
          <div className="absolute top-2 left-2">
            <PlayerAvatar name={name} team={p.team} size={32} />
          </div>
          {/* Milestone badge: small filled chip next to the avatar */}
          {hasMilestone && (
            <div
              className="absolute top-0 left-9 px-1.5 py-0.5 rounded-full text-[9px] font-black bg-amber-500 text-white tabular-nums border-2 border-white"
              title="Double-digit!"
            >
              {statInfo.count}
            </div>
          )}
          {/* Top-right: labeled stat chip */}
          {showCount && statInfo.label && statInfo.count > 0 && (
            <div className="absolute top-2 right-2 px-1.5 py-0.5 rounded text-[9px] font-black bg-gray-100 text-gray-700 tabular-nums">
              {statInfo.label}
            </div>
          )}
          {/* Body: name + big jersey number */}
          <div className="pt-11">
            <div className="text-xs font-black text-gray-900 truncate leading-tight">
              {displayName}
            </div>
            <div className="text-3xl font-black text-gray-900 leading-none mt-1 tabular-nums">
              {jersey || <span className="text-gray-200">&mdash;</span>}
            </div>
          </div>
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

        {/* Rebound prompt overlay (after a missed shot).
            For missed FREE THROWS, we lead with an "Uncontested Rebound"
            button because for the first 38 minutes of the game, PCAL
            rebounds off free throws are automatic to the other team. */}
        {promptMode === "rebound" && (
          <ModalShell title="Rebound?" onClose={cancelPrompt}>
            <div className="space-y-2">
              {pendingStat?.key === "missed_ft" && (
                <>
                  <button onClick={() => chooseRebound("other_team")}
                    className="w-full py-4 rounded-xl bg-gray-900 text-white font-black text-sm active:bg-gray-800">
                    <div>Uncontested Rebound</div>
                    <div className="text-[10px] font-normal text-gray-300 mt-0.5">
                      (first 38 min of game)
                    </div>
                  </button>
                  <div className="flex items-center gap-2 pt-1">
                    <div className="flex-1 h-px bg-gray-200" />
                    <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                      or
                    </span>
                    <div className="flex-1 h-px bg-gray-200" />
                  </div>
                </>
              )}
              <button onClick={() => chooseRebound("own")}
                className={`w-full py-3 rounded-xl font-bold text-sm active:bg-gray-800 ${
                  pendingStat?.key === "missed_ft"
                    ? "bg-gray-100 text-gray-700 active:bg-gray-200"
                    : "bg-gray-900 text-white"
                }`}>
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
        const milestone = milestoneForEvent(events, e);
        return (
          <div key={e.event_id} className="flex items-center gap-2 py-1.5 px-2 rounded-lg border border-gray-100 bg-white text-[11px]">
            <span className="text-gray-400 tabular-nums w-16">{formatTime(e.event_ts)}</span>
            <span className="text-gray-400 w-10 font-bold">{e.period}</span>
            <span className="flex-1 text-gray-700">
              {formatEventText(e)}
              {milestone && (
                <span className="ml-1.5 inline-block px-1.5 py-0.5 rounded-full text-[9px] font-black bg-amber-500 text-white tabular-nums align-middle">
                  {milestone.label}
                </span>
              )}
            </span>
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
  const [reversing, setReversing] = useState(null);

  const reload = async () => {
    setLoading(true);
    // Show both games waiting for approval ('ended') and already-approved
    // ones. Approved games can be reversed, which undoes the game_log
    // writes and flips the game back to 'ended' for re-approval.
    const { data } = await supabase
      .from("live_games")
      .select("*, schedule!inner(*)")
      .in("status", ["ended", "approved"])
      .order("updated_at", { ascending: false });
    setGames(data || []);
    setLoading(false);
  };

  useEffect(() => {
    if (needPw) return;
    reload();
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

  // Reverse an already-approved game. Deletes the game_log rows that were
  // written on approval (matched by year+week+date+team combinations derived
  // from the game's schedule), flips schedule and live_games back to
  // 'ended', and writes an audit entry. The user can then re-approve with
  // edits if needed.
  const reverseApproval = async (g) => {
    const homeTeam = g.schedule.home_team;
    const awayTeam = g.schedule.away_team;
    const season = g.schedule.season;
    const week = g.schedule.week;
    const shortDate = formatGameDateShort(g.schedule.game_date);

    const confirmed = confirm(
      `Reverse approval for ${awayTeam} at ${homeTeam}, Week ${week}?\n\n`
      + `This will:\n`
      + `  - Delete all game_log rows for this game (week ${week}, ${shortDate}, `
      + `teams ${homeTeam}/${awayTeam}, season ${season})\n`
      + `  - Set the game back to "ended" state\n`
      + `  - Allow re-approval with corrections\n\n`
      + `Game stats (live_events) stay intact. Continue?`
    );
    if (!confirmed) return;

    // Delete matching rows from game_log. Match on year + week + date +
    // (team in (home, away)). This is our best proxy since game_log
    // doesn't have a game_id foreign key.
    const { data: toDelete, error: fetchErr } = await supabase
      .from("game_log")
      .select("*")
      .eq("year", season)
      .eq("week", week)
      .eq("date", shortDate)
      .in("team", [homeTeam, awayTeam]);
    if (fetchErr) {
      alert("Error fetching rows to delete: " + fetchErr.message);
      return;
    }
    const rowCount = (toDelete || []).length;
    if (rowCount === 0) {
      const proceedEmpty = confirm(
        `No game_log rows matched. The game may already have been reverted, or the matching criteria (year/week/date/team) don't match what was written.\n\nFlip status back to 'ended' anyway?`
      );
      if (!proceedEmpty) return;
    } else {
      const reallyDelete = confirm(`Found ${rowCount} game_log rows to delete. Proceed?`);
      if (!reallyDelete) return;
    }

    const delRes = await adminDeleteGameLogForGame({
      year: season,
      week: week,
      date: shortDate,
      homeTeam: homeTeam,
      awayTeam: awayTeam,
    });
    if (!delRes || !delRes.ok) {
      alert("Error deleting from game_log: " + (delRes && delRes.error ? delRes.error : "unknown error"));
      return;
    }

    await supabase.from("live_games").update({
      status: "ended",
      approved_at: null,
      approved_by: null,
      updated_at: new Date().toISOString(),
    }).eq("game_id", g.game_id);
    await supabase.from("schedule").update({ status: "ended" }).eq("game_id", g.game_id);
    await supabase.from("audit_log").insert({
      game_id: g.game_id,
      action: "reverse_approval",
      after_value: { rows_deleted: rowCount },
    });
    // Invalidate the cached GAME_LOG so stats pages reflect the rollback.
    bumpGameLogCache();

    alert(`Reversal complete. ${rowCount} rows removed from game_log. The game is back in the queue for re-approval.`);
    setReversing(null);
    reload();
  };

  return (
    <div>
      <BackRow onBack={onBack} />
      <p className="text-xs text-gray-400 uppercase tracking-widest font-medium mb-3">Review Queue</p>
      {loading && <div className="text-center py-8 text-gray-400 text-sm">Loading...</div>}
      {!loading && games.length === 0 && (
        <div className="rounded-2xl border border-gray-100 bg-gray-50 p-6 text-center text-sm text-gray-500">
          No games to review.
        </div>
      )}
      {games.map(g => {
        const isApproved = g.status === "approved";
        return (
          <div key={g.game_id} className="rounded-2xl border border-gray-100 bg-white p-3 mb-2">
            <div className="flex items-center gap-2">
              <div className="flex-1">
                <div className="text-[10px] text-gray-400 uppercase tracking-wide flex items-center gap-2">
                  <span>Week {g.schedule.week} &middot; {g.schedule.game_date}</span>
                  {isApproved && (
                    <span className="px-1.5 py-0.5 rounded bg-green-100 text-green-700 text-[9px] font-bold">
                      APPROVED
                    </span>
                  )}
                </div>
                <div className="text-sm font-bold text-gray-900">{g.schedule.away_team} at {g.schedule.home_team}</div>
              </div>
              <button onClick={() => onOpen(g.game_id)} className="text-[11px] font-bold text-white px-3 py-1.5 rounded-lg bg-gray-900 active:bg-gray-800">Open</button>
              {isApproved ? (
                <button
                  onClick={() => reverseApproval(g)}
                  className="text-[11px] font-bold text-red-700 px-3 py-1.5 rounded-lg bg-red-50 border border-red-200 active:bg-red-100">
                  Reverse
                </button>
              ) : (
                <button onClick={() => setApproving(g)} className="text-[11px] font-bold text-green-700 px-3 py-1.5 rounded-lg bg-green-50 border border-green-200 active:bg-green-100">
                  Approve
                </button>
              )}
            </div>
          </div>
        );
      })}
      {approving && (
        <ApproveModal game={approving} onClose={() => setApproving(null)} onDone={() => { setApproving(null); reload(); }} />
      )}
    </div>
  );
}

// Approval modal: shows the computed box score as an editable grid, one
// row per player per team. Admin can edit any stat cell, delete a row,
// reassign stats to a different player, merge two rows together, add a
// missing player, and pick a game type. GmSc recomputes live. Validation
// blocks impossible stat lines and warns on inconsistent ones.
function ApproveModal({ game, onClose, onDone }) {
  const [events, setEvents] = useState([]);
  const [rosters, setRosters] = useState({ home: [], away: [] });
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);              // editable copy of box-score rows
  const [gameType, setGameType] = useState(game.schedule.game_type || "R");
  const [week, setWeek] = useState(game.schedule.week || 1);
  const [gameDate, setGameDate] = useState(formatGameDateShort(game.schedule.game_date));
  const [mergeSource, setMergeSource] = useState(null); // index of source row being merged
  const [adding, setAdding] = useState(null);           // team code if "add player" picker is open
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const [{ data: evs }, { data: rosterRows }] = await Promise.all([
        supabase.from("live_events").select("*").eq("game_id", game.game_id).order("event_ts", { ascending: true }),
        supabase.from("rosters").select("*")
          .eq("season", game.schedule.season)
          .in("team", [game.schedule.home_team, game.schedule.away_team])
          .eq("active", true)
          .order("player_name", { ascending: true }),
      ]);
      const { box } = computeBoxScore(evs || []);
      const initialRows = Object.entries(box).map(([player, s]) => ({
        id: `${player}-${s.team}`,
        player,
        team: s.team,
        pts: s.pts || 0, reb: s.reb || 0, ast: s.ast || 0, stl: s.stl || 0, blk: s.blk || 0,
        fgm: s.fgm || 0, fga: s.fga || 0, ftm: s.ftm || 0, fta: s.fta || 0,
        tpm: s.tpm || 0, tpa: s.tpa || 0, foul: s.foul || 0,
      }));
      // Sort: home team first then away, then by pts desc
      initialRows.sort((a, b) => {
        if (a.team !== b.team) return a.team === game.schedule.home_team ? -1 : 1;
        return (b.pts || 0) - (a.pts || 0);
      });
      setEvents(evs || []);
      setRosters({
        home: (rosterRows || []).filter(r => r.team === game.schedule.home_team),
        away: (rosterRows || []).filter(r => r.team === game.schedule.away_team),
      });
      setRows(initialRows);
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game.game_id]);

  // Edit a single cell. Numeric fields get coerced to int.
  const editCell = (idx, field, value) => {
    setRows(prev => prev.map((r, i) => {
      if (i !== idx) return r;
      if (field === "player" || field === "team") {
        return { ...r, [field]: value };
      }
      const n = parseInt(value, 10);
      return { ...r, [field]: isNaN(n) ? 0 : n };
    }));
  };

  const deleteRow = (idx) => {
    if (!confirm(`Remove ${formatName(rows[idx].player)} from this game?`)) return;
    setRows(prev => prev.filter((_, i) => i !== idx));
  };

  // Merge source row into target row: sum all stats, remove source.
  const mergeRows = (targetIdx) => {
    if (mergeSource == null) return;
    const srcIdx = mergeSource;
    if (srcIdx === targetIdx) { setMergeSource(null); return; }
    setRows(prev => {
      const src = prev[srcIdx];
      const tgt = prev[targetIdx];
      const merged = { ...tgt };
      for (const f of ["pts","reb","ast","stl","blk","fgm","fga","ftm","fta","tpm","tpa","foul"]) {
        merged[f] = (tgt[f] || 0) + (src[f] || 0);
      }
      return prev.filter((_, i) => i !== srcIdx).map((r, i) => {
        // After filtering src out, target's new index changes if srcIdx < targetIdx
        const adjustedTargetIdx = srcIdx < targetIdx ? targetIdx - 1 : targetIdx;
        return i === adjustedTargetIdx ? merged : r;
      });
    });
    setMergeSource(null);
  };

  // Add a player row from the roster. New row starts with all zeros.
  const addPlayerFromRoster = (rosterEntry) => {
    setRows(prev => [
      ...prev,
      {
        id: `${rosterEntry.player_name}-${rosterEntry.team}-${Date.now()}`,
        player: rosterEntry.player_name,
        team: rosterEntry.team,
        pts: 0, reb: 0, ast: 0, stl: 0, blk: 0,
        fgm: 0, fga: 0, ftm: 0, fta: 0, tpm: 0, tpa: 0, foul: 0,
      },
    ]);
    setAdding(null);
  };

  // Validation: returns { blocking: [], warnings: [] }
  const validation = (() => {
    const blocking = [];
    const warnings = [];
    rows.forEach((r, idx) => {
      const label = `${formatName(r.player)} (${r.team})`;
      if (r.fgm > r.fga) blocking.push(`${label}: FGM (${r.fgm}) > FGA (${r.fga})`);
      if (r.ftm > r.fta) blocking.push(`${label}: FTM (${r.ftm}) > FTA (${r.fta})`);
      if (r.tpm > r.tpa) blocking.push(`${label}: 3PM (${r.tpm}) > 3PA (${r.tpa})`);
      if (r.tpm > r.fgm) blocking.push(`${label}: 3PM (${r.tpm}) > FGM (${r.fgm})`);
      if (r.tpa > r.fga) blocking.push(`${label}: 3PA (${r.tpa}) > FGA (${r.fga})`);
      const expectedPts = 2 * (r.fgm - r.tpm) + 3 * r.tpm + r.ftm;
      if (r.pts !== expectedPts && (r.fgm > 0 || r.ftm > 0)) {
        warnings.push(`${label}: PTS=${r.pts}, but 2*(FGM-3PM) + 3*3PM + FTM = ${expectedPts}`);
      }
    });
    return { blocking, warnings };
  })();

  const approve = async () => {
    if (validation.blocking.length > 0) {
      alert("Cannot approve with validation errors:\n\n" + validation.blocking.join("\n"));
      return;
    }
    if (validation.warnings.length > 0) {
      const proceed = confirm(
        "The following warnings were flagged. These aren't blocking but you may want to review:\n\n"
        + validation.warnings.join("\n")
        + "\n\nApprove anyway?"
      );
      if (!proceed) return;
    }
    setSaving(true);
    const inserts = rows.map(r => ({
      player: r.player,
      team: r.team,
      opp: r.team === game.schedule.home_team ? game.schedule.away_team : game.schedule.home_team,
      week: parseInt(week, 10) || game.schedule.week,
      date: gameDate || formatGameDateShort(game.schedule.game_date),
      game_type: gameType,
      g: 1,
      pts: r.pts, reb: r.reb, stl: r.stl, ast: r.ast, blk: r.blk,
      fgm: r.fgm, fga: r.fga, ftm: r.ftm, fta: r.fta, tpm: r.tpm, tpa: r.tpa,
      foul: r.foul,
      gmsc: computeGmSc(r),
      year: game.schedule.season,
    }));
    const insertRes = await adminInsertGameLog(inserts);
    if (!insertRes || !insertRes.ok) {
      alert("Error writing to game_log: " + (insertRes && insertRes.error ? insertRes.error : "unknown error"));
      setSaving(false);
      return;
    }
    // Persist the chosen game_type back to schedule for next time
    await supabase.from("schedule").update({
      status: "approved",
      game_type: gameType,
    }).eq("game_id", game.game_id);
    await supabase.from("live_games").update({
      status: "approved",
      approved_at: new Date().toISOString(),
      approved_by: "admin",
      updated_at: new Date().toISOString(),
    }).eq("game_id", game.game_id);
    await supabase.from("audit_log").insert({
      game_id: game.game_id, action: "approve",
      after_value: { rows_written: inserts.length, game_type: gameType },
    });
    // Invalidate the cached GAME_LOG so stats pages pick up the new rows
    // on next page load instead of waiting for the 12h TTL to expire.
    bumpGameLogCache();
    setSaving(false);
    onDone();
  };

  if (loading) {
    return (
      <ModalShell title="Approve game" onClose={onClose}>
        <div className="text-xs text-gray-400 py-4 text-center">Loading box score...</div>
      </ModalShell>
    );
  }

  const allRoster = [...rosters.home, ...rosters.away];
  const rosterByName = Object.fromEntries(allRoster.map(r => [r.player_name, r]));
  const rowsByTeam = { home: [], away: [] };
  rows.forEach((r, idx) => {
    (r.team === game.schedule.home_team ? rowsByTeam.home : rowsByTeam.away).push({ r, idx });
  });

  const homeName = TEAM_NAMES[game.schedule.home_team] || game.schedule.home_team;
  const awayName = TEAM_NAMES[game.schedule.away_team] || game.schedule.away_team;

  const numInput = "w-10 text-center text-xs font-bold bg-transparent border-0 focus:outline-none focus:bg-yellow-50 tabular-nums";
  const headerTh = "text-[9px] font-bold text-gray-400 uppercase tracking-wide px-1 py-1 text-center";

  const renderTeamRows = (teamCode, teamRows) => {
    if (teamRows.length === 0) return (
      <tr><td colSpan={14} className="text-[11px] text-gray-400 text-center py-2">No players entered.</td></tr>
    );
    return teamRows.map(({ r, idx }) => {
      const isMergeSrc = mergeSource === idx;
      const isMergeTargetable = mergeSource != null && mergeSource !== idx;
      const gmsc = computeGmSc(r);
      return (
        <tr key={r.id || idx}
          className={`${isMergeSrc ? "bg-orange-50" : isMergeTargetable ? "bg-blue-50" : ""} border-b border-gray-100`}
          onClick={isMergeTargetable ? () => {
            if (!confirm(`Merge ${formatName(rows[mergeSource].player)}'s stats INTO ${formatName(r.player)}? Source row will be removed.`)) return;
            mergeRows(idx);
          } : undefined}
        >
          <td className="px-1 py-1">
            <select
              value={r.player}
              onChange={(e) => editCell(idx, "player", e.target.value)}
              className="text-[11px] font-bold text-gray-900 bg-transparent border-0 max-w-[88px] truncate focus:outline-none focus:bg-yellow-50"
            >
              {/* Allow selecting any player on this game's roster, or keep current name */}
              <option value={r.player}>{formatName(r.player)}</option>
              {allRoster
                .filter(p => p.player_name !== r.player)
                .map(p => (
                  <option key={p.roster_id} value={p.player_name}>{formatName(p.player_name)} ({p.team})</option>
                ))}
            </select>
          </td>
          {["pts","reb","ast","stl","blk","fgm","fga","ftm","fta","tpm","tpa","foul"].map(f => (
            <td key={f} className="px-0.5 py-1 text-center">
              <input
                type="number"
                min="0"
                value={r[f]}
                onChange={(e) => editCell(idx, f, e.target.value)}
                className={numInput}
              />
            </td>
          ))}
          <td className="px-1 py-1 text-center text-[11px] font-bold text-gray-600 tabular-nums">
            {gmsc.toFixed(1)}
          </td>
          <td className="px-1 py-1 text-right whitespace-nowrap">
            <button
              onClick={(e) => { e.stopPropagation(); setMergeSource(isMergeSrc ? null : idx); }}
              className={`text-[9px] font-bold px-1.5 py-0.5 rounded mr-1 ${
                isMergeSrc ? "bg-orange-500 text-white" : "bg-gray-100 text-gray-600 active:bg-gray-200"
              }`}
              title="Merge this row into another"
            >
              {isMergeSrc ? "\u2715" : "\u2911"}
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); deleteRow(idx); }}
              className="text-[9px] font-bold text-red-600 px-1.5 py-0.5 rounded bg-red-50 active:bg-red-100"
              title="Remove row"
            >
              del
            </button>
          </td>
        </tr>
      );
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 overflow-y-auto p-2" onClick={onClose}>
      <div className="w-full max-w-2xl bg-white rounded-2xl p-4 my-2" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-base font-bold text-gray-900">
            Approve: {awayName} at {homeName}
          </h3>
          <button onClick={onClose} className="text-gray-400 text-lg leading-none">&times;</button>
        </div>

        {/* Game metadata */}
        <div className="grid grid-cols-3 gap-2 mb-3 text-[11px]">
          <label className="flex flex-col gap-1">
            <span className="font-bold text-gray-500 uppercase tracking-wide text-[9px]">Date</span>
            <input type="text" value={gameDate} onChange={e => setGameDate(e.target.value)}
              className="px-2 py-1.5 rounded border border-gray-200 text-xs" placeholder="6/15" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-bold text-gray-500 uppercase tracking-wide text-[9px]">Week</span>
            <input type="number" value={week} onChange={e => setWeek(e.target.value)}
              className="px-2 py-1.5 rounded border border-gray-200 text-xs" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-bold text-gray-500 uppercase tracking-wide text-[9px]">Type</span>
            <select value={gameType} onChange={e => setGameType(e.target.value)}
              className="px-2 py-1.5 rounded border border-gray-200 text-xs bg-white">
              <option value="R">R - Regular</option>
              <option value="P">P - Playoff</option>
              <option value="C">C - Championship</option>
              <option value="X">X - Exhibition</option>
            </select>
          </label>
        </div>

        {/* Merge mode banner */}
        {mergeSource != null && (
          <div className="mb-2 px-3 py-2 rounded-lg bg-orange-50 border border-orange-200 text-[11px] text-orange-800">
            Merging {formatName(rows[mergeSource].player)} ({rows[mergeSource].team}) into another row.
            Tap a target row to combine, or tap the X to cancel.
          </div>
        )}

        {/* Validation summary */}
        {validation.blocking.length > 0 && (
          <div className="mb-2 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-[11px] text-red-800">
            <div className="font-bold mb-1">Must fix before approving:</div>
            <ul className="list-disc list-inside space-y-0.5">
              {validation.blocking.map((m, i) => <li key={i}>{m}</li>)}
            </ul>
          </div>
        )}
        {validation.warnings.length > 0 && validation.blocking.length === 0 && (
          <div className="mb-2 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-[11px] text-amber-800">
            <div className="font-bold mb-1">Warnings (approve anyway is allowed):</div>
            <ul className="list-disc list-inside space-y-0.5">
              {validation.warnings.map((m, i) => <li key={i}>{m}</li>)}
            </ul>
          </div>
        )}

        {/* Box score grid */}
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b-2 border-gray-200">
                <th className={`${headerTh} text-left`}>Player</th>
                <th className={headerTh}>PTS</th>
                <th className={headerTh}>REB</th>
                <th className={headerTh}>AST</th>
                <th className={headerTh}>STL</th>
                <th className={headerTh}>BLK</th>
                <th className={headerTh}>FGM</th>
                <th className={headerTh}>FGA</th>
                <th className={headerTh}>FTM</th>
                <th className={headerTh}>FTA</th>
                <th className={headerTh}>3PM</th>
                <th className={headerTh}>3PA</th>
                <th className={headerTh}>F</th>
                <th className={headerTh}>GmSc</th>
                <th className={headerTh}></th>
              </tr>
            </thead>
            <tbody>
              <tr className="bg-gray-50">
                <td colSpan={15} className="px-2 py-1 text-[10px] font-bold text-gray-600 uppercase tracking-wide">
                  {game.schedule.away_team} - {awayName}
                </td>
              </tr>
              {renderTeamRows(game.schedule.away_team, rowsByTeam.away)}
              <tr>
                <td colSpan={15} className="px-2 py-1">
                  <button onClick={() => setAdding(game.schedule.away_team)}
                    className="text-[10px] font-bold text-gray-500 px-2 py-1 rounded bg-gray-50 active:bg-gray-100 border border-dashed border-gray-300">
                    + Add {game.schedule.away_team} player
                  </button>
                </td>
              </tr>
              <tr className="bg-gray-50">
                <td colSpan={15} className="px-2 py-1 text-[10px] font-bold text-gray-600 uppercase tracking-wide">
                  {game.schedule.home_team} - {homeName}
                </td>
              </tr>
              {renderTeamRows(game.schedule.home_team, rowsByTeam.home)}
              <tr>
                <td colSpan={15} className="px-2 py-1">
                  <button onClick={() => setAdding(game.schedule.home_team)}
                    className="text-[10px] font-bold text-gray-500 px-2 py-1 rounded bg-gray-50 active:bg-gray-100 border border-dashed border-gray-300">
                    + Add {game.schedule.home_team} player
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Add player picker */}
        {adding && (
          <ModalShell title={`Add ${adding} player`} onClose={() => setAdding(null)}>
            <div className="grid grid-cols-2 gap-1.5 max-h-80 overflow-y-auto">
              {allRoster
                .filter(p => p.team === adding)
                .filter(p => !rows.some(r => r.player === p.player_name && r.team === p.team))
                .map(p => (
                  <button key={p.roster_id}
                    onClick={() => addPlayerFromRoster(p)}
                    className="py-2 px-2 rounded-xl bg-white border border-gray-200 text-center active:bg-gray-50">
                    <div className="text-xs font-bold text-gray-900 truncate">{formatName(p.player_name)}</div>
                    {p.jersey_number && (
                      <div className="text-[9px] text-gray-400">#{p.jersey_number}</div>
                    )}
                  </button>
                ))}
            </div>
          </ModalShell>
        )}

        {/* Action buttons */}
        <div className="flex gap-2 mt-4 pt-3 border-t border-gray-100">
          <button onClick={onClose} disabled={saving}
            className="flex-1 py-2.5 rounded-lg bg-gray-100 text-gray-700 font-bold text-sm active:bg-gray-200 disabled:opacity-50">
            Cancel
          </button>
          <button onClick={approve}
            disabled={saving || validation.blocking.length > 0}
            className="flex-1 py-2.5 rounded-lg bg-gray-900 text-white font-bold text-sm active:bg-gray-800 disabled:opacity-50">
            {saving ? "Saving..." : `Approve & Write (${rows.length} rows)`}
          </button>
        </div>
      </div>
    </div>
  );
}
