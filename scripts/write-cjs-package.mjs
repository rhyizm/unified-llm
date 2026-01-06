import { promises as fs } from "node:fs";
import path from "node:path";

const out = path.resolve("dist/cjs/package.json");
await fs.mkdir(path.dirname(out), { recursive: true });
await fs.writeFile(out, JSON.stringify({ type: "commonjs" }, null, 2) + "\n", "utf8");
