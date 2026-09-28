/* Generates a Web Push (VAPID) key pair for medicine reminders. Run once: node tools/vapid_keys.mjs
   - the PUBLIC key goes in config.js as window.DAYBOOK_PUSH.publicKey (public by design)
   - the PRIVATE key (a JWK) goes in the VAPID_PRIVATE_KEY repository secret, which the deploy
     workflow hands to the bridge. Never commit it. */
import { generateKeyPairSync } from 'node:crypto';

const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const pub = publicKey.export({ format: 'jwk' });
const priv = privateKey.export({ format: 'jwk' });
const raw = Buffer.concat([Buffer.from([4]), Buffer.from(pub.x, 'base64url'), Buffer.from(pub.y, 'base64url')]).toString('base64url');
console.log('Public key, for config.js (window.DAYBOOK_PUSH.publicKey):\n' + raw + '\n');
console.log('Private key, for the VAPID_PRIVATE_KEY secret (the whole line):\n' + JSON.stringify(priv));
