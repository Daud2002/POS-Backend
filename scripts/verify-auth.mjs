const API = process.env.API_URL ?? 'http://localhost:3000/api';

const post = async (path, body, token) => {
  const res = await fetch(API + path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body ?? {}),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};

const get = async (path, token) => {
  const res = await fetch(API + path, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};

const results = [];
const check = (name, pass, detail = '') =>
  results.push({ name, pass, detail });

// 1. Login
const login = await post('/auth/login', {
  email: 'admin@poscloud.com',
  password: 'admin123',
});
check('login succeeds', login.status === 201 || login.status === 200, `status ${login.status}`);

const { accessToken, refreshToken } = login.body;
const claims = JSON.parse(Buffer.from(accessToken.split('.')[1], 'base64'));
check('access token lives 30 min', claims.exp - claims.iat === 1800, `${claims.exp - claims.iat}s`);
check('refresh token issued', typeof refreshToken === 'string' && refreshToken.length === 64);

// 2. Access token works
const me = await get('/auth/me', accessToken);
check('/auth/me authorised', me.status === 200);
check('/auth/me hides passwordHash', me.body && !('passwordHash' in me.body));

// 3. Rotation
const r1 = await post('/auth/refresh', { refreshToken });
check('refresh returns a new pair', r1.status === 201 && !!r1.body?.accessToken && !!r1.body?.refreshToken, `status ${r1.status}`);
check('refresh token actually rotates', r1.body?.refreshToken !== refreshToken);
check('rotated access token is usable', (await get('/auth/me', r1.body.accessToken)).status === 200);

// 4. Reuse detection: replay the ORIGINAL token, which has now been rotated
const replay = await post('/auth/refresh', { refreshToken });
check('replaying a used refresh token is rejected', replay.status === 401, `status ${replay.status}`);

// 5. ...and that replay must burn the whole family, so the CURRENT token dies too
const afterBreach = await post('/auth/refresh', { refreshToken: r1.body.refreshToken });
check('reuse revokes the whole family', afterBreach.status === 401, `status ${afterBreach.status}`);

// 6. Logout revokes
const fresh = await post('/auth/login', { email: 'admin@poscloud.com', password: 'admin123' });
await post('/auth/logout', { refreshToken: fresh.body.refreshToken });
const afterLogout = await post('/auth/refresh', { refreshToken: fresh.body.refreshToken });
check('refresh fails after logout', afterLogout.status === 401, `status ${afterLogout.status}`);

// 7. Garbage token
check('garbage refresh token rejected', (await post('/auth/refresh', { refreshToken: 'x'.repeat(64) })).status === 401);

// 8. Guards actually closed
check('GET /users without token is 401', (await get('/users')).status === 401);
check('POST /stores without token is 401', (await post('/stores', { name: 'x' })).status === 401);
check('GET /employees/store/xyz without token is 401', (await get('/employees/store/00000000-0000-0000-0000-000000000000')).status === 401);
check('GET /orders/:id without token is 401', (await get('/orders/00000000-0000-0000-0000-000000000000')).status === 401);

// 9. Super admin still allowed through RolesGuard
check('super admin CAN list users', (await get('/users', r1.body.accessToken)).status === 200);
check('super admin CAN list stores', (await get('/stores', r1.body.accessToken)).status === 200);

let failed = 0;
for (const r of results) {
  if (!r.pass) failed++;
  console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? '  (' + r.detail + ')' : ''}`);
}
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
