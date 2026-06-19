// Canonical player-name aliases. Maps an uppercased name variant (typos,
// reversed first/last, nicknames) to the canonical uppercased name. Applied
// at game_log load (App installGameLog) and when merging committed box-score
// rows in the live view. Single source of truth so the App and Live views
// stay in sync.
export const PLAYER_MERGE = {
  "HANNA JOHN": "RAMZY HANNA JOHN",
  "RAMZY JOHN": "RAMZY HANNA JOHN",
  "MASDARY JOSHUA": "MASDARY JOSH",
  "BOTROS JOHN": "BOTROS JOHNNY",
  "MOUSSA ANTHONY": "MOUSSA TONY",
  "MALEK CHRIS": "MALEK CHRISTOPHER",
  "GUIRGUIS KIROLOUS": "GUIRGUIS KIRO",
  "GUIRGUIS  KIRO": "GUIRGUIS KIRO",
  "OKI CHRISTOPHER": "OKI CHRIS",
  "ROUHANI DAVE": "ROUHANI DAVID",
  "ELIA STEVE": "ELIA STEPHEN",
  "MALEK JOHNNY": "MALEK JOHN",
  "ABDELSHAID  MOSES": "ABDELSHAID MOSES",
  "SAWIRIS RAFY": "SAWIRIS RAFAEL",
  "AGAIBY MATTHEW": "GEBRAEIL MATTHEW",
  // Phase 3 alias merges (game_log spelling -> canonical display name).
  "FARAG PAVLY": "ATALLAH PAVLY",
  "HANNA JOSEPH": "HANNA JOE",
  "EKDAWY ANGELINA": "EKDAWY ANGIE",
  "MICHAEL JAMES": "MICHAEL JIMMY",
  "ABDELSHAHID LANS": "ABDELSHAHID LANCE",
  "ABDELSHAID  JOSH": "ABDELSHAID JOSHUA",
  "ESTEFAN FADI": "ESTEFAN FADY",
  "JONATHAN KALDANI": "KALDANI JONATHAN",
  "NAKHLA GUEST BESADA": "GUEST NAKHLA BESADA",
  "SAWIRIS 23": "GUEST SAWIRIS",
  "JOHNNY ESKANDER": "ESKANDAR JOHNY",
};

// Uppercase a raw name and resolve it through PLAYER_MERGE to its canonical
// key. Names with no alias return their own uppercased form.
export function canonicalKey(name) {
  const u = (name || "").toUpperCase();
  return PLAYER_MERGE[u] || u;
}
