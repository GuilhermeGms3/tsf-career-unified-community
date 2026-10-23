import assert from "node:assert/strict";
import test from "node:test";
import {readFile} from "node:fs/promises";
import patch from "../docker/evolution-compat/bound-contact-picture.cjs";

test("imagem instala Baileys isolado e valida importacao pela Evolution",async()=>{
  const dockerfile=await readFile(new URL("../docker/evolution-compat/Dockerfile",import.meta.url),"utf8");
  assert.match(dockerfile,/npm install --prefix \/opt\/tsf-baileys .*--ignore-scripts .*baileys@7\.0\.0-rc13/);
  assert.match(dockerfile,/ln -s \/opt\/tsf-baileys\/node_modules\/baileys \/evolution\/node_modules\/baileys/);
  assert.match(dockerfile,/await import\('baileys'\)/);
  assert.match(dockerfile,/node --check \/evolution\/dist\/main\.mjs/);
});

test("foto acessoria nao prende indefinidamente a fila Evolution", async () => {
  const started = performance.now();
  assert.equal(await patch.boundedContactPicture({ profilePictureUrl: () => new Promise(() => {}) }, "test-jid", 20), null);
  assert.ok(performance.now() - started < 500);
  assert.equal(await patch.boundedContactPicture({ profilePictureUrl: async () => "picture" }, "test-jid", 20), "picture");
  await assert.rejects(() => patch.boundedContactPicture({ profilePictureUrl: async () => { throw new Error("Unreachable"); } }, "test-jid", 20), /Unreachable/);
});

test("patch de compatibilidade falha fechado se o upstream mudar", () => {
  const source = 'async profilePicture(e){let t=G(e);try{let o=await this.client.profilePictureUrl(t,"image");return{wuid:t,profilePictureUrl:o}}catch{return{wuid:t,profilePictureUrl:null}}}';
  const result = patch.patchBundle(source);
  assert.match(result, /await __tsfBoundedContactPicture\(this.client,t\)/);
  assert.throws(() => patch.patchBundle("unrecognized upstream"), /Unexpected/);
  assert.throws(() => patch.patchBundle(source + source), /Unexpected/);
});
