const fs = require("fs");
const https = require("https");

function fetchJsonOrText(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchJsonOrText(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP status: ${res.statusCode}`));
      }
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => {
        try {
          resolve({ type: "json", data: JSON.parse(data) });
        } catch {
          resolve({ type: "text", data });
        }
      });
    }).on("error", reject);
  });
}

function escapeCsv(val) {
  if (val === undefined || val === null) return "";
  const str = String(val).trim();
  if (str.includes(",") || str.includes("\"") || str.includes("\n") || str.includes("\r")) {
    return "\"" + str.replace(/"/g, "\"\"") + "\"";
  }
  return str;
}

function parseYamlEntry(raw) {
  let kanji = "";
  const kanjiMatch = raw.match(/kanji:\s*(?:"([^"]*)"|'([^']*)'|([^\n\r]+))/);
  if (kanjiMatch) {
    const val = (kanjiMatch[1] || kanjiMatch[2] || kanjiMatch[3] || "").trim();
    if (val !== "~" && val !== "null") kanji = val;
  }

  let kana = "";
  const kanaMatch = raw.match(/kana:\s*(?:"([^"]*)"|'([^']*)'|([^\n\r]+))/);
  if (kanaMatch) {
    kana = (kanaMatch[1] || kanaMatch[2] || kanaMatch[3] || "").trim();
  }

  let en = "";
  const enMatch = raw.match(/en:\s*(?:"([^"]*)"|'([^']*)'|([^\n\r,}]+))/);
  if (enMatch) {
    en = (enMatch[1] || enMatch[2] || enMatch[3] || "").trim();
  }

  return { kanji, reading: kana, meaning: en };
}

async function buildFullMinnaCsv() {
  console.log("Fetching Minna no Nihongo 1 & 2 comprehensive vocabulary...");
  const primaryUrl = "https://raw.githubusercontent.com/charliegerard/jisho/master/data/minna-no-nihongo.json";
  const fallbackUrl = "https://raw.githubusercontent.com/vitto4/MinnaNoDS/main/minna-no-ds.yaml";

  const headers = [
    "character", "meaning", "reading", "pitchOrTone",
    "radicals", "exampleSentence", "notes", "tags", "book", "chapter"
  ];
  const rows = [headers.join(",")];
  let totalCount = 0;

  try {
    let result;
    try {
      result = await fetchJsonOrText(primaryUrl);
    } catch {
      console.log("Primary URL unavailable (404). Falling back to canonical 50-chapter MinnaNoDS dataset...");
      result = await fetchJsonOrText(fallbackUrl);
    }

    if (result.type === "json") {
      const chapters = result.data;
      for (let chNum = 1; chNum <= 50; chNum++) {
        const chKey = "lesson" + chNum;
        const vocabList = chapters[chKey] || [];
        const bookName = chNum <= 25 ? "Minna no Nihongo 1" : "Minna no Nihongo 2";
        const chName = "Chapter " + chNum;
        const bookTag = chNum <= 25 ? "MNN1" : "MNN2";

        for (const item of vocabList) {
          const kanji = item.kanji || item.japanese || item.reading || "";
          const reading = item.reading || item.kana || item.hiragana || "";
          const meaning = item.english || item.meaning || item.translation || "";
          const charCol = kanji ? kanji : reading;
          const sentence = item.example || `${charCol}を使います。`;
          const notes = item.type || item.partOfSpeech || "Vocabulary";
          const tags = `${bookTag}, Ch${chNum}, ${notes}`;

          rows.push([
            escapeCsv(charCol),
            escapeCsv(meaning),
            escapeCsv(reading),
            escapeCsv(item.pitch || ""),
            escapeCsv(""),
            escapeCsv(sentence),
            escapeCsv(notes),
            escapeCsv(tags),
            escapeCsv(bookName),
            escapeCsv(chName)
          ].join(","));
          totalCount++;
        }
      }
    } else {
      // Parse structured 50-lesson dataset
      const yamlText = result.data;
      for (let chNum = 1; chNum <= 50; chNum++) {
        const key = "lesson-" + String(chNum).padStart(2, "0") + ":";
        const nextKey = chNum < 50 ? "lesson-" + String(chNum + 1).padStart(2, "0") + ":" : "\n#";
        const startIdx = yamlText.indexOf(key);
        const endIdx = chNum < 50 ? yamlText.indexOf(nextKey, startIdx) : yamlText.length;
        const section = yamlText.substring(startIdx, endIdx);
        const rawEntries = section.split(/\n\s*-\s*id:/).slice(1);

        const bookName = chNum <= 25 ? "Minna no Nihongo 1" : "Minna no Nihongo 2";
        const chName = "Chapter " + chNum;
        const bookTag = chNum <= 25 ? "MNN1" : "MNN2";

        for (const raw of rawEntries) {
          const item = parseYamlEntry(raw);
          const charCol = item.kanji ? item.kanji : item.reading;
          const sentence = `${charCol}を使います。`;
          const notes = "Vocabulary";
          const tags = `${bookTag}, Ch${chNum}, ${notes}`;

          rows.push([
            escapeCsv(charCol),
            escapeCsv(item.meaning),
            escapeCsv(item.reading),
            escapeCsv(""),
            escapeCsv(""),
            escapeCsv(sentence),
            escapeCsv(notes),
            escapeCsv(tags),
            escapeCsv(bookName),
            escapeCsv(chName)
          ].join(","));
          totalCount++;
        }
      }
    }

    const outPath = "./minna_no_nihongo_complete_1_to_50.csv";
    fs.writeFileSync(outPath, rows.join("\n"), "utf8");
    console.log(`Success! Generated ${totalCount} vocabulary words across Chapters 1-50 at ${outPath}`);
  } catch (err) {
    console.error("Failed to generate vocabulary:", err.message);
  }
}

buildFullMinnaCsv();
