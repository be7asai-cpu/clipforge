/**
 * Apply new option keys to all language packs and rebuild.
 * node scripts/apply-i18n-new-options.js
 */
const fs = require("fs");
const path = require("path");
const dir = path.join(__dirname, "i18n-data");
const { pl, en } = require("./i18n-new-keys-pl-en.json");

// Lang packs for new keys only (full UI strings). English base + overrides.
const overrides = {
  de: require("./i18n-packs/de-new.json"),
  es: require("./i18n-packs/es-new.json"),
  fr: require("./i18n-packs/fr-new.json"),
  it: require("./i18n-packs/it-new.json"),
  pt: require("./i18n-packs/pt-new.json"),
  ru: require("./i18n-packs/ru-new.json"),
  zh: require("./i18n-packs/zh-new.json"),
  ar: require("./i18n-packs/ar-new.json"),
  hi: require("./i18n-packs/hi-new.json"),
};

function load(name) {
  return JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"));
}
function save(name, obj) {
  fs.writeFileSync(
    path.join(dir, name),
    JSON.stringify(obj, null, 2) + "\n",
    "utf8"
  );
}

// 1) pl + en
const plJ = { ...load("pl.json"), ...pl };
const enJ = { ...load("en.json"), ...en };
save("pl.json", plJ);
save("en.json", enJ);
console.log("pl", Object.keys(plJ).length, "en", Object.keys(enJ).length);

// 2) others: en base for missing + overrides for new option keys
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".json"))) {
  if (f === "pl.json" || f === "en.json") continue;
  const code = f.replace(/\.json$/, "");
  const j = load(f);
  let filled = 0;
  for (const k of Object.keys(plJ)) {
    if (j[k] == null) {
      j[k] = enJ[k] != null ? enJ[k] : plJ[k];
      filled++;
    }
  }
  if (overrides[code]) Object.assign(j, overrides[code]);
  // always ensure new keys from en if override incomplete
  for (const k of Object.keys(en)) {
    if (j[k] == null) j[k] = en[k];
  }
  save(f, j);
  console.log(code, "keys", Object.keys(j).length, "filled", filled);
}

// verify
const must = Object.keys(en);
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".json"))) {
  const j = load(f);
  const miss = must.filter((k) => j[k] == null);
  console.log("check", f, miss.length ? "MISS " + miss.join(",") : "OK");
}
