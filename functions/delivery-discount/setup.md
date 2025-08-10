Prereqs:
- Shopify CLI installed
- App is created in Partners and installed on the store

Steps to scaffold a Delivery Discount Function:

1) Initialize the function inside this project (from repo root):

   shopify app function create \
     --title "Wholesale Free Shipping" \
     --type discount \
     --name delivery-discount \
     --path functions/delivery-discount

2) Implement logic in the generated function code to:
   - Read shop metafield `wholesale.shipping_rules` (JSON) for `{ wholesaleTag, thresholdCents }`
   - Check customer tags for `wholesaleTag`
   - Compute cart subtotal in cents
   - If wholesaler and subtotal >= thresholdCents: return a free shipping discount
   - Else: return no discount

3) Build and deploy function:

   shopify app function build --path functions/delivery-discount
   shopify app function deploy --path functions/delivery-discount

4) Create automatic discount in Admin linked to this function, or bind via app extension UI.

Notes:
- Delivery Customization function could hide free rate under threshold; Delivery Discount ensures free shipping only when threshold is met.
- Keep Admin API 2023-10 for config endpoints.


