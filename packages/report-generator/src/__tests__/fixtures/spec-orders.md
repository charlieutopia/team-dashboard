# Sales Module Orders Specification

## Overview
This spec defines the Order subsystem for the Sales Module, including order creation, status transitions, and line item management.

## 1. Order Creation Endpoint

**Endpoint:** `POST /api/orders`

**Request body:**
```json
{
  "customer_id": "cust_123",
  "cart_id": "cart_456",
  "notes": "Deliver by Friday"
}
```

**Response:** `201 Created` with Order object.

**Constraints:**
- Customer must exist (validated via customer service)
- Cart must contain at least one item
- Cart total must not exceed $10,000 USD

## 2. Order Status State Machine

An Order transitions through the following states:

- **draft** — initial state after creation
- **confirmed** — customer confirmed, payment received
- **fulfilled** — all line items shipped
- **cancelled** — order cancelled by customer or system

Valid transitions:
- `draft` → `confirmed` (on payment capture)
- `confirmed` → `fulfilled` (on final shipment)
- `draft` → `cancelled` (customer request)
- `confirmed` → `cancelled` (within 24 hours of confirmation)

## 3. Cart-to-Order Conversion

When converting a cart to an order:

1. Validate cart state (not already converted, contains items)
2. Reserve inventory for each line item
3. Create Order record with `draft` status
4. Clear the cart
5. Return Order ID to client

**Idempotency:** conversion is idempotent via `Idempotency-Key` header.

## 4. Order Line Item Validation

Each order line item must satisfy:

- Product ID is valid
- Quantity > 0
- Quantity ≤ available stock
- Unit price matches catalog at time of order creation
- No duplicate product IDs within one order

**Metadata:** each line item stores product_name, sku, and unit_price at capture time (immutable after creation).

## 5. Order Retrieval

**Endpoint:** `GET /api/orders/:order_id`

Returns full Order object with nested line_items array.

---

*Last updated: 2026-05-09*
