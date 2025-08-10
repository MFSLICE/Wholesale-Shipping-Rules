// Manually set up the Shopify Carrier Service after app installation

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(payload));
}

module.exports = async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Shopify-Access-Token');
  if (req.method === 'OPTIONS') return res.end();

  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST, OPTIONS');
    return sendJson(res, 405, { error: 'Method Not Allowed' });
  }

  const defaultShop = 'clean-camper-2471.myshopify.com';
  const shop = (req.query && req.query.shop) || process.env.SHOPIFY_SHOP_DOMAIN || defaultShop;
  const tokenFromHeader = req.headers['x-shopify-access-token'];
  const tokenFromQuery = req.query && req.query.token;
  const tokenFromMemory = globalThis.__SHOP_TOKENS && globalThis.__SHOP_TOKENS[shop];
  const tokenFromEnv = process.env.SHOPIFY_ACCESS_TOKEN;
  const accessToken = tokenFromQuery || tokenFromHeader || tokenFromMemory || tokenFromEnv;

  if (!shop || !/\.myshopify\.com$/i.test(shop)) {
    return sendJson(res, 400, { error: 'Missing or invalid shop domain', example: defaultShop });
  }
  if (!accessToken) {
    return sendJson(res, 400, { error: 'Missing access token. Provide ?token=, X-Shopify-Access-Token header, in-memory token from OAuth, or SHOPIFY_ACCESS_TOKEN env.' });
  }

  const callbackUrl = 'https://wholesale-shipping-rules.vercel.app/api/shipping-rates';
  const url = `https://${shop}/admin/api/2023-10/carrier_services.json`;
  const body = {
    carrier_service: {
      name: 'Wholesale Shipping Rules',
      callback_url: callbackUrl,
      service_discovery: true,
    },
  };

  console.log('[setup-carrier] creating', JSON.stringify({ shop, callbackUrl }));

  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': accessToken,
      },
      body: JSON.stringify(body),
    });

    const text = await resp.text();
    if (!resp.ok) {
      console.warn('[setup-carrier] failed', resp.status, text);
      return sendJson(res, 502, { error: 'Failed to create carrier service', status: resp.status, body: text });
    }
    console.log('[setup-carrier] success', text);
    return sendJson(res, 200, { status: 'created', response: text });
  } catch (err) {
    console.error('[setup-carrier] exception', err && err.stack ? err.stack : err);
    return sendJson(res, 500, { error: 'Exception creating carrier service', message: String(err && err.message ? err.message : err) });
  }
};


