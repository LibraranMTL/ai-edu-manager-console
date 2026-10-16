'use strict';
// Explicit opt-in: official login, no student data, no credential reads/logs.
const { app, shell } = require('electron');
const { spawn } = require('node:child_process');
const path = require('node:path');
app.whenReady().then(async () => {
  const { createClassificationAuth } = require('../electron/classification-auth.cjs');
  const { discoverWorkBuddyRuntime } = require('../electron/workbuddy-runtime.cjs');
  let auth;
  auth = createClassificationAuth({ directory: path.join(process.env.APPDATA, 'edu-manager-launcher/classification-auth'),
    workBuddyLogin: options => require('../electron/workbuddy-login.cjs').startWorkBuddyLogin({ ...options, fetchImpl: async (url, init) => {
      try { const response = await fetch(url, init); console.log(JSON.stringify({ localLoginEndpoint: new URL(url).pathname, status: response.status, ...(response.ok ? {} : { diagnostic: (await response.clone().text()).slice(0, 300) }) })); return response; }
      catch (error) { console.log(JSON.stringify({ localLoginError: error.cause?.code || error.name })); throw error; }
    } }),
    spawn: (exe, args, options) => {
      const child = spawn(exe, args, { ...options, env: { ...options.env, ELECTRON_RUN_AS_NODE: '1' } });
      for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => {
        const text = String(chunk);
        for (const [name, pattern] of Object.entries({ rawModeUnsupported: /Raw mode is not supported/i, loginRequired: /authentication required|not logged in/i, loginSucceeded: /login successful|successfully logged in/i, urlEmitted: /https:\/\/www\.workbuddy\.cn\/login/, browserFailed: /failed to open browser/i }))
          if (pattern.test(text)) console.log(JSON.stringify({ diagnostic: name }));
      });
      child.on('close', code => { console.log(JSON.stringify({ processClosed: code })); setTimeout(() => app.exit(code || 0), 1000); });
      return child;
    },
    openUrl: async url => { console.log(JSON.stringify({ officialLoginOpened: true })); await shell.openExternal(url); },
    changed: () => console.log(JSON.stringify({ status: auth.status('workbuddy') })),
  });
  const runtime = discoverWorkBuddyRuntime('D:/Program Files/WorkBuddy/WorkBuddy.exe', { findExecutable: () => '', hostNodePath: process.execPath });
  console.log(JSON.stringify(await auth.start('workbuddy', { runtime }, `acceptance-${Date.now()}`)));
}).catch(error => { console.error(error.message); app.exit(1); });
