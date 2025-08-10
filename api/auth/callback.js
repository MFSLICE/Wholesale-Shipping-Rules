const crypto = require('crypto');

function timingSafeEqualStr(a, b) {
  const ab = Buffer.from(String(a), 'utf8');
  const bb = Buffer.from(String(b), 'utf8');
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

// Prefer using the raw querystring to preserve original encoding for HMAC
function buildHmacMessageFromRequestUrl(reqUrl, fallbackQueryObject) {
  try {
    const raw = (reqUrl || '').split('?')[1] || '';
    const parts = raw
      .split('&')
      .filter(Boolean)
      .filter((kv) => !kv.startsWith('hmac=') && !kv.startsWith('signature='))
      .sort();
    if (parts.length > 0) return parts.join('&');
  } catch (_) {}
  // Fallback to object reconstruction if raw not available
  const entries = Object.keys(fallbackQueryObject || {})
    .filter((k) => k !== 'hmac' && k !== 'signature')
    .sort()
    .map((k) => `${k}=${Array.isArray(fallbackQueryObject[k]) ? fallbackQueryObject[k].join(',') : fallbackQueryObject[k]}`);
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
    // If already exists, attempt an update of the existing service with same name
    if (resp.status === 422) {
      try {
        const listUrl = `https://${shop}/admin/api/2023-10/carrier_services.json`;
        const listResp = await fetch(listUrl, {
          headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': accessToken },
        });
        if (listResp.ok) {
          const list = await listResp.json();
          const existing = (list.carrier_services || []).find(cs => cs.name === 'Wholesale Shipping Rules');
          if (existing && existing.id) {
            const updateUrl = `https://${shop}/admin/api/2023-10/carrier_services/${existing.id}.json`;
            const updateBody = { carrier_service: { id: existing.id, name: 'Wholesale Shipping Rules', callback_url: callbackUrl, service_discovery: false } };
            const updateResp = await fetch(updateUrl, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': accessToken },
              body: JSON.stringify(updateBody),
            });
            const updateText = await updateResp.text();
            console.log('Carrier service update status', updateResp.status, updateText);
          }
        }
      } catch (e) {
        console.warn('Carrier service update attempt failed', e && e.message ? e.message : e);
      }
    }
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
  console.log('[oauth/callback] incoming params:', { shop, hasHmac: Boolean(hmac), hasCode: Boolean(code), state });
  if (!shop || !hmac || !code || !state) {
    res.statusCode = 400;
    console.error('[oauth/callback] missing params');
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
  console.log('[oauth/callback] state check:', { stateParam: state, stateCookie });
  if (!stateCookie || !timingSafeEqualStr(stateCookie, state)) {
    res.statusCode = 403;
    console.error('[oauth/callback] invalid state');
    return res.end('Invalid OAuth state');
  }

  // Verify HMAC
  const message = buildHmacMessageFromRequestUrl(req.url, req.query);
  const computed = crypto
    .createHmac('sha256', process.env.SHOPIFY_API_SECRET)
    .update(message)
    .digest('hex');
  console.log('[oauth/callback] hmac check:', { computed, provided: hmac, message });
  if (!timingSafeEqualStr(computed, hmac)) {
    res.statusCode = 401;
    console.error('[oauth/callback] HMAC validation failed');
    return res.end('HMAC validation failed');
  }

  try {
    const accessToken = await exchangeCodeForToken(shop, code);
    console.log('[oauth/callback] token acquired');

    // Demo storage (memory). Replace with persistent storage in production.
    if (!globalThis.__SHOP_TOKENS) globalThis.__SHOP_TOKENS = {};
    globalThis.__SHOP_TOKENS[shop] = accessToken;

    const protocol = req.headers['x-forwarded-proto'] || 'https';
    const host = req.headers.host;
    const baseUrl = process.env.APP_URL || `${protocol}://${host}`;
    const callbackUrl = `${baseUrl}/api/shipping-rates?shop=${encodeURIComponent(shop)}`;

    await registerCarrierService(shop, accessToken, callbackUrl);
    console.log('[oauth/callback] carrier service registration attempted for', { callbackUrl });

    res.statusCode = 302;
    res.setHeader('Location', '/');
    return res.end();
  } catch (err) {
    console.error('[oauth/callback] error:', err && err.stack ? err.stack : err);
    res.statusCode = 500;
    return res.end('OAuth error');
  }
};


