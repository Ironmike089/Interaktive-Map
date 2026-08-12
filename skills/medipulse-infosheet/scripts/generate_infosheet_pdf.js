// Erzeugt ein Infosheet-PDF im exakt gleichen Layout wie der PDF-Export in
// der echten App, indem die App-eigene buildInfosheetPdf()-Funktion aus
// js/app.js in einem Headless-Browser wiederverwendet wird — so bleibt die
// vom Skill ausgegebene PDF-Datei optisch identisch mit dem, was ein
// Vertriebsmitarbeiter direkt aus der App exportieren würde.
//
// Usage: node generate_infosheet_pdf.js <doctorId> <outputPath> <sheetJsonPath>
//
// <doctorId>      numerische ID aus data/aerzte-teil*.json.gz
// <outputPath>    Zielpfad für die erzeugte PDF-Datei
// <sheetJsonPath> JSON-Datei mit den sechs recherchierten Feldern, Form:
//                 { "createdBy", "createdAt", "updatedAt", "trigger",
//                   "verkauft", "firmografie", "struktur", "produkt",
//                   "aufhaenger": ["These 1", "These 2"] }

const { chromium } = require("playwright");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const net = require("net");

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

const [, , doctorIdArg, outputPath, sheetJsonPath] = process.argv;
if (!doctorIdArg || !outputPath || !sheetJsonPath) {
  console.error("Usage: node generate_infosheet_pdf.js <doctorId> <outputPath> <sheetJsonPath>");
  process.exit(1);
}
const doctorId = Number(doctorIdArg);
const sheetData = JSON.parse(fs.readFileSync(sheetJsonPath, "utf8"));

function findFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
    srv.on("error", reject);
  });
}

function waitForServer(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const req = require("http").get(url, (res) => {
        res.resume();
        resolve();
      });
      req.on("error", () => {
        if (Date.now() > deadline) reject(new Error("Server nicht erreichbar: " + url));
        else setTimeout(tryOnce, 200);
      });
    };
    tryOnce();
  });
}

(async () => {
  const port = await findFreePort();
  const server = spawn("python3", ["-m", "http.server", String(port)], {
    cwd: REPO_ROOT,
    stdio: "ignore",
  });

  try {
    const baseUrl = `http://localhost:${port}`;
    await waitForServer(`${baseUrl}/index.html`, 10000);

    const browser = await chromium.launch();
    const page = await browser.newPage();

    await page.route("**/tiles.openfreemap.org/**", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ version: 8, sources: {}, layers: [], glyphs: "https://example.com/{fontstack}/{range}.pbf", sprite: "" }),
      });
    });

    await page.goto(`${baseUrl}/index.html`, { waitUntil: "load" });
    await page.waitForFunction(() => typeof mapReady !== "undefined" && mapReady === true && dataReady === true, { timeout: 15000 });

    const base64 = await page.evaluate(
      ({ doctorId, sheetData }) => {
        const d = AERZTE_DATA.find((x) => x.id === doctorId);
        if (!d) throw new Error("Arzt/Praxis mit dieser ID nicht gefunden: " + doctorId);
        const doc = buildInfosheetPdf(d, sheetData);
        return doc.output("datauristring").split(",")[1];
      },
      { doctorId, sheetData }
    );

    fs.writeFileSync(outputPath, Buffer.from(base64, "base64"));
    console.log("PDF geschrieben nach", outputPath);

    await browser.close();
  } finally {
    server.kill();
  }
})();
