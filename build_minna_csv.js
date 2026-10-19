const fs = require("fs");
const https = require("https");

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchJson(res.headers.location).then(resolve).catch(reject);
      }
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => {
        try { resolve(JSON.parse(data)); } catch(e) { reject(new Error("JSON parse error: " + e.message + " (status: " + res.statusCode + ")")); }
      });
    }).on("error", reject);
  });
}

function escapeCsv(val) {
  if (val === undefined || val === null) return "";
  const str = String(val).trim();
  if (str.includes(",") || str.includes("\"") || str.includes("\n")) {
    return "\"" + str.replace(/"/g, "\"\"") + "\"";
  }
  return str;
}

async function buildFullMinnaCsv() {
  console.log("Fetching Minna no Nihongo 1 & 2 comprehensive vocabulary...");
  // Canonical GitHub raw repo containing full 50-chapter Minna dataset
  const url = "https://raw.githubusercontent.com/charliegerard/jisho/master/data/minna-no-nihongo.json";
  
  try {
    const chapters = await fetchJson(url);
    const headers = [
      "character", "meaning", "reading", "pitchOrTone", 
      "radicals", "exampleSentence", "notes", "tags", "book", "chapter"
    ];
    
    const rows = [headers.join(",")];
    let totalCount = 0;

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
        
        // Build contextual sentence template based on word and lesson
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

    const outPath = "./minna_no_nihongo_complete_1_to_50.csv";
    fs.writeFileSync(outPath, rows.join("\n"), "utf8");
    console.log(`Success! Generated ${totalCount} vocabulary words across Chapters 1-50 at ${outPath}`);
  } catch (err) {
    console.error("Failed to generate vocabulary:", err.message);
  }
}

buildFullMinnaCsv();
