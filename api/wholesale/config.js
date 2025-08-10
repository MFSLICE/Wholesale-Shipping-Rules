// Stores wholesale rules (tag + threshold) using Metaobjects for use by Functions

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

  // Use Metaobjects (you have write_metaobjects/read_metaobjects scopes)
  // 1) Ensure definition exists
  const defHandle = 'wholesale_rules';
  const ensureDefQuery = `#graphql
    query GetDefinition($handle: String!) {
      metaobjectDefinitionByHandle(handle: $handle) { id handle name }
    }
  `;
  const createDefMutation = `#graphql
    mutation CreateDefinition($handle: String!) {
      metaobjectDefinitionCreate(
        handle: $handle,
        name: "Wholesale Rules",
        fieldDefinitions: [
          { name: "Wholesale Tag", key: "wholesale_tag", type: single_line_text_field, required: true },
          { name: "Threshold Cents", key: "threshold_cents", type: number_integer, required: true }
        ]
      ) { metaobjectDefinition { id handle } userErrors { field message } }
    }
  `;

  // 2) Upsert a single entry (use fixed handle 'default')
  const upsertEntryMutation = `#graphql
    mutation UpsertEntry($type: String!, $handle: String!, $wholesaleTag: String!, $threshold: String!) {
      metaobjectUpsert(
        metaobject: {
          type: $type,
          handle: $handle,
          fields: [
            { key: "wholesale_tag", value: $wholesaleTag },
            { key: "threshold_cents", value: $threshold }
          ]
        }
      ) {
        metaobject { id handle type }
        userErrors { field message }
      }
    }
  `;

  try {
    // Ensure definition
    const existing = await graphql(shop, token, ensureDefQuery, { handle: defHandle });
    if (!existing?.data?.metaobjectDefinitionByHandle) {
      const created = await graphql(shop, token, createDefMutation, { handle: defHandle });
      if (created?.data?.metaobjectDefinitionCreate?.userErrors?.length) {
        return sendJson(res, 422, { error: 'Failed to create metaobject definition', errors: created.data.metaobjectDefinitionCreate.userErrors });
      }
    }

    // Upsert entry
    const upsert = await graphql(shop, token, upsertEntryMutation, {
      type: defHandle,
      handle: 'default',
      wholesaleTag,
      threshold: String(thresholdCents)
    });
    const errs = upsert?.data?.metaobjectUpsert?.userErrors || [];
    if (errs.length) return sendJson(res, 422, { error: 'Failed to save rules', errors: errs });

    return sendJson(res, 200, { status: 'saved', shop, wholesaleTag, thresholdCents, metaobject: upsert?.data?.metaobjectUpsert?.metaobject });
  } catch (err) {
    console.error('[wholesale/config] error', err && err.stack ? err.stack : err);
    return sendJson(res, 500, { error: 'Failed to save config', message: String(err && err.message ? err.message : err) });
  }
};


