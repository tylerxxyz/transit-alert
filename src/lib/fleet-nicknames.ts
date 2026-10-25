// Real, publicly-known nicknames for specific rolling stock, keyed by the
// same identifier format the rest of the app already uses for that fleet
// type (VLocity 3-car set string, 4-digit Sprinter number, N-class loco
// number) — supplied directly by Tyler, not inferred or guessed.

const VLOCITY_SET_NICKNAMES: Record<string, string> = {
  "851M-1626T-852M": "Iramoo",
  "853M-1627T-854M": "Flinders Flyer",
  "859M-1630T-860M": "Westernport",
  "865M-1633T-866M": "Flash",
  "871M-1636T-872M": "Melbourne Rocks",
  "873M-1637T-874M": "Croydon West",
  "925M-1663T-926M": "Don Corrie",
};

const SPRINTER_NICKNAMES: Record<string, string> = {
  "7001": "Sir Hubert Opperman",
  "7002": "Steve Moneghetti",
  "7003": "James Tomkins",
  "7004": "Nick Green",
  "7005": "Michael McKay",
  "7006": "Andrew Cooper",
  "7007": "Faith Leech",
  "7008": "Gary Ablett",
  "7009": "Bob Davis",
  "7010": "Andrew Gaze",
  "7011": "Raelene Boyle",
  "7012": "Roy Higgins",
  "7013": "Lionel Rose",
  "7014": "Kirstie Marshall",
  "7015": "Louise Dobson",
  "7016": "Michael Tuck",
  "7017": "Debbie Flintoff-King",
  "7018": "Bill Roycroft",
  "7019": "Danni Roche (scrapped)",
  // 7020-7022 carry no public nickname.
};

const N_CLASS_NICKNAMES: Record<string, string> = {
  N451: "City of Portland",
  N452: "Rural City of Wodonga",
  N453: "City of Albury",
  N454: "City of Horsham",
  N455: "City of Swan Hill",
  N456: "City of Colac",
  N457: "City of Mildura",
  N458: "City of Maryborough",
  N459: "City of Echuca",
  N460: "City of Castlemaine",
  N461: "City of Ararat",
  N462: "City of Shepparton",
  N463: "City of Bendigo",
  N464: "City of Geelong",
  N465: "City of Ballaarat",
  N466: "City of Warrnambool",
  N467: "City of Stawell",
  N468: "City of Bairnsdale",
  N469: "City of Morwell",
  N470: "City of Wangaratta",
  N471: "City of Benalla",
  N472: "City of Sale",
  N473: "City of Warragul",
  N474: "City of Traralgon",
  N475: "City of Moe",
};

// Accepts a VLocity set string ("851M-1626T-852M", en-dash or hyphen), a
// bare Sprinter number ("7001"), or an N-class loco number ("N456"/"456").
export function getFleetNickname(identifier: string | null | undefined): string | undefined {
  if (!identifier) return undefined;
  const normalised = identifier.trim().replace(/–/g, "-").toUpperCase();
  if (VLOCITY_SET_NICKNAMES[normalised]) return VLOCITY_SET_NICKNAMES[normalised];
  if (SPRINTER_NICKNAMES[normalised]) return SPRINTER_NICKNAMES[normalised];
  if (N_CLASS_NICKNAMES[normalised]) return N_CLASS_NICKNAMES[normalised];
  // Sprinter numbers are sometimes reported with a leading "S" (e.g.
  // "S7018"); N-class locos are sometimes reported without the leading "N".
  const bareDigits = normalised.replace(/^S/, "");
  if (SPRINTER_NICKNAMES[bareDigits]) return SPRINTER_NICKNAMES[bareDigits];
  const nClassKey = normalised.startsWith("N") ? normalised : `N${normalised}`;
  if (N_CLASS_NICKNAMES[nClassKey]) return N_CLASS_NICKNAMES[nClassKey];
  return undefined;
}
