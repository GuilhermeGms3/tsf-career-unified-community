const fs = require("node:fs");
const path = require("node:path");

async function boundedContactPicture(client, jid, timeoutMs = 500) {
  let timer;
  try {
    return await Promise.race([
      client.profilePictureUrl(jid, "image"),
      new Promise(resolve => { timer = setTimeout(() => resolve(null), timeoutMs); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function patchBundle(source) {
  const needle = 'await this.client.profilePictureUrl(t,"image")';
  const matches = source.split(needle).length - 1;
  if (matches !== 1) throw new Error(`Unexpected Evolution profile picture boundary: ${matches}`);
  return `const __tsfBoundedContactPicture=${boundedContactPicture.toString()};\n` + source.replace(needle, "await __tsfBoundedContactPicture(this.client,t)");
}

module.exports = { boundedContactPicture, patchBundle };

if (require.main === module) {
  const root = path.resolve(process.argv[2] || "/evolution/dist");
  for (const name of ["main.js", "main.mjs"]) {
    const file = path.join(root, name);
    fs.writeFileSync(file, patchBundle(fs.readFileSync(file, "utf8")));
  }
  console.log("Evolution contact picture timeout applied to both entrypoints");
}
