// 2026 PCAL awards ballot and the public turnout page.
//
// The ballot lives at /awards (unlisted, the link goes to the 30 voters) and
// turnout at /awardsvoters (public).
//
// What is enforced where:
//   - Who may vote is enforced by survey_submit in the database, against the
//     survey_voters roll. The screens below only decide what to render. A
//     person who is not on the roll cannot vote by any route, including
//     calling the RPC by hand.
//   - One ballot per account, by unique index. Not per device.
//   - Ballots carry no identity at all. The roll records THAT someone voted,
//     never what they chose, and the two are never joined.
//
// The one rule that is NOT enforced server side is "pick a team besides your
// own" on the favorite team question. The feature has no way to hide one
// option from one respondent, so it is filtered here. It is a favorite team
// question, not an award.

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "./supabase";
import { LoginModal } from "./LiveSection";
import {
  fetchSurvey,
  fetchVoterStatus,
  fetchTurnout,
  fetchResults,
  submitResponse,
  getRespondentKey,
  seededShuffle,
} from "./features/surveys";

const SLUG = "awards-2026";
const DEADLINE_COPY = "Saturday, August 8 at 12 pm Pacific";

// Option position encodes ballot order and nothing else does: under 100 is a
// priority name put forward by team reps, 100 and up is everyone else. Shuffle
// inside each band, priority band first. See awards_2026_ballot.sql.
const PRIORITY_MAX = 100;

const TEAM_OF = (label) => {
  const m = /\(([A-Z]{3})\)\s*$/.exec(String(label || ""));
  return m ? m[1] : null;
};

const PLACE_WORD = ["1st", "2nd", "3rd"];
const PLACE_POINTS = [5, 3, 1];

export default function AwardsSection({ view = "ballot" }) {
  const [session, setSession] = useState(undefined);   // undefined = still loading

  useEffect(() => {
    let alive = true;
    supabase.auth.getSession().then(({ data }) => {
      if (alive) setSession(data && data.session ? data.session : null);
    });
    const { data } = supabase.auth.onAuthStateChange((_e, s) => {
      if (alive) setSession(s || null);
    });
    return () => { alive = false; if (data && data.subscription) data.subscription.unsubscribe(); };
  }, []);

  if (view === "voters") return <TurnoutPage />;
  if (view === "results") return <ResultsPage />;
  return <BallotPage session={session} />;
}

// ---------------------------------------------------------------- results

// PCAL scores 5-3-1 and calls players tied on points co-winners. That is NOT
// the order survey_results returns: the feature breaks a points tie by
// first-place votes, which is a reasonable default and the wrong rule here.
// So rank on points alone, standard competition style, and let equal points
// share a place.
function rankByPoints(options) {
  const sorted = [...options].sort((a, b) => b.points - a.points);
  const counts = {};
  sorted.forEach(o => { counts[o.points] = (counts[o.points] || 0) + 1; });
  let place = 0, prev = null;
  return sorted.map((o, i) => {
    if (prev === null || o.points !== prev) { place = i + 1; prev = o.points; }
    return { ...o, place, tied: counts[o.points] > 1 && o.points > 0 };
  });
}

function ResultsPage() {
  const [results, setResults] = useState(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    let alive = true;
    fetchResults(supabase, SLUG)
      .then(r => { if (alive) setResults(r); })
      .catch(e => { if (alive) setErr(e.message || "Could not load results."); });
    return () => { alive = false; };
  }, []);

  const questions = useMemo(
    () => results ? [...results.questions].sort((a, b) => a.position - b.position) : [],
    [results]);

  if (err) {
    return (
      <div className="px-4 pb-24 pt-2">
        <h2 className="text-xl font-black text-gray-900">2026 Awards Results</h2>
        <div className="mt-3 rounded-2xl border border-gray-100 p-4">
          <p className="text-[13px] text-gray-700 leading-relaxed">{err}</p>
          <p className="text-[11px] text-gray-500 mt-2">
            Results are owner only while voting is open. Log in as the commissioner to see them.
          </p>
        </div>
      </div>
    );
  }
  if (!results) {
    return <div className="px-4 pb-24 pt-2"><p className="text-[13px] text-gray-500">Loading...</p></div>;
  }

  return (
    <div className="px-4 pb-24 pt-2">
      <h2 className="text-xl font-black text-gray-900">2026 Awards Results</h2>
      <p className="text-[13px] text-gray-600 mt-1">
        {results.total_responses} of 30 ballots in. 1st is worth 5 points, 2nd 3, 3rd 1.
        Players level on points are co-winners.
      </p>

      {questions.map(q => {
        const rows = rankByPoints(q.options);
        const top = rows.length ? rows[0].points : 0;
        return (
          <div key={q.id} className="mt-5">
            <h3 className="text-[13px] font-black text-gray-900 uppercase tracking-wide">{q.prompt}</h3>
            <div className="mt-2 space-y-1.5">
              {rows.map(o => (
                <div key={o.id} className="rounded-2xl border border-gray-100 px-3 py-2">
                  <div className="flex items-baseline gap-2">
                    <span className="w-6 flex-none text-[13px] font-black text-gray-400">
                      {o.points > 0 ? o.place : ""}
                    </span>
                    <span className="text-[13px] font-bold text-gray-900">{o.label}</span>
                    {o.tied && (
                      <span className="text-[11px] font-black text-gray-400 uppercase">tied</span>
                    )}
                    <span className="ml-auto text-[13px] font-black text-gray-900">
                      {q.type === "ranked" ? `${o.points} pts` : `${o.votes}`}
                    </span>
                  </div>
                  {q.type === "ranked" && (
                    <>
                      <div className="mt-1 h-1.5 rounded-full bg-gray-100 overflow-hidden">
                        <div className="h-full bg-gray-900"
                          style={{ width: `${top > 0 ? (o.points / top) * 100 : 0}%` }} />
                      </div>
                      <div className="mt-1 text-[11px] text-gray-500">
                        {[1, 2, 3].map(p => `${PLACE_WORD[p - 1]}: ${o.rank_counts[String(p)] || 0}`).join("  ")}
                        {"   on "}{o.votes}{" ballots"}
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>

            {/* First Teams are derived, not voted: the top 5 vote-getters. */}
            {(q.position === 0 || q.position === 4) && results.total_responses > 0 && (
              <FirstTeam
                title={q.position === 0 ? "First-Team All-League" : "First-Team Best Teammates"}
                rows={rows} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// Top 5 vote-getters. If a tie straddles 5th, everyone level with 5th is
// included, so this can name more than five. Better than cutting a co-winner
// on an arbitrary tiebreak PCAL does not use.
function FirstTeam({ title, rows }) {
  const scored = rows.filter(r => r.points > 0);
  if (!scored.length) return null;
  const cutoff = scored.length >= 5 ? scored[4].points : 0;
  const team = scored.filter(r => r.points >= cutoff);
  return (
    <div className="mt-2 rounded-2xl bg-gray-900 px-3 py-3">
      <div className="text-[11px] font-black text-white uppercase tracking-wide">{title}</div>
      <div className="mt-1.5 space-y-1">
        {team.map(r => (
          <div key={r.id} className="flex items-baseline gap-2">
            <span className="text-[13px] font-bold text-white">{r.label}</span>
            <span className="ml-auto text-[11px] font-black text-gray-400">{r.points} pts</span>
          </div>
        ))}
      </div>
      {team.length > 5 && (
        <p className="mt-2 text-[11px] text-gray-400">
          {team.length} named: a tie on points at 5th, and PCAL calls those co-winners.
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- turnout

function TurnoutPage() {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    let alive = true;
    fetchTurnout(supabase, SLUG)
      .then(r => { if (alive) setRows(r); })
      .catch(e => { if (alive) setErr(e.message || "Could not load the voter list."); });
    return () => { alive = false; };
  }, []);

  const byTeam = useMemo(() => {
    const out = {};
    (rows || []).forEach(r => {
      const t = TEAM_OF(r.display_name) || "Other";
      (out[t] = out[t] || []).push(r);
    });
    Object.values(out).forEach(list => list.sort((a, b) =>
      String(a.display_name).localeCompare(String(b.display_name))));
    return out;
  }, [rows]);

  const voted = (rows || []).filter(r => r.voted).length;
  const total = (rows || []).length;

  return (
    <div className="px-4 pb-24 pt-2">
      <h2 className="text-xl font-black text-gray-900">2026 Awards Voters</h2>
      <p className="text-[13px] text-gray-600 mt-1 leading-relaxed">
        The five players from each team with the most games played this season are
        eligible to vote. This page shows who has voted, never how they voted.
      </p>

      {err && <p className="mt-4 text-[13px] text-red-600">{err}</p>}
      {rows === null && !err && <p className="mt-4 text-[13px] text-gray-500">Loading...</p>}

      {rows !== null && (
        <>
          <div className="mt-4 rounded-2xl border border-gray-100 p-4">
            <div className="flex items-baseline justify-between">
              <span className="text-[11px] font-black text-gray-900 uppercase tracking-wide">Ballots in</span>
              <span className="text-2xl font-black text-gray-900">{voted}<span className="text-gray-400 text-base"> / {total}</span></span>
            </div>
            <div className="mt-2 h-2 rounded-full bg-gray-100 overflow-hidden">
              <div className="h-full bg-gray-900" style={{ width: `${total ? (voted / total) * 100 : 0}%` }} />
            </div>
          </div>

          {Object.keys(byTeam).sort().map(team => (
            <div key={team} className="mt-5">
              <div className="text-[11px] font-black text-gray-900 uppercase tracking-wide mb-2">
                {team}
                <span className="text-gray-400 font-bold">
                  {"  "}{byTeam[team].filter(r => r.voted).length} of {byTeam[team].length}
                </span>
              </div>
              <div className="space-y-1.5">
                {byTeam[team].map(r => (
                  <div key={r.display_name}
                    className="flex items-center gap-2 rounded-2xl border border-gray-100 px-3 py-2">
                    <span className={`h-2.5 w-2.5 flex-none rounded-full ${
                      r.voted ? "bg-gray-900" : "bg-gray-200"}`} aria-hidden="true" />
                    <span className={`text-[13px] font-bold ${r.voted ? "text-gray-900" : "text-gray-500"}`}>
                      {String(r.display_name || "").replace(/\s*\([A-Z]{3}\)\s*$/, "")}
                    </span>
                    <span className="ml-auto text-[11px] font-bold text-gray-400">
                      {r.voted ? "Voted" : "Not yet"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

// ----------------------------------------------------------------- ballot

function BallotPage({ session }) {
  const [status, setStatus] = useState(null);
  const [survey, setSurvey] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [showLogin, setShowLogin] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setErr("");
    try {
      const [s, v] = await Promise.all([
        fetchSurvey(supabase, SLUG),
        fetchVoterStatus(supabase, SLUG),
      ]);
      setSurvey(s); setStatus(v);
    } catch (e) {
      setErr(e.message || "Could not load the ballot.");
    }
    setLoading(false);
  }, []);

  useEffect(() => { if (session !== undefined) load(); }, [session, load]);

  if (session === undefined || loading) {
    return <Shell><p className="text-[13px] text-gray-500">Loading...</p></Shell>;
  }
  if (err) return <Shell><p className="text-[13px] text-red-600">{err}</p></Shell>;
  if (!survey) return <Shell><p className="text-[13px] text-gray-600">Voting is not open.</p></Shell>;

  const closed = !survey.accepting;

  if (closed && !(status && status.voted)) {
    return (
      <Shell>
        <Explainer />
        <Card>
          <p className="text-[13px] text-gray-700 leading-relaxed">
            Voting closed {DEADLINE_COPY}. Results will be announced by the commissioner.
          </p>
        </Card>
      </Shell>
    );
  }

  if (!status || !status.signed_in) {
    return (
      <Shell>
        <Explainer />
        <Card>
          <p className="text-[13px] text-gray-700 leading-relaxed mb-3">
            Log in with the email address you registered with. We will send you a code.
          </p>
          <button onClick={() => setShowLogin(true)}
            className="w-full rounded-2xl bg-gray-900 px-4 py-3 text-[13px] font-black text-white active:opacity-60">
            Log in to vote
          </button>
        </Card>
        {showLogin && (
          <LoginModal emailTitle="Log in to vote"
            onClose={() => setShowLogin(false)}
            onLogin={() => { setShowLogin(false); load(); }} />
        )}
      </Shell>
    );
  }

  if (!status.eligible) {
    return (
      <Shell>
        <Card>
          <p className="text-[13px] font-black text-gray-900 mb-2">
            Thanks for your interest. You are not an eligible voter this season.
          </p>
          <p className="text-[13px] text-gray-700 leading-relaxed">
            The five players from each team with the most games played this season are
            eligible to vote, a pool of 30. Where players were tied on games played, team
            representatives decided which of them would vote.
          </p>
          <p className="text-[13px] text-gray-700 leading-relaxed mt-3">
            If you think you have reached this page in error, contact the commissioner.
          </p>
          <p className="text-[11px] text-gray-500 mt-3">
            Logged in as {session && session.user ? session.user.email : "someone else"}. If that is
            not the address you registered with, log out and try the right one.
          </p>
        </Card>
      </Shell>
    );
  }

  if (status.voted) {
    return (
      <Shell>
        <Card>
          <p className="text-[13px] font-black text-gray-900 mb-2">Your ballot is in.</p>
          <p className="text-[13px] text-gray-700 leading-relaxed">
            Thanks{status.display_name ? ", " + String(status.display_name).replace(/\s*\([A-Z]{3}\)\s*$/, "") : ""}.
            Each voter gets one ballot, so this one is final. Results will be announced by
            the commissioner after voting closes {DEADLINE_COPY}.
          </p>
          <a href="/awardsvoters"
            className="mt-3 inline-block text-[13px] font-bold text-gray-900 active:opacity-60">
            See who has voted
          </a>
        </Card>
      </Shell>
    );
  }

  return <Ballot survey={survey} status={status} onDone={load} />;
}

function Shell({ children }) {
  return (
    <div className="px-4 pb-24 pt-2">
      <h2 className="text-xl font-black text-gray-900">2026 PCAL Awards</h2>
      <div className="mt-3">{children}</div>
    </div>
  );
}

function Card({ children }) {
  return <div className="rounded-2xl border border-gray-100 p-4 mb-3">{children}</div>;
}

function Explainer() {
  return (
    <Card>
      <p className="text-[13px] text-gray-700 leading-relaxed">
        Voting closes <strong className="font-black text-gray-900">{DEADLINE_COPY}</strong>.
      </p>
      <p className="text-[13px] text-gray-700 leading-relaxed mt-3">
        <strong className="font-black text-gray-900">Eligible voters.</strong> The five players
        from each team with the most games played this season, a pool of 30. Where players were
        tied, team representatives decided.
      </p>
      <p className="text-[13px] text-gray-700 leading-relaxed mt-3">
        <strong className="font-black text-gray-900">Confidentiality.</strong> Your ballot is
        anonymous. Nothing links a ballot to the person who cast it, so your individual votes
        cannot be shared or made public by anyone, including the commissioner. What is recorded
        is that you voted, never what you chose.
      </p>
      <p className="text-[13px] text-gray-700 leading-relaxed mt-3">
        <strong className="font-black text-gray-900">Eligible players.</strong> Players are
        nominated for the ballot by team representatives.
      </p>
      <p className="text-[13px] text-gray-700 leading-relaxed mt-3">
        <strong className="font-black text-gray-900">Scoring.</strong> A 1st place vote is worth
        5 points, 2nd is worth 3, and 3rd is worth 1. Players tied on points are co-winners.
      </p>
    </Card>
  );
}

function Ballot({ survey, status, onDone }) {
  const [draft, setDraft] = useState({});
  const [problems, setProblems] = useState({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  // getRespondentKey is async (it sha256s the device id), so it has to be
  // resolved into state. Handing the promise straight to submitResponse would
  // send "[object Promise]" and the server would reject the ballot.
  //
  // With restrict_to_voters on, the server keys the duplicate guard to the
  // account and ignores this value, but survey_submit still requires a real
  // one, and it seeds the option shuffle so each voter sees a different order.
  const [respondentKey, setRespondentKey] = useState("");
  useEffect(() => {
    let alive = true;
    getRespondentKey(SLUG).then(k => { if (alive) setRespondentKey(k); });
    return () => { alive = false; };
  }, []);

  const myTeam = TEAM_OF(status && status.display_name);

  const questions = useMemo(
    () => [...survey.questions].sort((a, b) => a.position - b.position),
    [survey]);

  // Priority band first, everyone else after, each shuffled. Seeded off the
  // respondent key so it is stable across re-renders and a mid-vote refresh:
  // options must never move out from under a tap.
  const optionsFor = useCallback((q) => {
    const seed = `${respondentKey}:${q.id}`;
    const prio = q.options.filter(o => o.position < PRIORITY_MAX);
    const rest = q.options.filter(o => o.position >= PRIORITY_MAX);
    let list = [...seededShuffle(prio, seed + ":a"), ...seededShuffle(rest, seed + ":b")];
    // "besides your own" on the favorite team question
    if (q.type === "single" && myTeam) list = list.filter(o => TEAM_OF(o.label) !== myTeam);
    return list;
  }, [respondentKey, myTeam]);

  const setRanked = (qid, optionId, places) => {
    const cur = draft[qid] && draft[qid].option_ids ? draft[qid].option_ids : [];
    const at = cur.indexOf(optionId);
    let next;
    if (at >= 0) next = cur.filter(id => id !== optionId);
    else if (cur.length >= places) return;
    else next = [...cur, optionId];
    setDraft(d => ({ ...d, [qid]: { question_id: qid, option_ids: next } }));
  };

  const setSingle = (qid, optionId) => {
    const cur = draft[qid] && draft[qid].option_ids ? draft[qid].option_ids : [];
    const next = cur[0] === optionId ? [] : [optionId];
    setDraft(d => ({ ...d, [qid]: { question_id: qid, option_ids: next } }));
  };

  const submit = async () => {
    const found = {};
    questions.forEach(q => {
      const picks = (draft[q.id] && draft[q.id].option_ids) || [];
      if (q.type === "ranked" && picks.length !== 3) found[q.id] = "Choose 3, in order.";
      if (q.type === "single" && picks.length !== 1) found[q.id] = "Choose one team.";
    });
    setProblems(found);
    if (Object.keys(found).length) {
      const first = questions.find(q => found[q.id]);
      const el = document.getElementById("q-" + first.id);
      if (el && el.scrollIntoView) el.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    if (!respondentKey) return;
    setBusy(true); setErr("");
    try {
      await submitResponse(supabase, SLUG, respondentKey,
        questions.map(q => ({ question_id: q.id, option_ids: draft[q.id].option_ids })));
      onDone();
    } catch (e) {
      setErr(e.message || "Something went wrong. Your ballot was not recorded.");
      setBusy(false);
    }
  };

  const done = questions.filter(q => {
    const n = ((draft[q.id] && draft[q.id].option_ids) || []).length;
    return q.type === "ranked" ? n === 3 : n === 1;
  }).length;

  // Hold the ballot back until the shuffle seed exists, so options cannot
  // reorder under someone's finger a moment after the page paints.
  if (!respondentKey) {
    return <Shell><p className="text-[13px] text-gray-500">Loading...</p></Shell>;
  }

  return (
    <div className="px-4 pb-32 pt-2">
      <h2 className="text-xl font-black text-gray-900">2026 PCAL Awards</h2>
      <p className="text-[13px] text-gray-600 mt-1">
        Voting closes {DEADLINE_COPY}. One ballot per voter.
      </p>

      <div className="sticky top-0 z-10 -mx-4 mb-3 mt-3 bg-white px-4 py-2">
        <div className="flex items-center gap-2">
          <div className="h-2 flex-1 rounded-full bg-gray-100 overflow-hidden">
            <div className="h-full bg-gray-900 transition-all"
              style={{ width: `${(done / questions.length) * 100}%` }} />
          </div>
          <span className="text-[11px] font-black text-gray-900">{done} / {questions.length}</span>
        </div>
      </div>

      {questions.map((q, qi) => (
        <div key={q.id} id={"q-" + q.id}
          className={`mb-4 rounded-2xl border p-4 ${problems[q.id] ? "border-red-300" : "border-gray-100"}`}>
          <div className="text-[11px] font-black text-gray-400 uppercase tracking-wide">
            Question {qi + 1} of {questions.length}
          </div>
          <h3 className="text-[15px] font-black text-gray-900 mt-0.5">{q.prompt}</h3>
          {q.help_text && (
            <p className="text-[13px] text-gray-600 mt-1 leading-relaxed">{q.help_text}</p>
          )}

          <div className="mt-3 space-y-1.5">
            {optionsFor(q).map(o => {
              const picks = (draft[q.id] && draft[q.id].option_ids) || [];
              const at = picks.indexOf(o.id);
              const on = at >= 0;
              const full = q.type === "ranked" && picks.length >= 3;
              return (
                <button key={o.id} type="button"
                  onClick={() => q.type === "ranked" ? setRanked(q.id, o.id, 3) : setSingle(q.id, o.id)}
                  aria-pressed={on}
                  className={`flex w-full items-center gap-2.5 rounded-2xl border px-3 py-2.5 text-left transition ${
                    on ? "border-gray-900 bg-gray-900" : "border-gray-100 bg-white"} ${
                    !on && full ? "opacity-50" : ""}`}>
                  {q.type === "ranked" && (
                    <span className={`inline-flex h-6 w-6 flex-none items-center justify-center rounded-full text-[11px] font-black ${
                      on ? "bg-white text-gray-900" : "border border-dashed border-gray-300 text-gray-300"}`}>
                      {on ? at + 1 : ""}
                    </span>
                  )}
                  <span className={`text-[13px] font-bold ${on ? "text-white" : "text-gray-900"}`}>
                    {o.label}
                  </span>
                  {on && q.type === "ranked" && (
                    <span className="ml-auto text-[11px] font-bold text-gray-300">
                      {PLACE_WORD[at]} · {PLACE_POINTS[at]} pts
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {problems[q.id] && (
            <p className="mt-2 text-[11px] font-bold text-red-600">{problems[q.id]}</p>
          )}
        </div>
      ))}

      {err && <p className="mb-3 text-[13px] font-bold text-red-600">{err}</p>}

      <button onClick={submit} disabled={busy}
        className="w-full rounded-2xl bg-gray-900 px-4 py-3.5 text-[13px] font-black text-white active:opacity-60 disabled:opacity-40">
        {busy ? "Sending..." : "Submit my ballot"}
      </button>
      <p className="mt-2 text-center text-[11px] text-gray-500">
        You cannot change your ballot after submitting.
      </p>
    </div>
  );
}
