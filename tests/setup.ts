import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Every test file gets its own throwaway data directory (database, keys, workspace).
process.env.MORPHIE_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "morphie-test-"));
