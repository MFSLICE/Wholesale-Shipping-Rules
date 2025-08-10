// Manually create or update the Shopify Carrier Service for this app

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(payload));
}

async function listCarrierServices(shop, accessToken) {
  const url = `https://${shop}/admin/api/2023-10/carrier_services.json`;
  const resp = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': accessToken,
    },
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`List carrier services failed ${resp.status}: ${text}`);
  }
  return resp.json();
}

async function createCarrierService(shop, accessToken, callbackUrl) {
  const url = `https://${shop}/admin/api/2023-10/carrier_services.json`;
  const body = {
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
    body: JSON.stringify(body),
  });
  return resp;
}

async function updateCarrierService(shop, accessToken, id, callbackUrl) {
  const url = `https://${shop}/admin/api/2023-10/carrier_services/${id}.json`;
  const body = {
    carrier_service: {
      id,
      name: 'Wholesale Shipping Rules',
      callback_url: callbackUrl,
      service_discovery: false,
    },
  };
  const resp = await fetch(url, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': accessToken,
    },
    body: JSON.stringify(body),
  });
  return resp;
}

module.exports = async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.end();

  const method = req.method || 'GET';
  if (method !== 'POST' && method !== 'GET') {
    res.setHeader('Allow', 'GET, POST');
    return sendJson(res, 405, { error: 'Method Not Allowed' });
  }

  const shop = (req.query && req.query.shop) || process.env.SHOPIFY_SHOP_DOMAIN;
  const queryToken = req.query && req.query.token;
  const headerToken = req.headers['x-shopify-access-token'];
  const memoryToken = globalThis.__SHOP_TOKENS && shop ? globalThis.__SHOP_TOKENS[shop] : undefined;
  const envToken = process.env.SHOPIFY_ACCESS_TOKEN;
  const accessToken = queryToken || headerToken || memoryToken || envToken;

  if (!shop || !shop.endsWith('.myshopify.com')) {
    return sendJson(res, 400, { error: 'Missing or invalid ?shop= parameter' });
  }
  if (!accessToken) {
    return sendJson(res, 400, { error: 'Access token missing. Provide ?token=, X-Shopify-Access-Token header, in-memory token from OAuth, or SHOPIFY_ACCESS_TOKEN env.' });
  }

  const protocol = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers.host;
  const baseUrl = process.env.APP_URL || `${protocol}://${host}`;
  const callbackUrl = `${baseUrl}/api/shipping-rates?shop=${encodeURIComponent(shop)}`;

  console.log('[create-carrier] start', JSON.stringify({ shop, callbackUrl }));

  try {
    // Try create first
    let resp = await createCarrierService(shop, accessToken, callbackUrl);
    if (!resp.ok) {
      const text = await resp.text();
      console.warn('[create-carrier] create failed', resp.status, text);
      // If already exists (422), try to update existing one with same name
      if (resp.status === 422) {
        const list = await listCarrierServices(shop, accessToken);
        const existing = (list.carrier_services || []).find(cs => cs.name === 'Wholesale Shipping Rules');
        if (existing && existing.id) {
          resp = await updateCarrierService(shop, accessToken, existing.id, callbackUrl);
          const updatedText = await resp.text();
          console.log('[create-carrier] update status', resp.status, updatedText);
          return sendJson(res, 200, { status: 'updated', id: existing.id, response: updatedText });
        }
      }
      // Otherwise return failure details
      return sendJson(res, 500, { error: 'Failed to create carrier service', status: resp.status, body: text });
    }

    const body = await resp.json();
    console.log('[create-carrier] created', JSON.stringify(body));
    return sendJson(res, 200, { status: 'created', carrier_service: body.carrier_service || body });
  } catch (err) {
    console.error('[create-carrier] error', err && err.stack ? err.stack : err);
    return sendJson(res, 500, { error: 'Exception creating carrier service', message: String(err && err.message ? err.message : err) });
  }
};


