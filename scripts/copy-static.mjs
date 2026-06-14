import { cp, mkdir } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const source = path.join(root, "src", "renderer");
const target = path.join(root, "dist", "renderer");

await mkdir(target, { recursive: true });
await cp(path.join(source, "index.html"), path.join(target, "index.html"));
await cp(path.join(source, "styles.css"), path.join(target, "styles.css"));
