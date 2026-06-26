#!/usr/bin/env node
// Run with: node test-setup.js
// Verifies Twilio and Airtable are configured correctly before building the demo.

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, '.env');
const envVars = readFileSync(envPath, 'utf8')
  .split('\n')
  .filter(l => l && !l.startsWith('#'))
  .reduce((acc, line) => {
    const [key, ...rest] = line.split('=');
    if (key) acc[key.trim()] = rest.join('=').trim();
    return acc;
  }, {});
Object.assign(process.env, envVars);

import twilio from 'twilio';

const {
  ACCOUNT_SID, AUTH_TOKEN,
  API_KEY_SID, API_KEY_SECRET,
  WORKSPACE_SID, WORKFLOW_SID, WORKER_SID,
  CONVERSATIONS_SERVICE_SID,
  TWIML_APP_SID, TWILIO_PHONE_NUMBER,
  AIRTABLE_API_KEY, AIRTABLE_BASE_ID
} = process.env;

const client = twilio(ACCOUNT_SID, AUTH_TOKEN);

let passed = 0;
let failed = 0;

function ok(label) {
  console.log(`  ✓ ${label}`);
  passed++;
}

function fail(label, err) {
  console.log(`  ✗ ${label}`);
  console.log(`    ${err.message || err}`);
  failed++;
}

async function checkEnvVars() {
  console.log('\n[1] Environment Variables');
  const required = {
    ACCOUNT_SID, AUTH_TOKEN,
    API_KEY_SID, API_KEY_SECRET,
    WORKSPACE_SID, WORKFLOW_SID, WORKER_SID,
    CONVERSATIONS_SERVICE_SID,
    TWIML_APP_SID, TWILIO_PHONE_NUMBER,
    AIRTABLE_API_KEY, AIRTABLE_BASE_ID
  };
  for (const [key, val] of Object.entries(required)) {
    if (val && val.length > 5) ok(key);
    else fail(key, { message: 'missing or empty' });
  }
}

async function checkTaskRouter() {
  console.log('\n[2] TaskRouter');
  try {
    const ws = await client.taskrouter.v1.workspaces(WORKSPACE_SID).fetch();
    ok(`Workspace: ${ws.friendlyName}`);
  } catch (e) { fail('Workspace', e); }

  try {
    const wf = await client.taskrouter.v1.workspaces(WORKSPACE_SID).workflows(WORKFLOW_SID).fetch();
    ok(`Workflow: ${wf.friendlyName}`);
  } catch (e) { fail('Workflow', e); }

  try {
    const wk = await client.taskrouter.v1.workspaces(WORKSPACE_SID).workers(WORKER_SID).fetch();
    ok(`Worker: ${wk.friendlyName} (activity: ${wk.activityName})`);
  } catch (e) { fail('Worker', e); }

  try {
    const queues = await client.taskrouter.v1.workspaces(WORKSPACE_SID).taskQueues.list();
    if (queues.length > 0) ok(`Task Queues: ${queues.map(q => q.friendlyName).join(', ')}`);
    else fail('Task Queues', { message: 'no queues found' });
  } catch (e) { fail('Task Queues', e); }
}

async function checkConversations() {
  console.log('\n[3] Conversations');
  try {
    const svc = await client.conversations.v1.services(CONVERSATIONS_SERVICE_SID).fetch();
    ok(`Service: ${svc.friendlyName}`);
  } catch (e) { fail('Conversations Service', e); }
}

async function checkVoice() {
  console.log('\n[4] Voice');
  try {
    const app = await client.applications(TWIML_APP_SID).fetch();
    ok(`TwiML App: ${app.friendlyName}`);
  } catch (e) { fail('TwiML App', e); }

  try {
    const numbers = await client.incomingPhoneNumbers.list({ phoneNumber: TWILIO_PHONE_NUMBER });
    if (numbers.length > 0) ok(`Phone Number: ${TWILIO_PHONE_NUMBER}`);
    else fail('Phone Number', { message: `${TWILIO_PHONE_NUMBER} not found on this account` });
  } catch (e) { fail('Phone Number', e); }
}

async function checkAirtable() {
  console.log('\n[5] Airtable');
  try {
    const res = await fetch(`https://api.airtable.com/v0/meta/bases/${AIRTABLE_BASE_ID}/tables`, {
      headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}` }
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || JSON.stringify(data));
    const casesTable = data.tables?.find(t => t.name === 'Cases');
    if (casesTable) ok(`Cases table found (${casesTable.fields.length} fields)`);
    else fail('Cases table', { message: 'table named "Cases" not found in base' });
  } catch (e) { fail('Airtable', e); }
}

async function main() {
  console.log('=== IRIS Walmart Demo — Setup Verification ===');
  await checkEnvVars();
  await checkTaskRouter();
  await checkConversations();
  await checkVoice();
  await checkAirtable();

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
  if (failed > 0) process.exit(1);
}

main().catch(err => { console.error(err); process.exit(1); });
