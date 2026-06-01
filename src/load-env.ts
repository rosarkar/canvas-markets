import path from "node:path";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";

/** Resolve env paths from the repo root, not `process.cwd()` (tsx may use another cwd). */
const srcDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(srcDir, "..");

dotenv.config({ path: path.join(repoRoot, ".env") });
dotenv.config({ path: path.join(srcDir, ".env"), override: true });
