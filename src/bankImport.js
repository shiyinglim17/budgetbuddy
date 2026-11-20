/* ============================================================
   BANK STATEMENT CSV IMPORT
   Parses a bank "transaction history" CSV export entirely in the browser.

   PRIVACY RULES (enforced here, not just by convention):
   - Preamble rows are only inspected for a small whitelist of labels
     (statement date, currency, available balance). Any other preamble row
     (e.g. "Account Details For:") is never split or parsed.
   - Only these columns are ever read: Transaction Date, Description, Status,
     Currency, Debit Amount, Credit Amount. Reference columns (Client
     Reference, Additional Reference, Supplementary Code…) are never accessed;
     they carry card / account numbers.
   - Descriptions are scrubbed of card numbers, account numbers, phone-like
     numbers and reference codes before anything leaves this module. A final
     guard rejects any description still containing a long digit run.
   - Nothing here logs, stores or returns the raw file text.
   ============================================================ */

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

// ---------- CSV ----------
function parseCsv(text, delim = ",") {
  const rows = [];
  let row = [], field = "", inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === delim) { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += ch;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// ---------- Helpers ----------
function parseAmount(s) {
  const n = Number(String(s || "").replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

// "19 Nov 2026" -> "2026-11-19"
function parseStatementDate(s) {
  const m = String(s || "").trim().match(/^(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s+(\d{4})$/);
  if (!m) return null;
  const mi = MONTHS.indexOf(m[2].toUpperCase());
  if (mi < 0) return null;
  return `${m[3]}-${String(mi + 1).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
}

// Card purchases carry the real purchase date (e.g. "14NOV") — use it when sane.
function resolvePurchaseDate(rawDesc, postedISO) {
  const matches = [...String(rawDesc).toUpperCase().matchAll(/\b(\d{2})(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\b/g)];
  if (!matches.length) return postedISO;
  const [, dd, mon] = matches[matches.length - 1];
  const [py, pm] = postedISO.split("-").map(Number);
  const mi = MONTHS.indexOf(mon) + 1;
  const year = mi > pm ? py - 1 : py;
  const iso = `${year}-${String(mi).padStart(2, "0")}-${dd}`;
  const diffDays = (new Date(postedISO) - new Date(iso)) / 86400000;
  return diffDays >= 0 && diffDays <= 45 ? iso : postedISO;
}

// Remove anything that could identify an account, card, phone or reference.
export function scrubSensitive(s) {
  return String(s || "")
    // split comma-joined tokens so a number never swallows a merchant name
    .replace(/,/g, ", ")
    // card numbers (full or masked), with or without separators
    .replace(/\b\d{4}[\s-]?[\dXx*]{4}[\s-]?[\dXx*]{4}[\s-]?\d{2,4}\b/g, " ")
    // account-number shapes like 123-456789-0 (optionally ":IB")
    .replace(/\b\d{2,4}-\d{4,8}-\d{1,4}(?::\w+)?\b/g, " ")
    // any token containing 5+ consecutive digits (refs, phones, partial cards)
    .replace(/\S*\d{5,}\S*/g, " ")
    // long mixed alphanumeric reference codes
    .replace(/\b(?=[A-Za-z0-9-]*\d)(?=[A-Za-z0-9-]*[A-Za-z])[A-Za-z0-9-]{10,}\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleCase(s) {
  if (s !== s.toUpperCase()) return s; // keep merchant's own casing
  return s.toLowerCase().replace(/\b([a-z])/g, (c) => c.toUpperCase());
}

// Turn a raw bank description into a clean, human label + payment method.
function describe(rawDesc, isCredit) {
  const raw = String(rawDesc || "");
  let method = "Other", label = "", counterpartyIsPerson = false, ownTransfer = false;

  let m;
  if (/^BAT\s/i.test(raw)) {
    method = "Card";
    label = scrubSensitive(raw.replace(/^BAT\s+/i, ""))
      // drop "SI SGP 14NOV" / "St SWE 11NOV" / "SGP 17NOV" trailers
      .replace(/\s+(?:\S{1,2}\s+)?[A-Z]{3}\s+\d{2}(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\b.*$/i, "")
      .replace(/\s+SINGAPORE$/i, "");
  } else if ((m = raw.match(/NETS QR PAYMENT.*?\bTO:\s*(.+)$/i))) {
    method = "NETS QR";
    label = scrubSensitive(m[1]);
  } else if (/^NETS\b/i.test(raw)) {
    method = "NETS";
    label = scrubSensitive(raw.replace(/^NETS\b/i, "")).replace(/^[,\s]+/, "").replace(/\s+NETS$/i, "");
  } else if ((m = raw.match(/PayNow.*?\b(To|From):\s*(.+?)(?:\s+OTHR\b.*)?$/i))) {
    method = "PayNow";
    const who = scrubSensitive(m[2]);
    counterpartyIsPerson = !/\b(PTE|LTD|LIMITED|LLP|INC|CORP|SHOPEEPAY|FOOD)\b/i.test(who);
    label = `PayNow ${m[1].toLowerCase() === "to" ? "to" : "from"} ${titleCase(who)}`;
  } else if (/^(IBG|PAY|GIRO)\s/i.test(raw)) {
    method = "GIRO";
    label = scrubSensitive(raw.replace(/^(IBG|PAY|GIRO)\s+/i, ""));
  } else if (/PAYLAH/i.test(raw)) {
    method = "PayLah!";
    label = isCredit ? "PayLah! send back" : "PayLah! top-up";
  } else if (/^TRF\b/i.test(raw)) {
    method = "Transfer";
    label = scrubSensitive(raw.replace(/^TRF\b/i, ""));
    if (!label) { ownTransfer = true; label = isCredit ? "Transfer in (own account)" : "Transfer out (own account)"; }
  } else {
    label = scrubSensitive(raw);
  }

  label = label.replace(/\*(?=\s|$)/g, "").replace(/^[\s,.-]+|[\s,-]+$/g, "").replace(/\s+/g, " ").trim();
  label = titleCase(label) || (isCredit ? "Bank credit" : "Bank debit");
  // Final guard: never let a long digit run through.
  if (/\d{5,}/.test(label)) label = isCredit ? "Bank credit" : "Bank debit";
  return { label, method, counterpartyIsPerson, ownTransfer };
}

// ---------- Classification ----------
// Each spend type -> envelope-name keywords, tried in order against YOUR
// envelopes (so a "Daily Food" envelope wins over "Food & Groceries").
export const SPEND_TYPES = {
  dailyFood: { label: "Daily Food", keys: ["daily food", "daily", "food", "dining", "meal"], fallback: "e2" },
  groceries: { label: "Groceries", keys: ["grocer", "daily food", "food"], fallback: "e2" },
  transport: { label: "Transport", keys: ["transport"], fallback: "e3" },
  bills: { label: "Bills & Subscriptions", keys: ["bills", "subscription"], fallback: "e4" },
  fun: { label: "Fun", keys: ["fun", "entertain", "leisure", "dining"], fallback: "e5" },
  shopping: { label: "Shopping", keys: ["shopping"], fallback: "e6" },
  housing: { label: "Rent / Housing", keys: ["rent", "housing"], fallback: "e1" },
  save: { label: "Savings & Invest", keys: ["saving", "invest"], fallback: "e7" },
};

// Order matters: specific food-delivery / food-store signals before transport
// (GrabFood vs Grab rides), groceries before generic food words.
const RULES = [
  ["dailyFood", /GRABFOOD|GRAB\s*FOOD|FOODPANDA|DELIVEROO|EAT\s*RICH|EATRICH/i],
  ["groceries", /NTUC|FAIRPRICE|COLD STORAGE|SHENG SIONG|\bGIANT\b|DONKI|PRIME SUPERMARKET|REDMART|SUPERMARKET|\bHAO MART\b|\bU STARS\b/i],
  ["transport", /BUS\/MRT|SIMPLYGO|EZ-?LINK|TRANSITLINK|GOJEK|GOPAY|\bGRAB\b|COMFORT|\bCDG\b|\bTADA\b|\bZIG\b|\bRYDE\b|\bSMRT\b|\bSBS\b|TAXI|PARKING|SHELL|ESSO|CALTEX|\bUBER\b/i],
  ["bills", /SPOTIFY|NETFLIX|SINGTEL|GOMO|CIRCLES|STARHUB|\bM1\b|SIMBA|ANTHROPIC|CLAUDE|OPENAI|CHATGPT|APPLE\.COM|ICLOUD|GOOGLE|YOUTUBE|DISNEY|SP SERVICES|SP GROUP|INSURANCE|PRUDENTIAL|\bAIA\b|GREAT EASTERN|\bFWD\b|MINMED|CLINIC|MEDICAL|HOSPITAL|PHARMACY|POLYCLINIC|DENTAL|TOWN COUNCIL|\bHDB\b/i],
  ["fun", /CINEMA|\bGV\b|SHAW THEATRES|CATHAY|KARAOKE|\bKTV\b|BOWLING|ARCADE|TIMEZONE|KLOOK|SISTIC|TICKET/i],
  ["shopping", /SHEIN|SHOPEE|LAZADA|AMAZON|TAOBAO|QOO10|UNIQLO|ZARA|\bH&M\b|DAISO|MUJI|DECATHLON|IKEA|POPULAR|COURTS|CHALLENGER|BEST DENKI|SEPHORA|LOVE BONITO|COTTON ON|MINISO|\bTYPO\b|GUARDIAN|WATSONS/i],
  // Anything that smells like eating or drinking -> Daily Food.
  ["dailyFood", new RegExp([
    "FOOD", "DRINK", "BEVERAGE", "KOPI", "COFFEE", "CAFE", "CAFÉ", "\\bTEA\\b", "BUBBLE", "BOBA", "JUICE", "SMOOTHIE",
    "STARBUCKS", "\\bKOI\\b", "LIHO", "CHAGEE", "GONG CHA", "PLAYMADE", "LUCKIN", "TOAST", "YA KUN", "HEAVENLY WANG",
    "BAKERY", "BAKE", "BREAD", "DONUT", "WAFFLE", "PANCAKE", "DESSERT", "CAKE", "KEIKI", "ICE CREAM", "GELATO",
    "RICE", "NOODLE", "MIAN", "\\bMEE\\b", "SOUP", "PORRIDGE", "CONGEE", "LAKSA", "YONG TAU", "CHICKEN", "DUCK",
    "CHAR SIEW", "ROAST", "BBQ", "MALA", "HOTPOT", "DIM SUM", "DUMPLING", "PRATA", "NASI", "BRIYANI", "BIRYANI",
    "CURRY", "KEBAB", "SALAD", "PASTA", "PIZZA", "BURGER", "SUSHI", "RAMEN", "BENTO", "THAI", "KOREAN",
    "JAPANESE", "WESTERN", "PEANUT", "ECONOMIC", "CAI FAN", "KOPITIAM", "KOUFU", "FOOD REPUBLIC", "FOODCOURT",
    "FOOD COURT", "CANTEEN", "HAWKER", "KITCHEN", "RESTAURANT", "BISTRO", "DINER", "EATERY", "\\bEAT\\b", "SNACK",
    "MCDONALD", "\\bKFC\\b", "SUBWAY", "JOLLIBEE", "MOS BURGER", "OLD CHANG KEE", "STUFF'D", "FOUR LEAVES",
    "GOKOKU", "SIX HANDS", "TABLE", "DELI", "MUNCHI", "7-ELEVEN", "CHEERS", "\\bBAR\\b", "\\bPUB\\b",
  ].join("|"), "i")],
];

// ---------- Learning from your past ledger ----------
const STOP = new Set(["to", "from", "the", "and", "for", "with", "pte", "ltd", "private", "limited", "sgp",
  "singapore", "paynow", "transfer", "payment", "pay", "back", "home", "frm", "via", "card", "nets", "app"]);
const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9一-鿿 ]+/g, " ").replace(/\s+/g, " ").trim();
const tokens = (s) => norm(s).split(" ").filter((w) => w.length >= 3 && !STOP.has(w) && !/^\d+$/.test(w));

/**
 * Index existing expense transactions so new rows can copy how you
 * classified the same merchant / person / kind of thing before.
 */
export function buildHistoryIndex(transactions, envelopes) {
  const valid = new Set(envelopes.map((e) => e.id));
  const exact = new Map(); // normalised desc -> { envId: count }
  const words = new Map(); // token -> { envId: count }
  const bump = (map, key, env) => {
    const m = map.get(key) || {};
    m[env] = (m[env] || 0) + 1;
    map.set(key, m);
  };
  for (const t of transactions || []) {
    if ((t.type || "expense") !== "expense" || !valid.has(t.envId)) continue;
    bump(exact, norm(t.desc), t.envId);
    for (const w of new Set(tokens(t.desc))) bump(words, w, t.envId);
  }
  return { exact, words };
}

const top = (counts) => {
  const entries = Object.entries(counts || {});
  if (!entries.length) return null;
  const total = entries.reduce((a, [, n]) => a + n, 0);
  const [env, n] = entries.sort((a, b) => b[1] - a[1])[0];
  return { env, n, share: n / total };
};

/**
 * Pick an envelope for a parsed bank row.
 * Priority: 1) exact same description in your past ledger
 *           2) keyword rules
 *           3) strong word-level pattern from your past ledger
 *           4) Daily Food (unclear items, PayNow to people, hawker QR…)
 * Returns { envId, reason, confident }.
 */
export function suggestEnvelope(row, envelopes, history) {
  if (row.type === "inflow") return { envId: "__inflow", reason: "inflow", confident: true };

  const ex = history && top(history.exact.get(norm(row.desc)));
  if (ex && ex.share >= 0.6) return { envId: ex.env, reason: "same as your past entry", confident: true };

  if (row.spendType && row.confident) {
    return { envId: resolveEnvelopeId(envelopes, row.spendType), reason: "keyword", confident: true };
  }

  if (history) {
    const votes = {};
    for (const w of tokens(row.desc)) {
      const t = top(history.words.get(w));
      if (t && t.n >= 2 && t.share >= 0.7) votes[t.env] = (votes[t.env] || 0) + t.n;
    }
    const best = top(votes);
    if (best) return { envId: best.env, reason: "similar to past entries", confident: true };
  }

  return { envId: resolveEnvelopeId(envelopes, row.spendType || "dailyFood"), reason: "unclear → Daily Food", confident: false };
}

function classify(label, info) {
  if (info.ownTransfer) return { spendType: "save", confident: true };
  for (const [type, re] of RULES) if (re.test(label)) return { spendType: type, confident: true };
  // Unclear (hawker QR, PayNow to people, unknown merchants) -> Daily Food.
  return { spendType: "dailyFood", confident: false };
}

export function resolveEnvelopeId(envelopes, spendType) {
  const rule = SPEND_TYPES[spendType];
  if (rule) {
    for (const k of rule.keys) {
      const e = envelopes.find((x) => x.name.toLowerCase().includes(k));
      if (e) return e.id;
    }
    if (envelopes.some((x) => x.id === rule.fallback)) return rule.fallback;
  }
  return envelopes[0]?.id || "";
}

// cyrb53 — stable, non-cryptographic hash for deterministic IDs.
function hash(str) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

// ---------- Main entry ----------
/**
 * Parse one bank CSV export.
 * Returns { rows, balance, asOf, currency, skipped, sensitiveRemoved }
 * rows: [{ id, date, postedDate, desc, amount, type, spendType, confident, method }]
 */
export function parseBankCsv(text) {
  const lines = String(text || "").split(/\r?\n/);
  const headerIdx = lines.findIndex((l) => /^\s*"?Transaction Date"?\s*,/i.test(l));
  if (headerIdx < 0) throw new Error("Couldn't find the 'Transaction Date' header row — is this a bank transaction history CSV?");

  // Preamble: whitelisted labels only. Everything else is ignored unread.
  let balance = null, asOf = null, currency = null;
  for (const line of lines.slice(0, headerIdx)) {
    if (/^Available Balance:/i.test(line)) balance = parseAmount(line.split(",")[1]);
    else if (/^Statement as at:/i.test(line)) asOf = parseStatementDate(line.split(",")[1]);
    else if (/^Currency:/i.test(line)) currency = (line.split(",")[1] || "").trim().slice(0, 3).toUpperCase();
  }

  const table = parseCsv(lines.slice(headerIdx).join("\n"));
  const header = table[0].map((h) => h.trim().toLowerCase());
  const col = (name) => header.indexOf(name);
  const iDate = col("transaction date"), iDesc = col("description"), iStatus = col("status"),
    iCur = col("currency"), iDebit = col("debit amount"), iCredit = col("credit amount");
  if ([iDate, iDesc, iDebit, iCredit].some((i) => i < 0)) {
    throw new Error("Missing expected columns (Transaction Date, Description, Debit Amount, Credit Amount).");
  }

  const rows = [];
  const seen = {};
  let skipped = 0, sensitiveRemoved = false;
  for (const r of table.slice(1)) {
    if (!r || r.length <= Math.max(iDate, iDesc, iDebit, iCredit)) continue;
    const posted = parseStatementDate(r[iDate]);
    if (!posted) continue;
    const status = iStatus >= 0 ? (r[iStatus] || "").trim().toLowerCase() : "settled";
    const cur = iCur >= 0 ? (r[iCur] || "").trim().toUpperCase() : "SGD";
    const debit = parseAmount(r[iDebit]), credit = parseAmount(r[iCredit]);
    if ((status && status !== "settled") || (cur && cur !== "SGD") || (!debit && !credit)) { skipped++; continue; }

    const rawDesc = r[iDesc] || "";
    const isCredit = credit > 0 && !debit;
    const info = describe(rawDesc, isCredit);
    if (/\d{5,}/.test(rawDesc)) sensitiveRemoved = true;
    const date = info.method === "Card" ? resolvePurchaseDate(rawDesc, posted) : posted;
    const amount = isCredit ? credit : debit;
    const cls = isCredit ? { spendType: null, confident: true } : classify(info.label, info);

    // Deterministic ID: same bank row in an overlapping export -> same ID.
    const key = `${posted}|${date}|${info.label}|${isCredit ? "in" : "out"}|${Math.round(amount * 100)}`;
    seen[key] = (seen[key] || 0) + 1;
    rows.push({
      id: `bank_${hash(`${key}|${seen[key]}`)}`,
      date, postedDate: posted, desc: info.label, amount,
      type: isCredit ? "inflow" : "expense",
      spendType: cls.spendType, confident: cls.confident, method: info.method,
    });
  }
  return { rows, balance, asOf, currency, skipped, sensitiveRemoved };
}

/**
 * Compare parsed rows against existing transactions.
 * status: "new" | "imported" (same ID exists) | "possibleDup" (looks like a manual entry)
 */
export function reconcile(rows, existingTxns) {
  const ids = new Set(existingTxns.map((t) => t.id));
  const manual = existingTxns.filter((t) => !String(t.id).startsWith("bank_") && t.tag !== "exchange");
  const travel = existingTxns.filter((t) => t.tag === "exchange");
  const claimed = new Set();
  return rows.map((r) => {
    if (ids.has(r.id)) return { ...r, status: "imported" };
    if (r.tag === "exchange") {
      // Same trip entry already in the ledger (any ID scheme) -> skip.
      const same = travel.find((t) => !claimed.has(t.id) && t.date === r.date
        && t.desc === r.desc && Math.abs(t.amount - r.amount) < 0.005 && (t.type || "expense") === r.type);
      if (same) { claimed.add(same.id); return { ...r, status: "imported" }; }
      return { ...r, status: "new" }; // trip spending never collides with home ledger entries
    }
    const match = manual.find((t) => !claimed.has(t.id)
      && (t.type || "expense") === r.type
      && Math.abs(t.amount - r.amount) < 0.005
      && Math.abs(new Date(t.date) - new Date(r.date)) <= 3 * 86400000);
    if (match) { claimed.add(match.id); return { ...r, status: "possibleDup", dupOf: match }; }
    return { ...r, status: "new" };
  });
}

/* ============================================================
   TRAVELSPEND CSV IMPORT (trip / exchange expenditure)
   Semicolon-separated export from the TravelSpend app. Only these columns
   are read: datePaid, notes, amount, amountInHomeCurrency, homeCurrency,
   localCurrency, category, country, countryCode, paymentMethod, place, type.
   Traveller IDs, coordinates, photos and split objects are never accessed.
   ============================================================ */
const TRAVEL_CATEGORY_TO_SPEND = {
  "Restaurants": "dailyFood", "Coffee": "dailyFood", "Drinks": "dailyFood",
  "Groceries": "groceries",
  "Activities": "fun", "Entertainment": "fun",
  "Shopping": "shopping", "General": "shopping",
  "Transportation": "transport", "Flights": "transport",
  "Accommodation": "housing",
  "Fees & Charges": "bills",
};

export function isTravelSpendCsv(text) {
  const first = String(text || "").split(/\r?\n/, 1)[0] || "";
  return first.includes(";") && /amountInHomeCurrency/i.test(first) && /datePaid/i.test(first);
}

export function parseTravelSpendCsv(text) {
  const table = parseCsv(String(text || "").replace(/^﻿/, ""), ";");
  const header = (table[0] || []).map((h) => h.trim());
  const col = (name) => header.indexOf(name);
  const idx = {
    date: col("datePaid"), notes: col("notes"), amount: col("amount"), home: col("amountInHomeCurrency"),
    homeCur: col("homeCurrency"), localCur: col("localCurrency"), category: col("category"),
    country: col("country"), countryCode: col("countryCode"), payment: col("paymentMethod"),
    place: col("place"), type: col("type"),
  };
  if ([idx.date, idx.home, idx.category].some((i) => i < 0)) {
    throw new Error("Missing expected TravelSpend columns (datePaid, amountInHomeCurrency, category).");
  }
  const get = (r, i) => (i >= 0 && r[i] != null ? String(r[i]).trim() : "");
  const num = (s) => {
    const n = Number(String(s || "").replace(/[\s ,]/g, ""));
    return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
  };

  const rows = [];
  const seen = {};
  let skipped = 0, homeCurrency = null;
  for (const r of table.slice(1)) {
    const dm = get(r, idx.date).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (!dm) continue;
    const type = get(r, idx.type);
    if (type && !/^expense$/i.test(type)) { skipped++; continue; }
    homeCurrency = homeCurrency || get(r, idx.homeCur);
    const home = num(get(r, idx.home));
    if (!home) { skipped++; continue; }

    const date = `${dm[3]}-${dm[2].padStart(2, "0")}-${dm[1].padStart(2, "0")}`;
    const category = get(r, idx.category);
    // Notes are free text; scrub anything number-like that could be sensitive.
    const desc = scrubSensitive(get(r, idx.notes)) || category || "Trip expense";
    const isInflow = home < 0; // refunds / winnings
    const amount = Math.abs(home);
    const key = `${date}|${desc}|${isInflow ? "in" : "out"}|${Math.round(amount * 100)}|${get(r, idx.localCur)}`;
    seen[key] = (seen[key] || 0) + 1;
    const spendType = TRAVEL_CATEGORY_TO_SPEND[category] || "dailyFood";
    rows.push({
      id: `trip_${hash(`${key}|${seen[key]}`)}`,
      date, postedDate: date, desc, amount,
      type: isInflow ? "inflow" : "expense",
      spendType, confident: !!TRAVEL_CATEGORY_TO_SPEND[category],
      method: [get(r, idx.payment), category, get(r, idx.country)].filter(Boolean).join(" · "),
      tag: "exchange",
      category, country: get(r, idx.country), countryCode: get(r, idx.countryCode),
      localAmount: Math.abs(num(get(r, idx.amount))), localCurrency: get(r, idx.localCur),
      paymentMethod: get(r, idx.payment), place: get(r, idx.place),
    });
  }
  return { rows, balance: null, asOf: null, currency: homeCurrency, skipped, sensitiveRemoved: false };
}
