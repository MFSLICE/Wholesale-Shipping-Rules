const crypto = require('crypto');

function timingSafeEqualStr(a, b) {
  const ab = Buffer.from(String(a), 'utf8');
  const bb = Buffer.from(String(b), 'utf8');
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function buildHmacMessageFromQuery(query) {
  const entries = Object.keys(query)
    .filter((k) => k !== 'hmac' && k !== 'signature')
    .sort()
    .map((k) => `${k}=${Array.isArray(query[k]) ? query[k].join(',') : query[k]}`);
  return entries.join('&');
}

async function exchangeCodeForToken(shop, code) {
  const url = `https://${shop}/admin/oauth/access_token`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: process.env.SHOPIFY_API_KEY,
      client_secret: process.env.SHOPIFY_API_SECRET,
      code,
    }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Token exchange failed ${resp.status}: ${text}`);
  }
  const json = await resp.json();
  return json.access_token;
}

async function registerCarrierService(shop, accessToken, callbackUrl) {
  const url = `https://${shop}/admin/api/2023-10/carrier_services.json`;
  const payload = {
    carrier_service: {
      name: 'Wholesale Shipping Rules',
      callback_url: callbackUrl,
      service_discovery: false,
    },
  };
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': accessToken,
    },
    body: JSON.stringify(payload),
  });
  if (!resp.ok) {
    const text = await resp.text();
    console.warn('Carrier service register response', resp.status, text);
  }
}

module.exports = async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }

  if (req.method !== 'GET') {
    res.statusCode = 405;
    res.setHeader('Allow', 'GET');
    return res.end('Method Not Allowed');
  }

  const { shop, hmac, code, state } = req.query || {};
  if (!shop || !hmac || !code || !state) {
    res.statusCode = 400;
    return res.end('Missing required parameters');
  }

  // Verify state
  const cookies = (req.headers.cookie || '')
    .split(';')
    .map((c) => c.trim())
    .reduce((acc, cur) => {
      const ix = cur.indexOf('=');
      if (ix > -1) acc[cur.slice(0, ix)] = cur.slice(ix + 1);
      return acc;
    }, {});
  const stateCookie = cookies['shopify_oauth_state'];
  if (!stateCookie || !timingSafeEqualStr(stateCookie, state)) {
    res.statusCode = 403;
    return res.end('Invalid OAuth state');
  }

  // Verify HMAC
  const message = buildHmacMessageFromQuery(req.query);
  const computed = crypto
    .createHmac('sha256', process.env.SHOPIFY_API_SECRET)
    .update(message)
    .digest('hex');
  if (!timingSafeEqualStr(computed, hmac)) {
    res.statusCode = 401;
    return res.end('HMAC validation failed');
  }

  try {
    const accessToken = await exchangeCodeForToken(shop, code);

    // Demo storage (memory). Replace with persistent storage in production.
    if (!globalThis.__SHOP_TOKENS) globalThis.__SHOP_TOKENS = {};
    globalThis.__SHOP_TOKENS[shop] = accessToken;

    const protocol = req.headers['x-forwarded-proto'] || 'https';
    const host = req.headers.host;
    const baseUrl = process.env.APP_URL || `${protocol}://${host}`;
    const callbackUrl = `${baseUrl}/api/shipping-rates?shop=${encodeURIComponent(shop)}`;

    await registerCarrierService(shop, accessToken, callbackUrl);

    res.statusCode = 302;
    res.setHeader('Location', '/public/index.html');
    return res.end();
  } catch (err) {
    console.error('OAuth flow error:', err && err.message ? err.message : err);
    res.statusCode = 500;
    return res.end('OAuth error');
  }
};


