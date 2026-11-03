import type { Router } from "express";
import { z } from "zod";
import {
  CatalogSchema,
  CoinOrderActionSchema,
  CoinOrderPageSchema,
  CoinOrderQuerySchema,
  CoinOrderSchema,
  CoinProductSchema,
  CreateCoinOrderSchema,
  IdParamsSchema,
  UpsertCoinProductSchema,
  type CoinOrderStatus,
} from "@idrok/shared";
import type { AppDeps } from "../../deps";
import { routesFor } from "../../http/route";
import type { OpenApiRegistry } from "../../openapi/registry";
import { receiveImage } from "../question-bank/question-bank.routes";
import { ShopService } from "./shop.service";

const tags = ["coin-shop"];
const OrderResult = z.object({ order: CoinOrderSchema, balance: z.number().int(), duplicate: z.boolean() });
const ArchiveSchema = z.object({ archived: z.boolean() }).strict();
const IMAGE_VIEW = { anyOf: ["coin_shop.manage", "coin_orders.process", "portal.student"] } as const;

export function shopRoutes(router: Router, registry: OpenApiRegistry, deps: AppDeps) {
  const shop = new ShopService(deps.db, deps.storage);
  const route = routesFor(router, registry);

  route(
    {
      method: "get",
      path: "/coin-shop/products",
      summary: "All products (archived too)",
      tags,
      access: "coin_shop.manage",
      responses: { 200: { description: "Products", schema: z.array(CoinProductSchema) } },
    },
    async ({ res }) => res.json(await shop.products()),
  );
  route(
    {
      method: "post",
      path: "/coin-shop/products",
      summary: "Add a product",
      tags,
      access: "coin_shop.manage",
      body: UpsertCoinProductSchema,
      responses: { 201: { description: "Created", schema: CoinProductSchema } },
    },
    async ({ res, body }) => res.status(201).json(await shop.createProduct(body)),
  );
  route(
    {
      method: "put",
      path: "/coin-shop/products/:id",
      summary: "Change a product",
      tags,
      access: "coin_shop.manage",
      params: IdParamsSchema,
      body: UpsertCoinProductSchema,
      responses: { 200: { description: "Product", schema: CoinProductSchema } },
    },
    async ({ res, params, body }) => res.json(await shop.updateProduct(params.id, body)),
  );
  route(
    {
      method: "post",
      path: "/coin-shop/products/:id/archive",
      summary: "Archive or restore a product",
      tags,
      access: "coin_shop.manage",
      params: IdParamsSchema,
      body: ArchiveSchema,
      responses: { 200: { description: "Product", schema: CoinProductSchema } },
    },
    async ({ res, params, body }) => res.json(await shop.archiveProduct(params.id, body.archived)),
  );
  route(
    {
      method: "put",
      path: "/coin-shop/products/:id/image",
      summary: "Set the product picture (multipart file: PNG, JPEG or WebP, up to 2 MB)",
      tags,
      access: "coin_shop.manage",
      params: IdParamsSchema,
      responses: { 200: { description: "Product", schema: CoinProductSchema } },
    },
    async ({ req, res, auth, params }) => res.json(await shop.setImage(auth, params.id, await receiveImage(req, res))),
  );
  route(
    {
      method: "get",
      path: "/coin-shop/products/:id/image",
      summary: "The product picture",
      tags,
      access: IMAGE_VIEW,
      params: IdParamsSchema,
      responses: { 200: { description: "Image" } },
    },
    async ({ res, params }) => {
      const img = await shop.image(params.id);
      res.setHeader("Content-Type", img.mimeType);
      res.setHeader("Cache-Control", "private, max-age=3600");
      res.send(img.buffer);
    },
  );

  // ---- student
  route(
    {
      method: "get",
      path: "/coin-shop/catalog",
      summary: "What the student can buy",
      tags,
      access: "portal.student",
      responses: { 200: { description: "Catalogue", schema: CatalogSchema } },
    },
    async ({ res, auth }) => res.json(await shop.catalog(auth)),
  );
  route(
    {
      method: "post",
      path: "/coin-shop/orders",
      summary: "Order a product (the price is taken at once)",
      tags,
      access: "portal.student",
      body: CreateCoinOrderSchema,
      responses: { 200: { description: "Order (or the earlier result)", schema: OrderResult } },
    },
    async ({ res, auth, body }) => res.json(await shop.order(auth, body)),
  );
  route(
    {
      method: "get",
      path: "/coin-shop/my-orders",
      summary: "The student's orders",
      tags,
      access: "portal.student",
      query: CoinOrderQuerySchema,
      responses: { 200: { description: "Page", schema: CoinOrderPageSchema } },
    },
    async ({ res, auth, query }) => res.json(await shop.myOrders(auth, query)),
  );

  // ---- staff
  route(
    {
      method: "get",
      path: "/coin-shop/orders",
      summary: "Orders with counts per status",
      tags,
      access: "coin_orders.process",
      query: CoinOrderQuerySchema,
      responses: { 200: { description: "Page", schema: CoinOrderPageSchema } },
    },
    async ({ res, query }) => res.json(await shop.orders(query)),
  );
  const actions: [
    string,
    CoinOrderStatus,
    "coin_orders.process" | { anyOf: readonly ["coin_orders.process", "portal.student"] },
  ][] = [
    ["approve", "APPROVED", "coin_orders.process"],
    ["reject", "REJECTED", "coin_orders.process"],
    ["deliver", "DELIVERED", "coin_orders.process"],
    ["cancel", "CANCELLED", { anyOf: ["coin_orders.process", "portal.student"] }],
  ];
  for (const [action, to, access] of actions)
    route(
      {
        method: "post",
        path: `/coin-shop/orders/:id/${action}`,
        summary: `Order → ${to}`,
        tags,
        access,
        params: IdParamsSchema,
        body: CoinOrderActionSchema,
        responses: { 200: { description: "Order", schema: OrderResult } },
      },
      async ({ res, auth, params, body }) => res.json(await shop.transition(auth, params.id, to, body.note)),
    );
}
