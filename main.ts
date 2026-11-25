// Token Radar, a token-radar-01 entry. Node 22, standard library only.
//
// The program reads the sealed snapshot from /input/snapshot.json (or
// --input <file or directory>), scores every genuine pre-token protocol
// with the radar-2 model in lib/model.ts, and writes the ranked board to
// /output/board.json. It copies this repository's dashboard/ to /output,
// writes /output/data.js from the same board for the page to read, copies
// the three screenshots into /output/screenshots/, and last writes
// /output/dossier.json — the summary the judge reads — with the vendored
// make.fun library.
//
// The three screenshots are genuine renders of this dashboard in a
// headless browser: the board, a detail view and a filtered view. They
// live in this repository as real PNG files, and this program copies
// them unchanged, so two runs write the same bytes.
//
// The dashboard is a static page, no framework and no network:
// dashboard/index.html, dashboard/app.css and dashboard/app.js read
// /output/data.js, which this program writes from the same board.
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for
// /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <kit>/input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join as joinPath } from 'node:path';
import { fileURLToPath as urlToPath } from 'node:url';
import { boardForGate, boardProblem, buildPayload, loadUniverse, payloadScript } from './lib/model.ts';
import { buildDossier as makeDossier } from './vendor/makefun-board.ts';

const repoRoot = urlToPath(new URL('.', import.meta.url));

// The scorer's own caps (reference/gate.json): the text cap shapes the
// bytes, the rest only refuse.
const DOSSIER_TEXT_BYTES = 65_536;
const SHOT_LIMIT = { max: 4, max_bytes: 524_288 };
const DASH_LIMIT = { max_files: 400, max_bytes: 4_194_304 };
const SHOT_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

// The value after --name, or after --name=, or the fallback.
function flagValue(name: string, fallback: string): string {
  const argv = process.argv;
  const spot = argv.indexOf(`--${name}`);
  if (spot >= 0 && spot + 1 < argv.length) return argv[spot + 1]!;
  const joined = argv.find((part) => part.startsWith(`--${name}=`));
  if (joined !== undefined) return joined.slice(name.length + 3);
  return fallback;
}

function fail(message: string, code: number): never {
  process.stderr.write(`token radar: ${message}\n`);
  process.exit(code);
}

const inputGiven = flagValue('input', '/input');
const snapshotPath = inputGiven.endsWith('.json') ? inputGiven : joinPath(inputGiven, 'snapshot.json');
if (!existsSync(snapshotPath)) {
  fail(
    `no snapshot at ${snapshotPath}: pass --input <snapshot.json|directory> or mount the sealed /input`,
    2,
  );
}
const outDir = flagValue('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const universe = loadUniverse(snapshotPath);
const payload = buildPayload(universe);
const board = boardForGate(payload);
const problem = boardProblem(board, universe);
if (problem !== null) fail(`the model wrote a board the gate refuses: ${problem}`, 1);

mkdirSync(outDir, { recursive: true });
writeFileSync(joinPath(outDir, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(joinPath(outDir, 'data.js'), payloadScript(payload));

// Copy one directory's regular files into `dest`, skipping dot-names,
// and say how many landed.
function copyDirectory(from: string, dest: string): string[] {
  if (!existsSync(from)) {
    return [];
  }
  mkdirSync(dest, { recursive: true });
  const landed: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.charAt(0) === '.') continue;
    const source = joinPath(from, name);
    if (!statSync(source).isFile()) continue;
    copyFileSync(source, joinPath(dest, name));
    landed.push(name);
  }
  return landed;
}

const dashboardNames = copyDirectory(joinPath(repoRoot, 'dashboard'), joinPath(outDir, 'dashboard'));

// Copy the screenshots, checking each one is a real PNG or JPEG inside
// the caps, with a long side at most 1440 and a short side at least 800.
function copyShots(from: string, dest: string): string[] {
  if (!existsSync(from)) {
    return [];
  }
  mkdirSync(dest, { recursive: true });
  const landed: string[] = [];
  const names = readdirSync(from).sort();
  for (const name of names) {
    if (name.charAt(0) === '.') continue;
    if (!name.endsWith('.png') && !name.endsWith('.jpg') && !name.endsWith('.jpeg')) continue;
    const source = joinPath(from, name);
    if (!statSync(source).isFile()) continue;
    const bytes = readFileSync(source);
    const png =
      bytes.length > 8 &&
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47;
    const jpeg = bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    if (!png && !jpeg) fail(`screenshots/${name} is neither a PNG nor a JPEG`, 1);
    if (bytes.length > SHOT_LIMIT.max_bytes) {
      fail(`screenshots/${name} is ${bytes.length} bytes, over the 512 KiB cap`, 1);
    }
    if (png) {
      const wide = bytes.readUInt32BE(16);
      const tall = bytes.readUInt32BE(20);
      if (Math.max(wide, tall) > 1440 || Math.min(wide, tall) < 800) {
        fail(
          `screenshots/${name} is ${wide}x${tall}: long side at most 1440, short side at least 800`,
          1,
        );
      }
    }
    writeFileSync(joinPath(dest, name), bytes);
    landed.push(name);
  }
  return landed;
}

const shotNames = copyShots(joinPath(repoRoot, 'screenshots'), joinPath(outDir, 'screenshots'));
if (shotNames.length < 3) {
  fail(
    `screenshots/ holds ${shotNames.length} image${shotNames.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view`,
    1,
  );
}
for (const name of shotNames) {
  if (!SHOT_NAME.test(name)) {
    fail(
      `screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters, not starting with . or -`,
      1,
    );
  }
}

// The dossier is written last: the scorer rebuilds it from this /output
// and compares the bytes.
const dossierBytes = makeDossier(outDir, {
  text_max_bytes: DOSSIER_TEXT_BYTES,
  screenshots: SHOT_LIMIT,
  dashboard: DASH_LIMIT,
});
writeFileSync(joinPath(outDir, 'dossier.json'), dossierBytes);

const summary =
  `token radar: ${universe.protocols.length} protocols, ${universe.watchlist.length} on the watchlist, ${board.length} rows scored (${payload.live.length} live set aside)\n` +
  `token radar: wrote ${joinPath(outDir, 'board.json')}, ${joinPath(outDir, 'data.js')}, ${joinPath(outDir, 'dashboard')} (${dashboardNames.length} files), ${joinPath(outDir, 'screenshots')} (${shotNames.length} images) and ${joinPath(outDir, 'dossier.json')}\n`;
process.stdout.write(summary);
