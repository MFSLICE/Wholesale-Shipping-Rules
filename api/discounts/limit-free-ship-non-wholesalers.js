// Restrict the existing automatic free-shipping discount to NON-wholesalers only

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
  const discountTitle = (req.query && req.query.title) || '$40 free shipping';
  const wholesaleTag = (req.query && req.query.tag) || 'Wholesaler';
  const segmentName = `Non-Wholesalers (auto)`;

  if (!shop || !/\.myshopify\.com$/i.test(shop)) return sendJson(res, 400, { error: 'Missing or invalid ?shop=' });
  if (!token) return sendJson(res, 400, { error: 'Missing access token' });

  console.log('[discounts/limit] start', JSON.stringify({ shop, discountTitle, wholesaleTag, segmentName }));

  try {
    // 1) Ensure a customer segment that EXCLUDES wholesalers exists
    const segmentQuery = `#graphql
      query Segments($q: String) {
        segments(first: 50, query: $q) {
          nodes { id name query }
        }
      }
    `;
    const segList = await graphql(shop, token, segmentQuery, { q: `name:${JSON.stringify(segmentName)}` });
    let segmentId = segList?.data?.segments?.nodes?.find(n => n.name === segmentName)?.id;

    if (!segmentId) {
      // Segment definition: customers NOT tagged with 'Wholesaler'
      const definition = `-customer_tags:'${wholesaleTag}'`;
      const createSegMutation = `#graphql
        mutation SegmentCreate($name: String!, $query: String!) {
          segmentCreate(name: $name, query: $query) { userErrors { field message } segment { id name query } }
        }
      `;
      const segResp = await graphql(shop, token, createSegMutation, { name: segmentName, query: definition });
      segmentId = segResp?.data?.segmentCreate?.segment?.id;
      if (!segmentId) {
        return sendJson(res, 500, { error: 'Failed to create non-wholesaler segment', response: segResp });
      }
      console.log('[discounts/limit] created segment', JSON.stringify({ segmentId }));
    }

    // 2) Find the automatic free-shipping discount by title
    const findDiscounts = `#graphql
      query FindDiscounts($q: String!) {
        discountNodes(first: 50, query: $q) {
          nodes {
            id
            discount {
              __typename
              ... on DiscountAutomaticBasic { title status }
              ... on DiscountAutomaticApp { title status }
            }
          }
        }
      }
    `;
    const { data: dData } = await graphql(shop, token, findDiscounts, { q: `status:active title:${JSON.stringify(discountTitle)}` });
    const nodes = dData?.discountNodes?.nodes || [];
    const target = nodes.find(n => (n.discount?.title || '').toLowerCase() === discountTitle.toLowerCase());
    if (!target) {
      return sendJson(res, 404, { error: 'Discount not found by title', title: discountTitle });
    }

    const discountId = target.id;

    // 3) Update the discount to restrict to the non-wholesaler segment
    // Note: exact input shape may vary; we attempt DiscountAutomaticBasicUpdate with customerSelection by segments.
    const updateMutation = `#graphql
      mutation UpdateAutomatic($id: ID!, $basic: DiscountAutomaticBasicInput!) {
        discountAutomaticBasicUpdate(id: $id, basic: $basic) {
          userErrors { field message }
          discountAutomaticBasic { id }
        }
      }
    `;
    const basic = {
      title: discountTitle,
      customerSelection: {
        customers: null,
        segments: { add: [segmentId], remove: [] },
        all: false
      }
    };

    const updResp = await graphql(shop, token, updateMutation, { id: discountId, basic });
    const errors = updResp?.data?.discountAutomaticBasicUpdate?.userErrors || [];
    if (errors.length) {
      return sendJson(res, 422, { error: 'Failed to update discount customer selection', errors });
    }

    return sendJson(res, 200, { status: 'updated', discountId, segmentId });
  } catch (err) {
    console.error('[discounts/limit] error', err && err.stack ? err.stack : err);
    return sendJson(res, 500, { error: 'Exception updating discount', message: String(err && err.message ? err.message : err) });
  }
};


