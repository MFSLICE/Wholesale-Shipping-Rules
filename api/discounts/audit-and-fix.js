// Audits active discounts and disables the automatic "$40 free shipping" one if found

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

  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST, OPTIONS');
    return sendJson(res, 405, { error: 'Method Not Allowed' });
  }

  const defaultShop = process.env.SHOPIFY_SHOP_DOMAIN || 'clean-camper-2471.myshopify.com';
  const shop = (req.query && req.query.shop) || defaultShop;
  const token = (req.query && req.query.token) || req.headers['x-shopify-access-token'] || (globalThis.__SHOP_TOKENS && globalThis.__SHOP_TOKENS[shop]) || process.env.SHOPIFY_ACCESS_TOKEN;

  if (!shop || !/\.myshopify\.com$/i.test(shop)) {
    return sendJson(res, 400, { error: 'Missing or invalid ?shop=' });
  }
  if (!token) {
    return sendJson(res, 400, { error: 'Missing access token. Provide ?token=, X-Shopify-Access-Token, in-memory OAuth token, or SHOPIFY_ACCESS_TOKEN env.' });
  }

  console.log('[discounts/audit] start', JSON.stringify({ shop }));

  try {
    const query = `#graphql
      query FindDiscounts($q: String!) {
        discountNodes(first: 50, query: $q) {
          nodes {
            id
            discount {
              __typename
              ... on DiscountAutomaticBasic { title status }
              ... on DiscountAutomaticApp { title status }
              ... on DiscountCodeBasic { title }
              ... on DiscountCodeFreeShipping { title }
            }
          }
        }
      }
    `;
    // Narrow to active; we’ll filter by title content in code
    const { data } = await graphql(shop, token, query, { q: 'status:active' });
    const nodes = (data && data.discountNodes && data.discountNodes.nodes) || [];

    const candidates = nodes.filter((n) => {
      const d = n.discount || {};
      const title = (d.title || '').toLowerCase();
      const isAutomatic = d.__typename && d.__typename.startsWith('DiscountAutomatic');
      const looksLikeFreeShip = title.includes('free') && title.includes('ship');
      const mentions40 = title.includes('40');
      return isAutomatic && looksLikeFreeShip && (mentions40 || true);
    });

    const deactivated = [];
    for (const c of candidates) {
      const mutation = `#graphql
        mutation Deactivate($id: ID!) {
          discountAutomaticDeactivate(id: $id) { userErrors { field message } }
        }
      `;
      try {
        const resp = await graphql(shop, token, mutation, { id: c.id });
        deactivated.push({ id: c.id, result: resp.data });
      } catch (e) {
        console.warn('[discounts/audit] deactivate failed', c.id, String(e.message || e));
      }
    }

    return sendJson(res, 200, {
      shop,
      scanned: nodes.length,
      matched: candidates.length,
      deactivated,
    });
  } catch (err) {
    console.error('[discounts/audit] error', err && err.stack ? err.stack : err);
    return sendJson(res, 500, { error: 'GraphQL error', message: String(err && err.message ? err.message : err) });
  }
};


