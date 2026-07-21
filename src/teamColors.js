// Team brand colors, shared by App.jsx and LiveSection.jsx. These were
// duplicated inside LiveSection; they live here so both files read the same
// values and a color change lands in one place.

export const TEAM_COLORS = {
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

// Team colors for chart marks (thin lines on a white card), which have a
// stricter job than a filled chip: a mark must clear 3:1 contrast against the
// surface or it is invisible. Every team color clears it except the two
// yellows, PLE (1.49:1) and SJK (1.87:1), so those get a darker step here.
// Chips and badges keep the brand color; only plotted marks use this map.
export const CHART_TEAM_COLORS = {
  ...TEAM_COLORS,
  PLE: "#a16207",
  SJK: "#a16207",
};

// Text color that reads well on top of TEAM_COLORS[team] background.
export const TEAM_TEXT_ON_BG = {
  PLE: "#000000",
};

export const textOnTeam = (team) => TEAM_TEXT_ON_BG[team] || "#ffffff";
