FROM evoapicloud/evolution-api@sha256:1bd8afc4a6cf48822e6cf02469aeae7bd35a12a6b616eacd1291926307f4d339

WORKDIR /evolution
RUN npm install --prefix /opt/tsf-baileys --omit=dev --ignore-scripts --no-audit --no-fund --save-exact baileys@7.0.0-rc13 \
 && rm -rf /evolution/node_modules/baileys \
 && ln -s /opt/tsf-baileys/node_modules/baileys /evolution/node_modules/baileys \
 && node --input-type=module -e "await import('baileys'); console.log('Baileys import OK')"

COPY bound-contact-picture.cjs /tmp/tsf-bound-contact-picture.cjs
RUN node /tmp/tsf-bound-contact-picture.cjs /evolution/dist \
 && node --check /evolution/dist/main.js \
 && node --check /evolution/dist/main.mjs
