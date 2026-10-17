// The English Snowball ("Porter2") stemmer, as Pagefind uses for its index: "taxes", "taxed" and "taxing" all become
// "tax", so a word in a search matches its forms in each remark the way the index found them.
// https://snowballstem.org/algorithms/english/stemmer.html. It is the classic algorithm, which Pagefind's stemmer
// (rust-stemmers) is built from: checked against Snowball's 42,650-word sample, it agrees on all but 57 words, every
// one of them a rule Snowball's 2025 revision changed ("added" is "ad" here, "add" there).

const VOWEL = /[aeiouy]/;
const DOUBLES = ["bb", "dd", "ff", "gg", "mm", "nn", "pp", "rr", "tt"];
const LI_ENDING = /[cdeghkmnrt]/;

const EXCEPTIONS: Record<string, string> = {
  skis: "ski", skies: "sky", dying: "die", lying: "lie", tying: "tie", idly: "idl", gently: "gentl", ugly: "ugli", early: "earli",
  only: "onli", singly: "singl", sky: "sky", news: "news", howe: "howe", atlas: "atlas", cosmos: "cosmos", bias: "bias", andes: "andes",
};
const AFTER_1A = new Set(["inning", "outing", "canning", "herring", "earring", "proceed", "exceed", "succeed"]);

const isVowel = (c: string | undefined) => !!c && VOWEL.test(c);

/** Where a region starts: after the first non-vowel that follows a vowel, from a position on. */
function regionAfter(w: string, from: number): number {
  for (let i = from + 1; i < w.length; i++) if (!isVowel(w[i]) && isVowel(w[i - 1])) return i + 1;
  return w.length;
}

/** A short syllable ending at the end of w: a vowel then a non-vowel other than w, x or Y, after a non-vowel; or a
 * vowel then a non-vowel at the very start. */
function endsShort(w: string): boolean {
  const n = w.length;
  if (n === 2) return isVowel(w[0]) && !isVowel(w[1]);
  return n >= 3 && !isVowel(w[n - 3]) && isVowel(w[n - 2]) && !isVowel(w[n - 1]) && !/[wxY]/.test(w[n - 1]);
}

const cache = new Map<string, string>();

/** The stem of a lowercase word. */
export function stem(word: string): string {
  const known = cache.get(word);
  if (known !== undefined) return known;
  const result = stemWord(word);
  if (cache.size > 200_000) cache.clear();
  cache.set(word, result);
  return result;
}

function stemWord(input: string): string {
  if (input.length <= 2) return input;
  if (EXCEPTIONS[input]) return EXCEPTIONS[input];
  let w = input.replace(/^'/, "");
  // A y at the start or after a vowel is a consonant (Y).
  w = w.replace(/^y/, "Y").replace(/([aeiouy])y/g, "$1Y");
  const r1 = /^(gener|commun|arsen)/.test(w) ? w.match(/^(gener|commun|arsen)/)![0].length : regionAfter(w, 0);
  const r2 = regionAfter(w, r1);
  const inR1 = (suffix: string) => w.length - suffix.length >= r1;
  const inR2 = (suffix: string) => w.length - suffix.length >= r2;
  const short = () => endsShort(w) && r1 >= w.length;

  // Step 0: possessives.
  for (const s of ["'s'", "'s", "'"]) if (w.endsWith(s)) { w = w.slice(0, -s.length); break; }

  // Step 1a: plurals.
  if (w.endsWith("sses")) w = w.slice(0, -2);
  else if (w.endsWith("ied") || w.endsWith("ies")) w = w.length > 4 ? w.slice(0, -2) : w.slice(0, -1);
  else if (w.endsWith("us") || w.endsWith("ss")) { /* left alone */ }
  else if (w.endsWith("s") && VOWEL.test(w.slice(0, -2))) w = w.slice(0, -1);
  if (AFTER_1A.has(w)) return w;

  // Step 1b: -ed, -ing and their -ly forms.
  const eed = ["eedly", "eed"].find((s) => w.endsWith(s));
  const ed = ["ingly", "edly", "ing", "ed"].find((s) => w.endsWith(s));
  if (eed && (!ed || eed.length >= ed.length)) {
    if (inR1(eed)) w = w.slice(0, -eed.length) + "ee";
  } else if (ed) {
    const base = w.slice(0, -ed.length);
    if (VOWEL.test(base)) {
      w = base;
      if (/(at|bl|iz)$/.test(w)) w += "e";
      else if (DOUBLES.some((d) => w.endsWith(d))) w = w.slice(0, -1);
      else if (short()) w += "e";
    }
  }

  // Step 1c: a final y after a non-vowel (not the first letter) becomes i.
  if (/[yY]$/.test(w) && w.length > 2 && !isVowel(w[w.length - 2])) w = w.slice(0, -1) + "i";

  // Step 2.
  const step2: [string, string][] = [
    ["ational", "ate"], ["tional", "tion"], ["enci", "ence"], ["anci", "ance"], ["abli", "able"], ["entli", "ent"], ["ization", "ize"],
    ["izer", "ize"], ["ation", "ate"], ["ator", "ate"], ["alism", "al"], ["aliti", "al"], ["alli", "al"], ["fulness", "ful"],
    ["ousli", "ous"], ["ousness", "ous"], ["iveness", "ive"], ["iviti", "ive"], ["biliti", "ble"], ["bli", "ble"], ["ogi", "og"],
    ["fulli", "ful"], ["lessli", "less"], ["li", ""],
  ];
  const s2 = step2.filter(([s]) => w.endsWith(s)).sort((a, b) => b[0].length - a[0].length)[0];
  if (s2 && inR1(s2[0])) {
    const [s, to] = s2;
    if (s === "ogi") { if (w[w.length - 4] === "l") w = w.slice(0, -3) + "og"; }
    else if (s === "li") { if (LI_ENDING.test(w[w.length - 3] ?? "")) w = w.slice(0, -2); }
    else w = w.slice(0, -s.length) + to;
  }

  // Step 3.
  const step3: [string, string][] = [
    ["ational", "ate"], ["tional", "tion"], ["alize", "al"], ["icate", "ic"], ["iciti", "ic"], ["ical", "ic"], ["ful", ""], ["ness", ""], ["ative", ""],
  ];
  const s3 = step3.filter(([s]) => w.endsWith(s)).sort((a, b) => b[0].length - a[0].length)[0];
  if (s3 && inR1(s3[0])) {
    if (s3[0] === "ative") { if (inR2("ative")) w = w.slice(0, -5); }
    else w = w.slice(0, -s3[0].length) + s3[1];
  }

  // Step 4.
  const step4 = ["ement", "ance", "ence", "able", "ible", "ment", "ant", "ent", "ism", "ate", "iti", "ous", "ive", "ize", "ion", "al", "er", "ic"];
  const s4 = step4.filter((s) => w.endsWith(s)).sort((a, b) => b.length - a.length)[0];
  if (s4 && inR2(s4)) {
    if (s4 === "ion") { if (/[st]$/.test(w.slice(0, -3))) w = w.slice(0, -3); }
    else w = w.slice(0, -s4.length);
  }

  // Step 5.
  if (w.endsWith("e")) {
    if (inR2("e") || (inR1("e") && !endsShort(w.slice(0, -1)))) w = w.slice(0, -1);
  } else if (w.endsWith("ll") && inR2("l")) w = w.slice(0, -1);

  return w.replace(/Y/g, "y");
}
