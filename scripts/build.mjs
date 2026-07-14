import { cpSync, copyFileSync, mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = resolve(root, "dist");

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
copyFileSync(resolve(root, "index.html"), resolve(dist, "index.html"));
cpSync(resolve(root, "src"), resolve(dist, "src"), { recursive: true });
cpSync(resolve(root, "public"), resolve(dist, "public"), { recursive: true });

console.log("Static dashboard built in dist/");
