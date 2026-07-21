# Nam Nam Cart Drawer Merge Files

Use this checklist when merging the custom `nn-cart-drawer.liquid` functionality into the live Shopify theme.

## Required Files

These files are part of the custom Nam Nam cart drawer and should be merged together.

- `sections/nn-cart-drawer.liquid`
- `assets/nn-cart.js`
- `assets/nn-cart.css`
- `snippets/cart-discount.liquid`

## Required Theme Integration

This file includes the custom cart drawer section in the theme layout.

- `layout/theme.liquid`

Required line:

```liquid
{% section 'nn-cart-drawer' %}
```

In this project, it is currently near the end of the `<body>`.

## Required Settings

Merge this only if the live theme does not already have the custom section configured.

- `config/settings_data.json`

Relevant section entry:

```json
"nn-cart-drawer": {
  "type": "nn-cart-drawer"
}
```

This contains live-configurable values such as:

- Hero line
- Reward tier thresholds
- Reward labels
- Free gift product handles
- Gift wrap product
- Upsell collection
- Bestseller collection
- Reservation timer
- Free shipping threshold
- Explore CTA URL

## Optional / Only If Modified

These files are related to cart behavior but are not core custom Nam Nam cart drawer files. Merge them only if they were intentionally changed for this feature.

- `sections/main-cart-footer.liquid`
- `sections/header.liquid`
- `assets/product-form.js`
- `assets/quick-add.js`
- `assets/quick-order-list.js`

## Default Dawn Cart Drawer Files

These are the original Dawn cart drawer files. They are related to Shopify cart behavior but are separate from the custom Nam Nam drawer.

Do not merge these unless there are deliberate custom changes.

- `snippets/cart-drawer.liquid`
- `sections/cart-drawer.liquid`
- `assets/cart-drawer.js`
- `assets/cart.js`
- `assets/component-cart-drawer.css`
- `assets/component-cart.css`
- `assets/component-cart-items.css`
- `assets/component-discounts.css`
- `assets/component-loading-overlay.css`
- `assets/component-price.css`
- `assets/component-totals.css`

## Important Note

The current theme renders both:

- The default Dawn cart drawer when `settings.cart_type == 'drawer'`
- The custom Nam Nam drawer through `layout/theme.liquid`

Before merging to live, confirm whether the live theme should keep the default Dawn drawer enabled or rely only on the custom Nam Nam drawer.
