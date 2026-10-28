// World English Bible lookup, used by the content tools (never by the app).
// Source: eng-web_vpl.txt from https://ebible.org/Scriptures/eng-web_vpl.zip
// (one verse per line: "PSA 4:8 In peace I will …").
import { readFileSync } from 'node:fs';

export const BOOKS = {
  Genesis: 'GEN', Exodus: 'EXO', Leviticus: 'LEV', Numbers: 'NUM', Deuteronomy: 'DEU',
  Joshua: 'JOS', Judges: 'JDG', Ruth: 'RUT', '1 Samuel': '1SA', '2 Samuel': '2SA',
  '1 Kings': '1KI', '2 Kings': '2KI', '1 Chronicles': '1CH', '2 Chronicles': '2CH',
  Ezra: 'EZR', Nehemiah: 'NEH', Esther: 'EST', Job: 'JOB', Psalm: 'PSA', Psalms: 'PSA',
  Proverbs: 'PRO', Ecclesiastes: 'ECC', 'Song of Solomon': 'SOL', Isaiah: 'ISA',
  Jeremiah: 'JER', Lamentations: 'LAM', Ezekiel: 'EZE', Daniel: 'DAN', Hosea: 'HOS',
  Joel: 'JOE', Amos: 'AMO', Obadiah: 'OBA', Jonah: 'JON', Micah: 'MIC', Nahum: 'NAH',
  Habakkuk: 'HAB', Zephaniah: 'ZEP', Haggai: 'HAG', Zechariah: 'ZEC', Malachi: 'MAL',
  Matthew: 'MAT', Mark: 'MAR', Luke: 'LUK', John: 'JOH', Acts: 'ACT', Romans: 'ROM',
  '1 Corinthians': '1CO', '2 Corinthians': '2CO', Galatians: 'GAL', Ephesians: 'EPH',
  Philippians: 'PHI', Colossians: 'COL', '1 Thessalonians': '1TH', '2 Thessalonians': '2TH',
  '1 Timothy': '1TI', '2 Timothy': '2TI', Titus: 'TIT', Philemon: 'PHM', Hebrews: 'HEB',
  James: 'JAM', '1 Peter': '1PE', '2 Peter': '2PE', '1 John': '1JO', '2 John': '2JO',
  '3 John': '3JO', Jude: 'JUD', Revelation: 'REV',
};

const REF_RE = /^(.+?) (\d+):(\d+)(?:[–-](\d+))?$/;

/** "Psalm 121:7–8" -> { book: 'PSA', chapter: 121, from: 7, to: 8 } or null. */
export function parseRef(ref) {
  const m = REF_RE.exec(String(ref).trim());
  if (!m || !BOOKS[m[1]]) return null;
  const from = +m[3];
  const to = m[4] ? +m[4] : from;
  if (to < from) return null;
  return { book: BOOKS[m[1]], chapter: +m[2], from, to };
}

export function loadWeb(path) {
  const map = new Map();
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = /^(\w{3}) (\d+:\d+) (.*)$/.exec(line);
    if (m) map.set(`${m[1]} ${m[2]}`, m[3].trim());
  }
  if (map.size < 30000) throw new Error(`${path} does not look like eng-web_vpl.txt`);
  return map;
}

// Psalm titles are merged into verse 1 in the source; strip the exact title.
const PSALM_TITLES = JSON.parse(readFileSync(new URL('./psalm-titles.json', import.meta.url), 'utf8'));

function stripPsalmTitle(chapter, text) {
  const title = PSALM_TITLES[chapter];
  if (!title) return text;
  if (!text.startsWith(title)) throw new Error(`Psalm ${chapter}:1 does not start with its title "${title}"`);
  return text.slice(title.length).trim();
}

const OPEN = { '”': '“', '’': '‘' };
const CLOSE = { '“': '”', '‘': '’' };

// ’ is a closing quote only after punctuation (“…peace.’”); otherwise an apostrophe.
function isClosingSingle(text, i) {
  return /[.,!?;:—]/.test(text[i - 1] || '') || text[i + 1] === '”';
}

/**
 * Complete quotation marks cut off by the passage boundary: a passage that
 * starts inside a quotation gets its opening mark, one that ends inside a
 * quotation gets its closing mark. The words themselves never change.
 */
export function tidyQuotes(text) {
  const stack = [];
  const missingOpen = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '“' || ch === '‘') stack.push(ch);
    else if (ch === '”' || (ch === '’' && isClosingSingle(text, i))) {
      const want = OPEN[ch];
      if (stack.length && stack[stack.length - 1] === want) stack.pop();
      else if (!stack.length) missingOpen.unshift(want);
    }
  }
  return missingOpen.join('') + text + stack.reverse().map((ch) => CLOSE[ch]).join('');
}

/**
 * Display rules for a passage lifted out of its context (wording untouched):
 * drop the musical note "Selah", capitalise the first letter, and end a
 * passage that stops mid-sentence with an ellipsis.
 */
export function presentVerse(text) {
  let t = text.replace(/\s*\bSelah\.?(?=\s|$)/g, '').replace(/\s+/g, ' ').trim();
  t = t.replace(/^([“‘]*)(\p{Ll})/u, (_, q, ch) => q + ch.toUpperCase());
  t = t.replace(/[,;:—]$/, '…');
  return tidyQuotes(t);
}

/** Verse text for a reference: the WEB wording, with the display rules above. */
export function lookup(web, ref) {
  const r = parseRef(ref);
  if (!r) throw new Error(`Unrecognised reference "${ref}"`);
  const parts = [];
  for (let v = r.from; v <= r.to; v++) {
    const key = `${r.book} ${r.chapter}:${v}`;
    let text = web.get(key);
    if (!text) throw new Error(`"${ref}": ${key} not found in the WEB source`);
    if (r.book === 'PSA' && v === 1) text = stripPsalmTitle(r.chapter, text);
    parts.push(text);
  }
  return presentVerse(parts.join(' '));
}
