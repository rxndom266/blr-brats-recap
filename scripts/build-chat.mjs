#!/usr/bin/env node
// Turns raw WhatsApp exports into anonymised, per-day JSON the site can show.
//
//   node scripts/build-chat.mjs
//
// Input : exports/*.zip or exports/*.txt   (raw, gitignored, real names inside)
// Config: exports/aliases.json             (real sender -> made-up label, gitignored, edit freely)
//         exports/redactions.txt           (one word or phrase per line, blanked everywhere, gitignored)
// Output: chat/index.json and chat/YYYY-MM-DD.json   (safe to publish)
//
// Exports can overlap. Messages are de-duplicated, so just drop the newest export in and re-run.

import {readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync, rmSync} from "node:fs";
import {execFileSync} from "node:child_process";
import {join, dirname} from "node:path";
import {fileURLToPath} from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const EX = join(ROOT, "exports");
const OUT = join(ROOT, "chat");
if (!existsSync(EX)) { console.error("No exports/ folder. Put WhatsApp export .zip or .txt files in it."); process.exit(1); }

/* ---------- read exports ---------- */
function readExport(file) {
  const p = join(EX, file);
  if (/\.txt$/i.test(file)) return [readFileSync(p, "utf8")];
  if (/\.zip$/i.test(file)) {
    const names = execFileSync("unzip", ["-Z1", p], {encoding: "utf8"}).split("\n").filter(n => /\.txt$/i.test(n) && !n.startsWith("__MACOSX"));
    return names.map(n => execFileSync("unzip", ["-p", p, n], {encoding: "utf8", maxBuffer: 256 * 1024 * 1024}));
  }
  return [];
}
const files = readdirSync(EX).filter(f => /\.(zip|txt)$/i.test(f) && !/^(redactions|aliases)/i.test(f)).sort();
if (!files.length) { console.error("exports/ has no .zip or .txt files."); process.exit(1); }

/* ---------- parse ---------- */
const TS = /^‎?\[(\d{1,2})\/(\d{1,2})\/(\d{2,4}),\s*(\d{1,2}):(\d{2})(?::\d{2})?[\s ]*(AM|PM|am|pm)?\]\s?(.*)$/;
const rawTexts = files.flatMap(readExport);

// Work out day/month order once, from all the data.
let firstGt12 = false, secondGt12 = false;
for (const t of rawTexts) for (const line of t.split("\n")) {
  const m = TS.exec(line.replace(/^﻿/, "")); if (!m) continue;
  if (+m[1] > 12) firstGt12 = true;
  if (+m[2] > 12) secondGt12 = true;
}
const DMY = firstGt12 || !secondGt12; // default to day/month/year

const SYSTEM = /(created this group|joined using|joined from|was added|added you|\badded\b|\bremoved\b|\bleft$|changed (the |this )?(group )?(name|subject|description|icon|settings)|pinned a message|security code|turned (on|off)|is now an admin|updated the group|changed their phone number)/i;
const dropped = {system: 0, empty: 0};

function parse(text) {
  const out = [];
  let cur = null;
  for (const lineRaw of text.replace(/^﻿/, "").split("\n")) {
    const line = lineRaw.replace(/\r$/, "");
    const m = TS.exec(line);
    if (m) {
      if (cur) out.push(cur);
      cur = null;
      let [, a, b, y, hh, mm, ap, rest] = m;
      const day = DMY ? +a : +b, mon = DMY ? +b : +a;
      let h = +hh;
      if (ap) { const pm = /pm/i.test(ap); if (pm && h < 12) h += 12; if (!pm && h === 12) h = 0; }
      const year = +y < 100 ? 2000 + +y : +y;
      const date = `${year}-${String(mon).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      const time = `${String(h).padStart(2, "0")}:${mm}`;
      rest = rest.replace(/^‎/, "");
      const sm = /^([^:]{1,80}?): ([\s\S]*)$/.exec(rest);
      if (!sm || (SYSTEM.test(rest) && !sm)) { dropped.system++; continue; }
      cur = {date, time, sender: sm[1], text: sm[2]};
    } else if (cur) {
      cur.text += "\n" + line;
    }
  }
  if (cur) out.push(cur);
  return out;
}

// De-duplicate across overlapping exports (identical messages in one export are kept).
const seen = new Set(), messages = [];
for (const t of rawTexts) {
  const local = new Map();
  for (const m of parse(t)) {
    const base = `${m.date}|${m.time}|${m.sender}|${m.text}`;
    const n = (local.get(base) || 0) + 1; local.set(base, n);
    const key = `${base}#${n}`;
    if (seen.has(key)) continue;
    seen.add(key); messages.push(m);
  }
}
messages.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));

/* ---------- aliases ---------- */
const clean = s => s.replace(/[‎‏‪-‮⁦-⁩]/g, "").replace(/^~\s*/, "").replace(/\s+/g, " ").trim();
const aliasPath = join(EX, "aliases.json");
const aliases = existsSync(aliasPath) ? JSON.parse(readFileSync(aliasPath, "utf8")) : {};
const senderName = m => clean(m.sender);
{ // drop join/leave/add notices before anything is counted
  const real = messages.filter(m => !isSystemBody(m));
  dropped.system += messages.length - real.length;
  messages.length = 0; messages.push(...real);
}

/* ---------- per-person stats (computed from the raw text, never published as text) ---------- */
const STOP = new Set("that this with have just like what about they them then than their there were will would could should from your when where which while been being into over some more most very much many also only even still really okay yeah yes nope know think thing things going gonna want need make made does done dont cant wont didnt isnt arent wasnt anyone someone everyone something anything because maybe actually people guys here after before again other another around through those these such both each every same well back good great right else".split(" "));
const EMOJI = /\p{Extended_Pictographic}/gu;
const LAUGH = /\b(lol|lmao|lmfao|rofl|haha+|hehe+|hahaha+)\b|😂|🤣|💀|😭/i;
const minutesOf = m => { const [y, mo, d] = m.date.split("-").map(Number), [h, mi] = m.time.split(":").map(Number); return Date.UTC(y, mo - 1, d, h, mi) / 60000; };
const stats = {};
{
  let prev = null;
  for (const m of messages) {
    const who = senderName(m), text = m.text.replace(/[‎‏⁦-⁩]/g, "").trim();
    const st = (stats[who] ||= {n: 0, words: 0, wordMsgs: 0, q: 0, emoji: 0, laugh: 0, night: 0, hours: Array(24).fill(0), days: {}, starts: 0, replies: 0, partners: {}, repliedBy: {}, longest: 0, media: 0, links: 0, first: `${m.date} ${m.time}`, wc: {}, ec: {}});
    st.n++;
    const hr = +m.time.slice(0, 2); st.hours[hr]++; if (hr < 6) st.night++;
    st.days[m.date] = (st.days[m.date] || 0) + 1;
    if (/ omitted$|^<attached:/i.test(text)) st.media++;
    else {
      const w = text.split(/\s+/).filter(Boolean).length;
      st.words += w; st.wordMsgs++; st.longest = Math.max(st.longest, w);
      if (text.includes("?")) st.q++;
      if (LAUGH.test(text)) st.laugh++;
      if (/https?:\/\//i.test(text)) st.links++;
      const em = text.match(EMOJI); if (em) { st.emoji++; for (const e of em) st.ec[e] = (st.ec[e] || 0) + 1; }
      for (const t of text.toLowerCase().match(/[a-z']{4,}/g) || []) st.wc[t] = (st.wc[t] || 0) + 1;
    }
    const ts = minutesOf(m);
    if (prev) {
      const gap = ts - prev.ts;
      if (gap >= 30) st.starts++;
      else if (prev.who !== who && gap <= 5) {
        st.replies++;
        st.partners[prev.who] = (st.partners[prev.who] || 0) + 1;
        stats[prev.who].repliedBy[who] = (stats[prev.who].repliedBy[who] || 0) + 1;
      }
    } else st.starts++;
    prev = {ts, who};
  }
}
const rankOrder = Object.keys(stats).sort((a, b) => stats[b].n - stats[a].n);

/* ---------- personality-flavoured names for anyone without one ---------- */
const hashStr = s => { let h = 2166136261; for (const c of s) { h ^= c.codePointAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
const avgW = s => s.wordMsgs ? s.words / s.wordMsgs : 0;
const TRAITS = [
  {k: "nightOwl", adj: "Midnight", nouns: ["Insomniac", "Night Owl", "Graveyard-Shifter"], score: s => s.n >= 5 ? (s.night / s.n) / 0.35 : 0},
  {k: "earlyBird", adj: "Sunrise", nouns: ["Early Bird", "Alarm Clock"], score: s => s.n >= 5 ? (s.hours.slice(5, 10).reduce((a, b) => a + b, 0) / s.n) / 0.4 : 0},
  {k: "essayist", adj: "Long-Winded", nouns: ["Essayist", "Monologuer", "Novelist"], score: s => s.n >= 5 ? avgW(s) / 18 : 0},
  {k: "oneLiner", adj: "Terse", nouns: ["One-Liner", "Haiku Poet", "Telegram"], score: s => s.n >= 8 && avgW(s) > 0 ? 4 / avgW(s) : 0},
  {k: "asker", adj: "Inquisitive", nouns: ["Interrogator", "Curious Cat", "Question Mark"], score: s => s.n >= 6 ? (s.q / s.n) / 0.3 : 0},
  {k: "emoji", adj: "Emoji-Laden", nouns: ["Emoji Enthusiast", "Sticker Goblin"], score: s => s.n >= 6 ? (s.emoji / s.n) / 0.35 : 0},
  {k: "laugher", adj: "Cackling", nouns: ["Giggler", "Laugh Track"], score: s => s.n >= 6 ? (s.laugh / s.n) / 0.25 : 0},
  {k: "starter", adj: "Icebreaking", nouns: ["Conversation Starter", "Icebreaker"], score: s => s.starts / 4},
  {k: "responder", adj: "Ever-Replying", nouns: ["Sidekick", "Echo", "Reply Guy"], score: s => s.n >= 8 ? (s.replies / s.n) / 0.7 : 0},
  {k: "lurker", adj: "Passing", nouns: ["Visitor", "Cameo", "Drive-By Commenter"], score: s => s.n <= 3 ? 1.2 : 0},
  {k: "veteran", adj: "Resident", nouns: ["Regular", "Local Legend"], score: s => Object.keys(s.days).length / 5},
  {k: "chatterbox", adj: "Prolific", nouns: ["Chatterbox", "Town Crier"], score: (s, rank) => rank < 5 ? 2 : 0}
];
const FALLBACK_ADJ = ["Amiable", "Dapper", "Curious", "Sleepy", "Easygoing", "Wandering"], FALLBACK_NOUN = ["Newcomer", "Bystander", "Wanderer", "Participant"];
const used = new Set(Object.values(aliases));
function archetype(who) {
  const s = stats[who], rank = rankOrder.indexOf(who), h = hashStr(who);
  const ranked = TRAITS.map(t => ({t, v: t.score(s, rank)})).filter(x => x.v >= 1).sort((a, b) => b.v - a.v).map(x => x.t);
  const tries = [];
  for (let i = 0; i < ranked.length; i++) for (let j = 0; j < ranked.length; j++) if (i !== j) for (const n of ranked[i].nouns) tries.push(`The ${ranked[j].adj} ${n}`);
  for (const a of FALLBACK_ADJ) for (const n of FALLBACK_NOUN) tries.push(`The ${a} ${n}`);
  // start from a person-specific offset so similar people do not all fight over the same name
  const off = tries.length ? h % Math.min(3, tries.length) : 0;
  const ordered = tries.slice(off).concat(tries.slice(0, off));
  for (const name of ordered) if (!used.has(name)) { used.add(name); return name; }
  for (let k = 2; ; k++) { const name = `${ordered[0]} ${["", "", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"][k] || k}`; if (!used.has(name)) { used.add(name); return name; } }
}
for (const who of rankOrder) if (!aliases[who]) aliases[who] = archetype(who);
writeFileSync(aliasPath, JSON.stringify(aliases, null, 2) + "\n");

/* ---------- scrubbing ---------- */
const dictWords = new Set(existsSync("/usr/share/dict/words") ? readFileSync("/usr/share/dict/words", "utf8").split("\n").map(w => w.toLowerCase()) : []);
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const nameRules = []; // [regex, replacement]
{
  const firstTokens = new Map();
  for (const n of Object.keys(aliases)) {
    const t = n.split(" ")[0];
    firstTokens.set(t.toLowerCase(), (firstTokens.get(t.toLowerCase()) || 0) + 1);
  }
  const add = (term, label, owner) => {
    if (!/\p{L}/u.test(term) || term.length < 4) return;
    if (!term.includes(" ") && dictWords.has(term.toLowerCase())) return; // ordinary word, not a name
    const re = new RegExp(`(?<![\\p{L}\\p{N}])${esc(term)}(?![\\p{L}\\p{N}])`, "giu");
    // A "name" that other people say all the time is a normal word or place, not a person.
    let others = 0;
    for (const m of messages) if (senderName(m) !== owner && re.test(m.text)) { re.lastIndex = 0; if (++others > 5) return; } else re.lastIndex = 0;
    nameRules.push([re, label, term.length]);
  };
  for (const [n, label] of Object.entries(aliases)) {
    add(n, label, n);
    const parts = n.split(" ");
    for (const t of parts) {
      const lt = t.toLowerCase();
      if (parts.length > 1 || t !== n) {
        if (/^\p{L}+$/u.test(t) && t.length >= 3 && !dictWords.has(lt) && (firstTokens.get(lt) || 0) <= 1) add(t, label, n);
      }
    }
  }
  nameRules.sort((a, b) => b[2] - a[2]);
}
const redactions = existsSync(join(EX, "redactions.txt"))
  ? readFileSync(join(EX, "redactions.txt"), "utf8").split("\n").map(s => s.trim()).filter(s => s && !s.startsWith("#")) : [];
// "word" blanks that word everywhere; "!phrase" drops any whole message containing the phrase.
const redactRules = redactions.filter(t => !t.startsWith("!")).map(t => new RegExp(esc(t), "gi"));
const hideRules = redactions.filter(t => t.startsWith("!")).map(t => new RegExp(esc(t.slice(1).trim()), "i"));
// Self-introductions carry names, ages, areas and jobs, so they are hidden as whole messages.
const AP = "['\u2019]";
const SELF_INTRO = new RegExp(`\\b(my name is|my name${AP}s|name${AP}s|i${AP}?m|im|i am|this is|call me|myself)\\s+([\\p{L}][\\p{L}'.-]*)`, "giu");
const GREET_NAME = /\b(hey|hi|hello|hii|welcome|thanks|thank you|nice to meet you|named|ask|ping)[,!]?\s+([\p{L}][\p{L}'.-]*)/giu;
const ABOUT_ME = /\b(based in|working as|years? old|yrs old|i work (at|as|in|for))\b/i;
const HELLO_ALL = /^(hello|hey|hi|hii+|heya|yo)\s*,?\s*(everyone|all|guys|you all|folks)/i;
const NAMED_INTRO = /\b(?:[Ii] am|[Ii]['\u2019]m|[Ii]m|[Tt]his is|[Mm]y name is)\s+\p{Lu}\p{Ll}{2,}/u;
const WHERE_I_LIVE = /\b(i|we) (live|lived|stay|stayed)\b(?! it)|\bi['\u2019]?m (staying|from)\b|\bi am (staying|from)\b|\boriginally from\b|\bshifted to\b|\bmoved to\b|\bbased (in|out of)\b/i;
const MY_AGE = /\bi['\u2019]?m \d{2}\b|\bi am \d{2}\b|\b(19|20)\d{2} born\b|\b\d{2}\s?(yo|y\/o|years old)\b/i;
const NAME_HERE = /\b\p{Lu}\p{Ll}{2,} here\b[.,!]/u;
function looksLikeIntro(t) {
  if (t.length < 400 && (NAME_HERE.test(t) || /\b\d{2} here\b/i.test(t))) return true;
  if (t.length < 240 && (NAMED_INTRO.test(t) || WHERE_I_LIVE.test(t) || MY_AGE.test(t))) return true;
  if (/\b(my name is|my name['\u2019]s|myself|call me)\b/i.test(t)) return true;
  for (const m of t.matchAll(SELF_INTRO)) if (m[2].length >= 3 && !dictWords.has(m[2].toLowerCase())) return true;
  if (t.length >= 40 && (ABOUT_ME.test(t) || HELLO_ALL.test(t))) return true;
  return false;
}

const MEDIA = {image: "[photo]", video: "[video]", audio: "[voice note]", sticker: "[sticker]", gif: "[GIF]", document: "[file]", "video note": "[video note]", "contact card": "[contact card]", pdf: "[file]", location: "[location]"};
function scrub(raw) {
  let t = raw.replace(/[‎‏‪-‮]/g, "").replace(/<This message was edited>/gi, "").trim();
  if (/^This message was deleted by admin/i.test(t)) return "[removed by an admin]";
  if (/^(This message was deleted|You deleted this message)/i.test(t)) return "[deleted by sender]";
  const mm = /^(image|video note|video|audio|sticker|GIF|document|Contact card|PDF|Location) omitted$/i.exec(t);
  if (mm) return MEDIA[mm[1].toLowerCase()];
  if (/^<attached:/i.test(t)) return "[attachment]";
  if (/^location:/i.test(t)) return "[location]";
  // @mentions: WhatsApp wraps them in invisible isolates
  t = t.replace(/@⁨([^⁩\n]{1,60})⁩/g, (_, n) => { const a = aliases[clean(n)]; return "@" + (a || "someone"); });
  t = t.replace(/@\+?\d[\d ]{7,15}/g, "@someone");
  t = t.replace(/[⁦-⁩]/g, "");
  for (const [re, label] of nameRules) t = t.replace(re, m => (/^\p{Lu}/u.test(m) ? label : m)); // names are capitalised, ordinary words are not
  t = t.replace(GREET_NAME, (all, lead, w) => (/^\p{Lu}/u.test(w) && w.length >= 3 && !dictWords.has(w.toLowerCase()) ? `${lead} [name]` : all));
  t = t.replace(/https?:\/\/(?:www\.)?([^\s/]+)[^\s]*/gi, "[link: $1]").replace(/\b(?:www\.)[^\s]+/gi, "[link]");
  t = t.replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[email]");
  t = t.replace(/(?<![\w@])@[\w.]{3,}/g, "@someone");
  t = t.replace(/\+?\d[\d\s\-().]{7,}\d/g, s => (s.replace(/\D/g, "").length >= 9 ? "[number]" : s));
  for (const re of redactRules) t = t.replace(re, "[redacted]");
  return t.trim();
}

// Join/leave/add/remove notices come through as "Name: Name joined ...", so catch them by their body.
function isSystemBody(m) {
  const body = clean(m.text.replace(/[\u200e\u200f]/g, ""));
  const me = senderName(m);
  if (/(joined using (this group['\u2019]s invite link|a group link)|joined from the community|\bwas added\b|changed (the |this )?group|pinned a message|security code changed|is now an admin)\s*\.?$/i.test(body) && body.length < 200) return true;
  if (body.toLowerCase().startsWith(me.toLowerCase()) && /^\s+(joined|left|added|removed|created|turned|updated|changed)\b/i.test(body.slice(me.length)) && body.length < 200) return true;
  if (/\b(added|removed)\s+~/i.test(body) && body.length < 200) return true;
  if (/^(you joined a group|you were added|you removed|you added)/i.test(body)) return true;
  return false;
}


/* ---------- gentle grammar fixes ---------- */
const preserveRules = existsSync(join(EX, "preserve.txt"))
  ? readFileSync(join(EX, "preserve.txt"), "utf8").split("\n").map(s => s.trim()).filter(s => s && !s.startsWith("#")).map(t => new RegExp(esc(t), "i")) : [];
const CONTRACT = {im: "I'm", ive: "I've", dont: "don't", cant: "can't", wont: "won't", didnt: "didn't", doesnt: "doesn't", isnt: "isn't", arent: "aren't", wasnt: "wasn't", werent: "weren't", couldnt: "couldn't", wouldnt: "wouldn't", shouldnt: "shouldn't", havent: "haven't", hasnt: "hasn't", hadnt: "hadn't", youre: "you're", theyre: "they're", thats: "that's", whats: "what's", theres: "there's", heres: "here's"};
const QSTART = /^(what|why|how|who|where|when|which|is|are|do|does|did|can|could|would|should|anyone|has|have|was|were)\b/i;
function keepAsTyped(t) {
  const letters = t.replace(/[^\p{L}]/gu, "");
  if (letters.length >= 4 && letters === letters.toUpperCase()) return true;      // SHOUTING is the joke
  if (/([a-z])\1{2,}/i.test(t.replace(/https?:\S+/g, ""))) return true;           // sooooo, noooo
  if (/\b[a-z]+[A-Z][a-z]+[A-Z]/.test(t)) return true;                             // mOcKiNg
  return preserveRules.some(re => re.test(t));
}
function fixLine(s) {
  s = s.replace(/[ \t]+/g, " ").trim();
  if (!s) return s;
  s = s.replace(/\b\p{L}+\b/gu, w => CONTRACT[w.toLowerCase()] || w);
  s = s.replace(/\bi\b(?!\.)/g, "I");
  if (!/^[@\[\d]/.test(s)) s = s.replace(/^\p{Ll}/u, c => c.toUpperCase());
  s = s.replace(/([.!?])\s+(\p{Ll})/gu, (m, p, c, off, str) => /(?:^|\s)(e\.g|i\.e|vs|etc|dr|mr|mrs|ms|st|no)\.$/i.test(str.slice(0, off + 1)) ? m : `${p} ${c.toUpperCase()}`);
  const words = s.split(" ").length;
  if (/[\p{L}\p{N})]$/u.test(s)) {
    if (QSTART.test(s) && words >= 3 && !/^will do\b/i.test(s)) s += "?";
    else if (words >= 5) s += ".";
  }
  return s;
}
function correct(t) {
  if (/^\[[^\]]*\]$/.test(t) || /^POLL:/i.test(t) || keepAsTyped(t)) return t;
  return t.split("\n").map(fixLine).join("\n");
}

/* ---------- write ---------- */
const byDay = new Map();
for (const m of messages) {
  if (isSystemBody(m)) { dropped.system++; continue; }
  if (hideRules.some(re => re.test(m.text))) { dropped.hidden = (dropped.hidden || 0) + 1; continue; }
  if (looksLikeIntro(m.text.replace(/[\u200e\u200f\u2066-\u2069]/g, ""))) { dropped.intros = (dropped.intros || 0) + 1; continue; }
  const text = scrub(m.text);
  if (!text) { dropped.empty++; continue; }
  if (!byDay.has(m.date)) byDay.set(m.date, []);
  const fixed = correct(text);
  byDay.get(m.date).push(fixed === text ? [m.time, aliases[senderName(m)], text] : [m.time, aliases[senderName(m)], fixed, text]);
}
if (existsSync(OUT)) rmSync(OUT, {recursive: true});
mkdirSync(OUT, {recursive: true});
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const days = [...byDay.keys()].sort().map(date => {
  const [y, mo, d] = date.split("-").map(Number);
  writeFileSync(join(OUT, `${date}.json`), JSON.stringify({date, messages: byDay.get(date)}));
  return {date, label: `${d} ${MONTHS[mo - 1]}`, count: byDay.get(date).length};
});
writeFileSync(join(OUT, "index.json"), JSON.stringify({days}, null, 1) + "\n");

/* ---------- people profiles ---------- */
const personasPath = join(ROOT, "data", "personas.json");
const personas = existsSync(personasPath) ? JSON.parse(readFileSync(personasPath, "utf8")) : {};
const slugify = s => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const fmtDay = iso => { const [, mo, d] = iso.split("-").map(Number); return `${d} ${MONTHS[mo - 1]}`; };
const hourLabel = h => `${((h + 11) % 12) + 1} ${h < 12 ? "AM" : "PM"}`;
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
const totalMsgs = rankOrder.reduce((a, k) => a + stats[k].n, 0);
const TAGLINES = {nightOwl: "Most alive after midnight", earlyBird: "Up before the chai", essayist: "Believes in paragraphs", oneLiner: "Says a lot in a few words", asker: "Always has a question", emoji: "Fluent in emoji", laugher: "Laughs first, thinks later", starter: "Wakes the chat up", responder: "Never leaves anyone on read", lurker: "Dropped by, said hi", veteran: "A fixture of the chat", chatterbox: "Carries the group chat"};
function topTrait(who) {
  const s = stats[who], rank = rankOrder.indexOf(who);
  const best = TRAITS.map(t => ({t, v: t.score(s, rank)})).filter(x => x.v >= 1).sort((a, b) => b.v - a.v)[0];
  return best ? best.t.k : null;
}
function habitsOf(s) {
  const out = [];
  const wc = Object.entries(s.wc).filter(([w, c]) => c >= 2 && w.length >= 5 && dictWords.has(w) && !STOP.has(w)).sort((a, b) => b[1] - a[1])[0];
  if (wc) out.push(`Favourite word: “${wc[0]}” (${wc[1]} times)`);
  const em = Object.entries(s.ec).sort((a, b) => b[1] - a[1])[0];
  if (em && em[1] >= 2) out.push(`Signature emoji: ${em[0]} (${em[1]} times)`);
  const pk = s.hours.indexOf(Math.max(...s.hours));
  if (s.n >= 3) out.push(`Most active around ${hourLabel(pk)}`);
  return out;
}
function autoPersona(who, label) {
  const s = stats[who], d = Object.keys(s.days).length, aw = avgW(s), parts = [];
  parts.push(`Showed up on ${fmtDay(s.first.slice(0, 10))} and has sent ${plural(s.n, "message")} across ${plural(d, "day")}.`);
  if (s.wordMsgs >= 3) parts.push(aw >= 18 ? `Writes in paragraphs, around ${Math.round(aw)} words a message.` : aw <= 4 ? `Keeps it brief, around ${Math.round(aw) || 1} words a message.` : `Averages about ${Math.round(aw)} words a message.`);
  const bits = [];
  if (s.n >= 6 && s.q / s.n >= 0.25) bits.push("asks a lot of questions");
  if (s.laugh >= 3) bits.push("laughs easily");
  if (s.n >= 5 && s.night / s.n >= 0.3) bits.push("is mostly around after midnight");
  if (s.n >= 8 && s.replies / s.n >= 0.6) bits.push("usually jumps in right after someone else");
  if (s.starts >= 3) bits.push("restarts quiet chats");
  if (bits.length) parts.push(`${bits.join(", ").replace(/^./, c => c.toUpperCase())}.`);
  return parts.join(" ");
}
const topOf = counts => { const e = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]; return e ? {name: aliases[e[0]], slug: slugify(aliases[e[0]]), n: e[1]} : null; };
const peopleOut = rankOrder.map((who, i) => {
  const s = stats[who], name = aliases[who], notes = personas[name] || {};
  const k = topTrait(who);
  return {
    slug: slugify(name), name, rank: i + 1,
    tagline: notes.tagline || (k ? TAGLINES[k] : "Part of the crowd"),
    persona: notes.persona || autoPersona(who, name),
    takes: notes.takes || [],
    curated: !!notes.persona,
    habits: habitsOf(s),
    stats: {
      messages: s.n, share: +(s.n / totalMsgs * 100).toFixed(1), days: Object.keys(s.days).length,
      avgWords: +avgW(s).toFixed(1), longest: s.longest,
      questionPct: s.n ? Math.round(s.q / s.n * 100) : 0, emojiPct: s.n ? Math.round(s.emoji / s.n * 100) : 0,
      laughs: s.laugh, nightPct: s.n ? Math.round(s.night / s.n * 100) : 0,
      peakHour: hourLabel(s.hours.indexOf(Math.max(...s.hours))),
      starts: s.starts, replies: s.replies, media: s.media, links: s.links, first: fmtDay(s.first.slice(0, 10))
    },
    daily: s.days,
    repliesTo: topOf(s.partners), repliedBy: topOf(s.repliedBy)
  };
});
writeFileSync(join(OUT, "people.json"), JSON.stringify({people: peopleOut, totalMessages: totalMsgs, days: days.map(d => d.date)}));
console.log(`Profiles: ${peopleOut.length} people, ${peopleOut.filter(p => p.curated).length} with a written persona.`);


/* ---------- report ---------- */
console.log(`Read ${files.length} export file(s), ${messages.length} unique messages, ${Object.keys(aliases).length} people.`);
console.log(`Dropped: ${dropped.system} system lines, ${dropped.empty} empty messages, ${dropped.hidden || 0} hidden by you, ${dropped.intros || 0} self-introductions hidden.`);
for (const d of days) console.log(`  ${d.date}  ${d.count} messages`);

// Leak check: anything that still looks like a name, number, link or handle.
const nameTerms = new Set();
for (const n of Object.keys(aliases)) {
  if (/\p{L}/u.test(n) && n.length >= 3) nameTerms.add(n.toLowerCase());
  for (const t of n.split(" ")) if (/^\p{L}+$/u.test(t) && t.length >= 4 && !dictWords.has(t.toLowerCase())) nameTerms.add(t.toLowerCase());
}
const flags = [];
for (const [date, rows] of byDay) for (const [time, who, text] of rows) {
  const low = text.toLowerCase();
  let why = null;
  for (const n of nameTerms) if (new RegExp(`(?<![\\p{L}\\p{N}])${esc(n)}(?![\\p{L}\\p{N}])`, "iu").test(low)) { why = "name"; break; }
  if (!why && /\d{7,}/.test(text.replace(/\s/g, ""))) why = "long number";
  if (!why && /https?:|www\./i.test(text)) why = "link";
  if (why) flags.push(`${date} ${time} [${why}] ${text.replace(/\s+/g, " ").slice(0, 100)}`);
}
console.log(flags.length ? `\nReview these ${flags.length} message(s). Add terms to exports/redactions.txt and re-run if any are personal:` : "\nLeak check: nothing flagged.");
flags.slice(0, 40).forEach(f => console.log("  " + f));
if (flags.length > 40) console.log(`  ...and ${flags.length - 40} more`);
