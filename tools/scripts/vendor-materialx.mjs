import { promises as fs} from "node:fs";
import path from "node:path";

const root = path.resolve(process.cwd());

const SRC = path.resolve(root, "node_modules/@needle-tools/materialx");
const DST = path.resolve(root, "web/public/usd-viewer/vendor/materialx/npm");

async function main() {
  let st;
  try {
    st = await fs.stat(SRC);
  } catch {
    console.error(`Source not found: ${SRC}\nRun: npm install @needle-tools/materialx`);
    process.exit(1);
  }

  if (!st || !st.isDirectory()) {
    console.error(`Source is not a directory: ${SRC}`);
    process.exit(1);
  }

  await fs.rm(DST, { recursive: true, force: true });
  await fs.cp(SRC, DST, { recursive: true, dereference: true});
  console.log(`Vendored @needle-tools/materialx -> ${DST}`);
}
  
main().catch((err) => {
  console.error(err);
  process.exit(1);
});


