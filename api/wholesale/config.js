// Stores wholesale rules (tag + threshold) in a shop metafield for use by Functions

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(payload));
}

async function graphql(shop, token, query, variables) {
  const resp = await fetch(`https://${shop}/admin/api/2023-10/graphql.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': token,
    },
    body: JSON.stringify({ query, variables }),
  });
  const text = await resp.text();
  let json;
  try { json = JSON.parse(text); } catch (_) { json = { text }; }
  if (!resp.ok || json.errors) {
    throw new Error(`GraphQL ${resp.status}: ${text}`);
  }
  return json;
}

module.exports = async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Shopify-Access-Token');
  if (req.method === 'OPTIONS') return res.end();

  const method = req.method || 'GET';
  if (method !== 'GET' && method !== 'POST') {
    res.setHeader('Allow', 'GET, POST, OPTIONS');
    return sendJson(res, 405, { error: 'Method Not Allowed' });
  }

  const defaultShop = process.env.SHOPIFY_SHOP_DOMAIN || 'clean-camper-2471.myshopify.com';
  const shop = (req.query && req.query.shop) || defaultShop;
  const token = (req.query && req.query.token) || req.headers['x-shopify-access-token'] || (globalThis.__SHOP_TOKENS && globalThis.__SHOP_TOKENS[shop]) || process.env.SHOPIFY_ACCESS_TOKEN;
  if (!shop || !/\.myshopify\.com$/i.test(shop)) return sendJson(res, 400, { error: 'Missing or invalid ?shop=' });
  if (!token) return sendJson(res, 400, { error: 'Missing access token' });

  const body = typeof req.body === 'string' ? (() => { try { return JSON.parse(req.body); } catch { return {}; } })() : (req.body || {});
  const wholesaleTag = (body.wholesaleTag || req.query.wholesaleTag || 'Wholesaler').trim();
  const thresholdCents = Number(body.thresholdCents || req.query.thresholdCents || 100000);
  if (!Number.isFinite(thresholdCents) || thresholdCents < 0) return sendJson(res, 400, { error: 'Invalid thresholdCents' });

  const namespace = 'wholesale';
  const key = 'shipping_rules';
  const value = JSON.stringify({ wholesaleTag, thresholdCents });

  const mutation = `#graphql
    mutation SetMeta($ns: String!, $key: String!, $value: String!) {
      metafieldsSet(metafields: [
        { ownerId: "gid://shopify/Shop/1", namespace: $ns, key: $key, type: "json", value: $value }
      ]) {
        userErrors { field message }
      }
    }
  `;

  try {
    const result = await graphql(shop, token, mutation, { ns: namespace, key, value });
    return sendJson(res, 200, { status: 'saved', shop, wholesaleTag, thresholdCents, result });
  } catch (err) {
    console.error('[wholesale/config] error', err && err.stack ? err.stack : err);
    return sendJson(res, 500, { error: 'Failed to save config', message: String(err && err.message ? err.message : err) });
  }
};


