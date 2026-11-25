const fs=require('node:fs');const path=require('node:path');const {protectString}=require('../electron/windows-protected-data.cjs');
const root=path.join(process.env.LOCALAPPDATA,'AI-Education-Manager/activation-ops');const source=path.join(root,'backup.key');
const key=fs.readFileSync(source);if(key.length!==32)throw Error('Backup key has invalid length');
fs.writeFileSync(path.join(root,'backup-key.enc'),protectString(key.toString('base64')),{mode:0o600});fs.unlinkSync(source);console.log('Backup recovery key protected for current Windows user');
