import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://msvgstunqxjmmsmmumgg.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1zdmdzdHVucXhqbW1zbW11bWdnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYzMTU4MjIsImV4cCI6MjA5MTg5MTgyMn0.QkOb0eu5dlHrItsFeFCU8KxAakgQnYjM7pqv7zzmURU";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storageKey: "pcal_supabase_auth",
  },
});

// ============================================================================
// ADMIN AUTH
// ============================================================================
// The admin password is verified server-side via an RPC that returns a token.
// The token is stored in localStorage and sent on every admin write.

const ADMIN_TOKEN_KEY = "pcal_admin_token";

export function getAdminToken() {
  try {
    return window.localStorage.getItem(ADMIN_TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setAdminToken(token) {
  try {
    if (token) window.localStorage.setItem(ADMIN_TOKEN_KEY, token);
    else window.localStorage.removeItem(ADMIN_TOKEN_KEY);
  } catch {}
}

export async function verifyAdminPassword(password) {
  const { data, error } = await supabase.rpc("verify_admin_password", { p_password: password });
  if (error) { console.error("verify_admin_password error:", error); return null; }
  return data; // token string or null
}

export async function checkAdminToken(token) {
  if (!token) return false;
  const { data, error } = await supabase.rpc("is_admin", { p_token: token });
  if (error) { console.error("is_admin error:", error); return false; }
  return !!data;
}

// ============================================================================
// CONFIG (tile visibility, home card visibility, group order, etc.)
// ============================================================================

export async function loadAdminConfig() {
  const { data, error } = await supabase.from("admin_config").select("config").eq("id", 1).maybeSingle();
  if (error) { console.error("loadAdminConfig error:", error); return {}; }
  return data?.config || {};
}

export async function saveAdminConfig(config) {
  const token = getAdminToken();
  if (!token) return { error: "not admin" };
  const { data, error } = await supabase.rpc("admin_save_config", { p_token: token, p_config: config });
  if (error) { console.error("saveAdminConfig error:", error); return { error: error.message }; }
  return data;
}

// ============================================================================
// HOME CONTENT: commissioner_messages, sticky_links, quick_links,
// livestream_urls, photo_cards
// ============================================================================

export async function loadHomeContent() {
  const [msgs, sticky, quick, livestreams, photos] = await Promise.all([
    supabase.from("commissioner_messages").select("*").order("sort_order").order("created_at", { ascending: false }),
    supabase.from("sticky_links").select("*").order("sort_order"),
    supabase.from("quick_links").select("*").order("sort_order"),
    supabase.from("livestream_urls").select("*").order("sort_order"),
    supabase.from("photo_cards").select("*").order("sort_order").order("created_at", { ascending: false }),
  ]);
  return {
    commissionerMessages: (msgs.data || []).map(m => ({
      id: m.id,
      type: m.message_type || "custom",
      title: m.title || "",
      body: m.body || "",
      imageUrl: m.image_url || "",
      date: m.date_label || "",
      status: m.status || "active",
      sort_order: m.sort_order || 0,
    })),
    stickyLinks: (sticky.data || []).map(r => ({
      id: r.id, label: r.label, url: r.url, icon: r.icon || "link", sort_order: r.sort_order || 0,
    })),
    quickLinks: (quick.data || []).map(r => ({
      id: r.id, label: r.label, url: r.url, sort_order: r.sort_order || 0,
    })),
    livestreamUrls: (livestreams.data || []).map(r => ({
      id: r.id, label: r.label, url: r.url, sort_order: r.sort_order || 0,
    })),
    photoCards: (photos.data || []).map(p => ({
      id: p.id, imageUrl: p.image_url, caption: p.caption || "", date: p.date_label || "", sort_order: p.sort_order || 0,
    })),
  };
}

// Helpers for each table
function toDbRow(tableKey, item) {
  if (tableKey === "commissioner_messages") {
    return {
      id: item.id, title: item.title || null, body: item.body || null,
      image_url: item.imageUrl || null, date_label: item.date || null,
      status: item.status || "active", sort_order: item.sort_order || 0,
      message_type: item.type || "custom",
    };
  }
  if (tableKey === "sticky_links") {
    return { id: item.id, label: item.label, url: item.url, icon: item.icon || "link", sort_order: item.sort_order || 0 };
  }
  if (tableKey === "quick_links" || tableKey === "livestream_urls") {
    return { id: item.id, label: item.label, url: item.url, sort_order: item.sort_order || 0 };
  }
  if (tableKey === "photo_cards") {
    return {
      id: item.id, image_url: item.imageUrl, caption: item.caption || null,
      date_label: item.date || null, sort_order: item.sort_order || 0,
    };
  }
  return item;
}

export async function adminUpsertRow(tableKey, item) {
  const token = getAdminToken();
  if (!token) return { error: "not admin" };
  const row = toDbRow(tableKey, item);
  const { data, error } = await supabase.rpc("admin_upsert_row", {
    p_token: token, p_table: tableKey, p_row: row,
  });
  if (error) { console.error("adminUpsertRow error:", error); return { error: error.message }; }
  return data;
}

export async function adminDeleteRow(tableKey, id) {
  const token = getAdminToken();
  if (!token) return { error: "not admin" };
  const { data, error } = await supabase.rpc("admin_delete_row", {
    p_token: token, p_table: tableKey, p_id: id,
  });
  if (error) { console.error("adminDeleteRow error:", error); return { error: error.message }; }
  return data;
}

// ============================================================================
// REGISTRATIONS
// ============================================================================

export async function submitRegistration(payload, pin) {
  const { data, error } = await supabase.rpc("submit_registration", {
    payload, p_pin: pin,
  });
  if (error) { console.error("submitRegistration error:", error); return { error: error.message }; }
  return data; // { id: <uuid> }
}

export async function verifyRegistrationPin(email, pin) {
  const { data, error } = await supabase.rpc("verify_registration_pin", {
    p_email: email, p_pin: pin,
  });
  if (error) { console.error("verifyRegistrationPin error:", error); return null; }
  // RPC returns a record; if not found, fields will be null
  if (!data || !data.id) return null;
  return data;
}

export async function updateOwnRegistration(email, pin, payload) {
  const { data, error } = await supabase.rpc("update_own_registration", {
    p_email: email, p_pin: pin, p_payload: payload,
  });
  if (error) { console.error("updateOwnRegistration error:", error); return { error: error.message }; }
  return data;
}

export async function adminListRegistrations() {
  // Prefer the auth-based RPC when the user has a Supabase Auth session
  // with admin/commissioner role. Fall back to the token-based RPC for
  // legacy admin-password flows.
  const session = await getCurrentSession();
  if (session) {
    const { data, error } = await supabase.rpc("admin_list_registrations_auth");
    if (!error) return data || [];
    // If auth RPC fails (user isn't admin, or RPC missing), fall through
    // to token fallback.
    console.error("admin_list_registrations_auth error:", error);
  }
  const token = getAdminToken();
  if (!token) return [];
  const { data, error } = await supabase.rpc("admin_list_registrations", { p_token: token });
  if (error) { console.error("adminListRegistrations error:", error); return []; }
  return data || [];
}

export async function adminUpdateRegistration(id, payload) {
  const session = await getCurrentSession();
  if (session) {
    const { data, error } = await supabase.rpc("admin_update_registration_auth", {
      p_id: id, p_payload: payload,
    });
    if (!error) return data;
    console.error("admin_update_registration_auth error:", error);
  }
  const token = getAdminToken();
  if (!token) return { error: "not admin" };
  const { data, error } = await supabase.rpc("admin_update_registration", {
    p_token: token, p_id: id, p_payload: payload,
  });
  if (error) { console.error("adminUpdateRegistration error:", error); return { error: error.message }; }
  return data;
}

export async function adminDeleteRegistration(id) {
  const session = await getCurrentSession();
  if (session) {
    const { data, error } = await supabase.rpc("admin_delete_registration_auth", { p_id: id });
    if (!error) return data;
    console.error("admin_delete_registration_auth error:", error);
  }
  const token = getAdminToken();
  if (!token) return { error: "not admin" };
  const { data, error } = await supabase.rpc("admin_delete_registration", {
    p_token: token, p_id: id,
  });
  if (error) { console.error("adminDeleteRegistration error:", error); return { error: error.message }; }
  return data;
}

// ============================================================================
// STORAGE: image uploads to 'photos' bucket
// ============================================================================

export async function uploadPhoto(file) {
  const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
  const path = `upload_${Date.now()}_${Math.floor(Math.random() * 10000)}.${ext}`;
  const { data, error } = await supabase.storage.from("photos").upload(path, file, {
    cacheControl: "3600", upsert: false,
  });
  if (error) { console.error("uploadPhoto error:", error); return { error: error.message }; }
  const { data: urlData } = supabase.storage.from("photos").getPublicUrl(data.path);
  return { url: urlData.publicUrl };
}

// ============================================================================
// REGISTRATION ANNOUNCEMENTS (public read)
// ============================================================================

export async function loadAnnouncedRegistrations() {
  const { data, error } = await supabase.rpc("get_announced_registrations");
  if (error) { console.error("loadAnnouncedRegistrations error:", error); return []; }
  return data || [];
}

export async function adminToggleAnnouncement(id, announce, quote) {
  const token = getAdminToken();
  if (!token) return { error: "not admin" };
  const { data, error } = await supabase.rpc("admin_update_registration", {
    p_token: token, p_id: id,
    p_payload: { announce_registration: announce, reg_quote: quote || null },
  });
  if (error) { console.error("adminToggleAnnouncement error:", error); return { error: error.message }; }
  return data;
}

// Writes free-form overrides onto a registration so the home-page announcement
// can be admin-edited. Pass null for any field you don't want to change... no
// actually, this function always sets all three so the caller knows exactly
// what's persisted. To clear an override, pass an empty string or null.
export async function adminUpdateAnnouncementOverride(id, { displayNameOverride, announcementOverride, hidden }) {
  const token = getAdminToken();
  if (!token) return { error: "not admin" };
  const { data, error } = await supabase.rpc("admin_update_announcement_override", {
    p_token: token,
    p_id: id,
    p_name_override: displayNameOverride || null,
    p_announcement: announcementOverride || null,
    p_hidden: !!hidden,
  });
  if (error) { console.error("adminUpdateAnnouncementOverride error:", error); return { error: error.message }; }
  return data;
}

// ============================================================================
// GAME LOG ADMIN (Supabase)
// ============================================================================

export async function adminSearchGameLog(query) {
  const token = getAdminToken();
  if (!token) return { error: "not admin" };
  const { data, error } = await supabase.rpc("admin_search_game_log", {
    p_token: token, p_query: query,
  });
  if (error) { console.error("adminSearchGameLog error:", error); return { error: error.message }; }
  return data || [];
}

export async function adminUpdateGameLog(id, rowData) {
  const token = getAdminToken();
  if (!token) return { error: "not admin" };
  const { data, error } = await supabase.rpc("admin_update_game_log", {
    p_token: token, p_id: id, p_data: rowData,
  });
  if (error) { console.error("adminUpdateGameLog error:", error); return { error: error.message }; }
  return data;
}

export async function adminAddGameLog(rowData) {
  const token = getAdminToken();
  if (!token) return { error: "not admin" };
  const { data, error } = await supabase.rpc("admin_add_game_log", {
    p_token: token, p_data: rowData,
  });
  if (error) { console.error("adminAddGameLog error:", error); return { error: error.message }; }
  return data;
}

export async function adminDeleteGameLog(id) {
  const token = getAdminToken();
  if (!token) return { error: "not admin" };
  const { data, error } = await supabase.rpc("admin_delete_game_log", {
    p_token: token, p_id: id,
  });
  if (error) { console.error("adminDeleteGameLog error:", error); return { error: error.message }; }
  return data;
}

export async function adminBatchUpdateGameLog(ids, updates) {
  const token = getAdminToken();
  if (!token) return { error: "not admin" };
  const { data, error } = await supabase.rpc("admin_batch_update_game_log", {
    p_token: token, p_ids: ids, p_data: updates,
  });
  if (error) { console.error("adminBatchUpdateGameLog error:", error); return { error: error.message }; }
  return data;
}

// ============================================================================
// EMAIL (via Supabase Edge Function -> Resend)
// ============================================================================

// Sends an email by calling the `send-email` edge function.
// Returns { ok: true, id } on success or { error } on failure.
export async function sendEmail({ to, subject, html, bcc, replyTo }) {
  try {
    const { data, error } = await supabase.functions.invoke("send-email", {
      body: { to, subject, html, bcc, replyTo },
    });
    if (error) {
      // supabase.functions.invoke returns a generic "non-2xx status code"
      // error message and hides the actual response body. Try to unwrap it.
      let detail = error.message;
      if (error.context && error.context.body) {
        try {
          const text = await error.context.text();
          detail = detail + " | " + text;
        } catch {}
      } else if (error.context && typeof error.context.text === "function") {
        try {
          const text = await error.context.text();
          detail = detail + " | " + text;
        } catch {}
      }
      console.error("sendEmail error:", detail, error);
      return { error: detail };
    }
    return data;
  } catch (e) {
    console.error("sendEmail error:", e);
    return { error: String(e) };
  }
}

// Requests a 6-digit verification code for an email, stores it in Supabase,
// then triggers the edge function to email it. Returns { ok: true } on success.
export async function requestEmailVerification(email) {
  // 1. Generate & store the code via RPC
  const { data: code, error } = await supabase.rpc("generate_email_verification", { p_email: email });
  if (error) { console.error("generate_email_verification error:", error); return { error: error.message }; }
  if (!code) return { error: "Failed to generate code" };
  // 2. Email the code
  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width: 480px; margin: 0 auto; padding: 20px;">
      <h2 style="color: #111827; margin: 0 0 12px 0;">PCAL League Email Verification</h2>
      <p style="color: #4b5563; font-size: 15px; line-height: 1.6; margin: 0 0 16px 0;">
        Enter this 6-digit code in the registration form to verify your email:
      </p>
      <div style="background: #f3f4f6; border: 2px dashed #d1d5db; border-radius: 12px; padding: 20px; text-align: center; margin: 20px 0;">
        <p style="font-size: 36px; font-weight: 900; letter-spacing: 0.3em; color: #111827; margin: 0; font-family: monospace;">${code}</p>
      </div>
      <p style="color: #6b7280; font-size: 13px; margin: 16px 0 0 0;">This code expires in 15 minutes.</p>
      <p style="color: #9ca3af; font-size: 12px; margin: 24px 0 0 0;">If you didn't request this, you can ignore this email.</p>
    </div>
  `;
  const emailRes = await sendEmail({
    to: email,
    subject: "Your PCAL registration verification code",
    html,
  });
  if (emailRes?.error) return { error: "Email failed: " + emailRes.error };
  return { ok: true };
}

// Verifies a code against the email. Returns true/false.
export async function verifyEmailCode(email, code) {
  const { data, error } = await supabase.rpc("check_email_verification", {
    p_email: email, p_code: code,
  });
  if (error) { console.error("check_email_verification error:", error); return false; }
  return !!data;
}

// Sends the confirmation email after a successful registration with all form
// info, the PIN, and a link to pcaleague.com. BCCs the commissioner.
export async function sendRegistrationConfirmation(form, pin) {
  const pretty = (k) => k.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
  const toName = `${form.firstName || ""} ${form.lastName || ""}`.trim() || "Player";
  const rows = [
    ["Name", `${form.firstName} ${form.lastName}`],
    ["Email", form.email],
    ["Phone", form.phone || "—"],
    ["Date of Birth", form.dob || "—"],
    ["Address", [form.address, form.city, form.zip].filter(Boolean).join(", ") || "—"],
    ["Emergency Contact", [form.emergencyContact, form.emergencyPhone].filter(Boolean).join(" — ") || "—"],
    ["Eligibility", form.eligibility || "—"],
    ["Team Preference", form.teamPref || "—"],
    ["Community Team Preference", form.communityTeam || "—"],
    ["Available Dates", (form.dates || []).length ? form.dates.join(", ") : "—"],
    ["Volunteer Roles", (form.roles || []).length ? form.roles.join(", ") : "—"],
    ["Volunteer Buyout", form.buyoutVolunteer ? "Yes ($100)" : "No"],
    ["Conflict Note", form.conflictsNote || "—"],
  ];
  const rowsHtml = rows.map(([k, v]) => `
    <tr>
      <td style="padding: 8px 12px; border-bottom: 1px solid #f3f4f6; color: #6b7280; font-size: 13px; width: 40%;">${k}</td>
      <td style="padding: 8px 12px; border-bottom: 1px solid #f3f4f6; color: #111827; font-size: 13px; font-weight: 600;">${v}</td>
    </tr>
  `).join("");

  const headshotHtml = form.headshotUrl ? `
    <div style="text-align: center; margin: 0 0 20px 0;">
      <img src="${form.headshotUrl}" alt="Headshot" style="width: 120px; height: 120px; border-radius: 12px; object-fit: cover; border: 2px solid #e5e7eb;" />
    </div>
  ` : "";

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width: 560px; margin: 0 auto; padding: 20px;">
      <h2 style="color: #111827; margin: 0 0 8px 0;">Registration Received</h2>
      <p style="color: #4b5563; font-size: 15px; line-height: 1.6; margin: 0 0 20px 0;">
        Hi ${toName}, thanks for registering for the PCAL 2026 Summer Basketball League. Here's your submission.
      </p>
      ${headshotHtml}
      <div style="background: #fef3c7; border: 2px dashed #fbbf24; border-radius: 12px; padding: 16px; text-align: center; margin: 0 0 20px 0;">
        <p style="color: #92400e; font-size: 11px; font-weight: 700; letter-spacing: 0.15em; text-transform: uppercase; margin: 0 0 4px 0;">Your PIN</p>
        <p style="font-size: 32px; font-weight: 900; letter-spacing: 0.3em; color: #78350f; margin: 0; font-family: monospace;">${pin}</p>
        <p style="color: #92400e; font-size: 12px; margin: 8px 0 0 0;">Save this PIN. You'll need it to edit your registration.</p>
      </div>
      <table style="width: 100%; border-collapse: collapse; border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden; margin: 0 0 20px 0;">
        ${rowsHtml}
      </table>
      <div style="text-align: center; margin: 24px 0;">
        <a href="https://pcaleague.com"
           style="display: inline-block; background: #111827; color: white; text-decoration: none; padding: 12px 24px; border-radius: 12px; font-weight: 700; font-size: 14px;">
          Visit pcaleague.com
        </a>
      </div>
      <p style="color: #9ca3af; font-size: 12px; text-align: center; margin: 24px 0 0 0;">
        Questions? Reply to this email. Registration closes Thursday, May 8 at 11:59 PM Pacific.
      </p>
    </div>
  `;

  return sendEmail({
    to: form.email,
    subject: "PCAL Registration Confirmation",
    html,
    bcc: "andrewishak@gmail.com",
    replyTo: "andrewishak@gmail.com",
  });
}

// ============================================================================
// GAME LOG LOADING
// ============================================================================
// Fetches the entire game_log table from Supabase and converts each row to
// the 21-element positional array format the app expects. Results are cached
// in localStorage keyed on a version string; if the cache is present and the
// version matches, we return the cached data immediately and skip the fetch.
//
// Column order (must match the historical baked-in GAME_LOG):
//   [0] player, [1] team, [2] opp, [3] week, [4] date, [5] game_type,
//   [6] g, [7] pts, [8] reb, [9] stl, [10] ast, [11] blk,
//   [12] fgm, [13] fga, [14] ftm, [15] fta, [16] tpm, [17] tpa,
//   [18] foul, [19] gmsc, [20] year
//
// To force a refresh after approving a new game, call bumpGameLogCache()
// or pass { force: true } to loadGameLog().

const GAME_LOG_CACHE_KEY = "pcal_game_log_v2";
const GAME_LOG_VERSION_KEY = "pcal_game_log_version";
const GAME_LOG_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

// Map a game_log row object (from Supabase) into the 21-element positional
// array format the App.jsx code expects. Missing fields default to 0 / "".
function gameLogRowToArray(r) {
  return [
    r.player || "",
    r.team || "",
    r.opp || "",
    r.week || 0,
    r.date || "",
    r.game_type || "R",
    r.g || 0,
    r.pts || 0,
    r.reb || 0,
    r.stl || 0,
    r.ast || 0,
    r.blk || 0,
    r.fgm || 0,
    r.fga || 0,
    r.ftm || 0,
    r.fta || 0,
    r.tpm || 0,
    r.tpa || 0,
    r.foul || 0,
    r.gmsc || 0,
    r.year || 0,
  ];
}

// Fetch every row from game_log using range-based pagination. PostgREST
// caps queries at 1000 rows per request, so we loop until an empty batch.
async function fetchAllGameLogRows() {
  const pageSize = 1000;
  const out = [];
  let from = 0;
  for (;;) {
    const to = from + pageSize - 1;
    const { data, error } = await supabase
      .from("game_log")
      .select("*")
      .order("year", { ascending: true })
      .order("date", { ascending: true })
      .range(from, to);
    if (error) throw new Error("game_log fetch failed: " + error.message);
    if (!data || data.length === 0) break;
    out.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return out;
}

// Load the full game log. Checks localStorage first; if cache is valid,
// returns cached data immediately. Otherwise fetches from Supabase, caches,
// and returns.
//
// Options:
//   force: true        - skip cache, always fetch
//   onProgress: fn     - called with { loaded, total? } during fetch
//
// Returns an array of 21-element arrays.
export async function loadGameLog(options = {}) {
  const { force = false } = options;

  if (!force) {
    try {
      const cached = window.localStorage.getItem(GAME_LOG_CACHE_KEY);
      const versionAt = window.localStorage.getItem(GAME_LOG_VERSION_KEY);
      if (cached && versionAt) {
        const age = Date.now() - parseInt(versionAt, 10);
        if (age >= 0 && age < GAME_LOG_TTL_MS) {
          const arr = JSON.parse(cached);
          if (Array.isArray(arr) && arr.length > 0) {
            return arr;
          }
        }
      }
    } catch (e) {
      // Cache read failed; fall through to fresh fetch.
      console.warn("game_log cache read failed:", e);
    }
  }

  const rows = await fetchAllGameLogRows();
  const arr = rows.map(gameLogRowToArray);

  try {
    window.localStorage.setItem(GAME_LOG_CACHE_KEY, JSON.stringify(arr));
    window.localStorage.setItem(GAME_LOG_VERSION_KEY, String(Date.now()));
  } catch (e) {
    // localStorage may be full or disabled; not fatal.
    console.warn("game_log cache write failed:", e);
  }

  return arr;
}

// Invalidate the cached game_log so the next loadGameLog() call re-fetches.
// Call this after approving or reversing a game so stats pages reflect the
// new data on the next page load.
export function bumpGameLogCache() {
  try {
    window.localStorage.removeItem(GAME_LOG_CACHE_KEY);
    window.localStorage.removeItem(GAME_LOG_VERSION_KEY);
  } catch {}
}

// ============================================================================
// SUPABASE AUTH (Phase 1: role-based)
// ============================================================================
// These functions wrap Supabase's built-in auth with role resolution. After
// a successful login, call loadCurrentUserRoles() to pull the user's roles
// from user_roles (with auto-grants from registrations/approved_staff/etc.).
//
// Auth flow:
//   1. User enters email, app calls requestLoginCode(email)
//   2. Supabase emails both a magic link and a 6-digit code
//   3. User either clicks the link (app detects session on return) or
//      enters the code into a prompt; app calls verifyLoginCode(email, code)
//   4. On success, app calls loadCurrentUserRoles() and caches in state
//
// Master-password backdoor:
//   1. User enters master password on the Stats page
//   2. App calls verifyCommissionerPassword(password)
//   3. On success, app calls requestLoginCode() for the commissioner email
//   4. Commissioner receives OTP, enters code, gets commissioner session

// Send a login code/link to an email. The OTP is the 6-digit code that
// appears in the email body alongside the magic link.
export async function requestLoginCode(email) {
  const { error } = await supabase.auth.signInWithOtp({
    email: email.trim().toLowerCase(),
    options: {
      shouldCreateUser: true,
      emailRedirectTo: window.location.origin,
    },
  });
  if (error) { console.error("requestLoginCode error:", error); return { error: error.message }; }
  return { ok: true };
}

// Verify a 6-digit code. Returns the resulting session or an error.
export async function verifyLoginCode(email, code) {
  const { data, error } = await supabase.auth.verifyOtp({
    email: email.trim().toLowerCase(),
    token: code.trim(),
    type: "email",
  });
  if (error) { console.error("verifyLoginCode error:", error); return { error: error.message }; }
  return { ok: true, session: data.session, user: data.user };
}

// Sign out the current user.
export async function signOutUser() {
  const { error } = await supabase.auth.signOut();
  if (error) { console.error("signOutUser error:", error); return { error: error.message }; }
  return { ok: true };
}

// Get the current session (or null if not signed in).
export async function getCurrentSession() {
  const { data, error } = await supabase.auth.getSession();
  if (error) { console.error("getCurrentSession error:", error); return null; }
  return data.session;
}

// Subscribe to auth state changes. Returns an unsubscribe function.
// The callback receives (event, session). Events are: SIGNED_IN, SIGNED_OUT,
// TOKEN_REFRESHED, USER_UPDATED, PASSWORD_RECOVERY.
export function onAuthStateChange(callback) {
  const { data } = supabase.auth.onAuthStateChange(callback);
  return () => data.subscription.unsubscribe();
}

// Resolve the current user's roles. Calls the SQL RPC which auto-grants
// roles from registrations/approved_staff/commissioner hardcode and returns
// all roles. Returns an array of role row objects, or [] if not signed in.
export async function loadCurrentUserRoles() {
  const { data, error } = await supabase.rpc("resolve_current_user_roles");
  if (error) { console.error("loadCurrentUserRoles error:", error); return []; }
  return data || [];
}

// Verify the commissioner master password. On success returns
// { ok: true, commissioner_email }. The caller should then initiate a
// normal OTP login flow for that email.
export async function verifyCommissionerPassword(password) {
  const { data, error } = await supabase.rpc("verify_commissioner_password", { p_password: password });
  if (error) { console.error("verifyCommissionerPassword error:", error); return { ok: false, error: error.message }; }
  return data;
}

// Change the commissioner password (must be logged in as commissioner).
export async function changeCommissionerPassword(newPassword) {
  const { data, error } = await supabase.rpc("change_commissioner_password", { p_new_password: newPassword });
  if (error) { console.error("changeCommissionerPassword error:", error); return { ok: false, error: error.message }; }
  return data;
}

// Grant a role to a user by email. Only admins/commissioners; only
// commissioner can grant 'admin'. team_scope is optional and only used for
// role='team_rep'.
export async function adminGrantRole(email, role, teamScope = null) {
  const { data, error } = await supabase.rpc("grant_user_role", {
    p_email: email,
    p_role: role,
    p_team_scope: teamScope,
  });
  if (error) { console.error("adminGrantRole error:", error); return { ok: false, error: error.message }; }
  return data;
}

// Revoke a role from a user by email.
export async function adminRevokeRole(email, role, teamScope = null) {
  const { data, error } = await supabase.rpc("revoke_user_role", {
    p_email: email,
    p_role: role,
    p_team_scope: teamScope,
  });
  if (error) { console.error("adminRevokeRole error:", error); return { ok: false, error: error.message }; }
  return data;
}

// Submit a staff access request from the public form. No auth required.
export async function submitStaffRequest({ firstName, lastName, email, phone, requestedRole, notes }) {
  const { error } = await supabase.from("staff_requests").insert({
    first_name: firstName,
    last_name: lastName,
    email: email.trim().toLowerCase(),
    phone: phone || null,
    requested_role: requestedRole,
    notes: notes || null,
  });
  if (error) { console.error("submitStaffRequest error:", error); return { ok: false, error: error.message }; }
  return { ok: true };
}

// Admin: list staff requests, optionally filtered by status.
export async function adminListStaffRequests(status = "pending") {
  let q = supabase.from("staff_requests").select("*").order("created_at", { ascending: false });
  if (status) q = q.eq("status", status);
  const { data, error } = await q;
  if (error) { console.error("adminListStaffRequests error:", error); return []; }
  return data || [];
}

// Admin: approve a staff request (moves to approved_staff).
export async function adminApproveStaffRequest(requestId) {
  const { data, error } = await supabase.rpc("approve_staff_request", { p_request_id: requestId });
  if (error) { console.error("adminApproveStaffRequest error:", error); return { ok: false, error: error.message }; }
  return data;
}

// Admin: reject a staff request.
export async function adminRejectStaffRequest(requestId) {
  const { data, error } = await supabase.rpc("reject_staff_request", { p_request_id: requestId });
  if (error) { console.error("adminRejectStaffRequest error:", error); return { ok: false, error: error.message }; }
  return data;
}

// ============================================================================
// ADMIN GAME_LOG WRITES (Phase 1 auth-backed)
// ============================================================================
// These call server-side RPCs that check has_admin_or_commish() on the
// Supabase Auth session. They replace direct supabase.from("game_log")
// writes, which were failing under anon RLS.

export async function adminInsertGameLog(rows) {
  const { data, error } = await supabase.rpc("admin_insert_game_log", { p_rows: rows });
  if (error) { console.error("adminInsertGameLog error:", error); return { ok: false, error: error.message }; }
  return data;
}

export async function adminDeleteGameLogForGame({ year, week, date, homeTeam, awayTeam }) {
  const { data, error } = await supabase.rpc("admin_delete_game_log_for_game", {
    p_year: year,
    p_week: week,
    p_date: date,
    p_home: homeTeam,
    p_away: awayTeam,
  });
  if (error) { console.error("adminDeleteGameLogForGame error:", error); return { ok: false, error: error.message }; }
  return data;
}
