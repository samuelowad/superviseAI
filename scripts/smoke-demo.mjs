#!/usr/bin/env node

const API_BASE_URL = process.env.SMOKE_API_BASE_URL ?? 'http://localhost:3000/api/v1';

const DEFAULT_PASSWORD = process.env.SMOKE_DEFAULT_PASSWORD ?? 'SuperviseAI123!';

const personas = [
  {
    label: 'Professor',
    email: process.env.SMOKE_PROFESSOR_EMAIL ?? 'professor@superviseai.local',
    password: process.env.SMOKE_PROFESSOR_PASSWORD ?? DEFAULT_PASSWORD,
    checks: ['/dashboard/professor', '/dashboard/professor/analytics', '/cohorts', '/milestones'],
  },
  {
    label: 'Student',
    email: process.env.SMOKE_STUDENT_EMAIL ?? 'student@superviseai.local',
    password: process.env.SMOKE_STUDENT_PASSWORD ?? DEFAULT_PASSWORD,
    checks: ['/theses/me/workspace'],
  },
];

async function call(path, options = {}, token) {
  const headers = new Headers(options.headers ?? {});
  headers.set('Accept', 'application/json');
  if (options.body !== undefined) {
    headers.set('Content-Type', 'application/json');
  }
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  const contentType = response.headers.get('content-type') ?? '';
  const json = contentType.includes('application/json') ? await response.json() : null;

  return { response, json };
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function runHealthCheck() {
  const { response, json } = await call('/health');
  assert(response.ok, `GET /health failed (${response.status})`);
  assert(json?.ok === true, 'GET /health did not return { ok: true }');
  console.log('[ok] health');
}

async function runPersonaCheck(persona) {
  const { response: loginResponse, json: loginPayload } = await call('/auth/login', {
    method: 'POST',
    body: {
      email: persona.email,
      password: persona.password,
    },
  });

  assert(loginResponse.ok, `${persona.label} login failed (${loginResponse.status})`);
  assert(
    typeof loginPayload?.access_token === 'string' && loginPayload.access_token.length > 0,
    `${persona.label} login did not return access_token`,
  );
  const token = loginPayload.access_token;
  console.log(`[ok] ${persona.label.toLowerCase()} login`);

  const { response: meResponse, json: mePayload } = await call('/auth/me', {}, token);
  assert(meResponse.ok, `${persona.label} /auth/me failed (${meResponse.status})`);
  assert(mePayload?.user?.email === persona.email, `${persona.label} /auth/me email mismatch`);
  console.log(`[ok] ${persona.label.toLowerCase()} auth/me`);

  for (const endpoint of persona.checks) {
    const { response } = await call(endpoint, {}, token);
    assert(response.ok, `${persona.label} ${endpoint} failed (${response.status})`);
    console.log(`[ok] ${persona.label.toLowerCase()} ${endpoint}`);
  }
}

async function main() {
  console.log(`Running demo smoke checks against ${API_BASE_URL}`);
  await runHealthCheck();
  for (const persona of personas) {
    await runPersonaCheck(persona);
  }
  console.log('All smoke checks passed.');
}

main().catch((error) => {
  console.error(`Smoke check failed: ${error.message}`);
  process.exitCode = 1;
});
