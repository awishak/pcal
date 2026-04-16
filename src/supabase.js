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
