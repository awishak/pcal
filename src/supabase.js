import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://msvgstunqxjmmsmmumgg.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1zdmdzdHVucXhqbW1zbW11bWdnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYzMTU4MjIsImV4cCI6MjA5MTg5MTgyMn0.QkOb0eu5dlHrItsFeFCU8KxAakgQnYjM7pqv7zzmURU";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false },
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
  const token = getAdminToken();
  if (!token) return [];
  const { data, error } = await supabase.rpc("admin_list_registrations", { p_token: token });
  if (error) { console.error("adminListRegistrations error:", error); return []; }
  return data || [];
}

export async function adminUpdateRegistration(id, payload) {
  const token = getAdminToken();
  if (!token) return { error: "not admin" };
  const { data, error } = await supabase.rpc("admin_update_registration", {
    p_token: token, p_id: id, p_payload: payload,
  });
  if (error) { console.error("adminUpdateRegistration error:", error); return { error: error.message }; }
  return data;
}

export async function adminDeleteRegistration(id) {
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
    if (error) { console.error("sendEmail error:", error); return { error: error.message }; }
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
