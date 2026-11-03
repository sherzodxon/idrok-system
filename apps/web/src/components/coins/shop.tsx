"use client";

// Coin Shop: staff manage products and process orders (PENDING → APPROVED → DELIVERED, or REJECTED); students browse
// the catalogue, order (the price is taken at once) and cancel their own pending orders.
import { useQuery } from "@tanstack/react-query";
import { Gift, ImagePlus, Pencil, Plus } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import type { CatalogDto, CatalogItemDto, CoinOrderDto, CoinOrderStatus, CoinProductDto } from "@idrok/shared";
import { useApi } from "@/components/providers/app-providers";
import { AuthImage } from "@/components/tests/common";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { DataTable, Pagination } from "@/components/ui/data-table";
import { Field, Input } from "@/components/ui/field";
import { FormDrawer } from "@/components/ui/form-drawer";
import { ConfirmDialog, Modal } from "@/components/ui/modal";
import { EmptyState, QueryBoundary } from "@/components/ui/states";
import { PageHeader, Tabs } from "@/components/ui/toolbar";
import { can, useMe } from "@/lib/use-me";
import { useSave } from "@/lib/use-save";
import { formatDateTime, newKey } from "./common";

const ORDER_TONE: Record<CoinOrderStatus, "neutral" | "primary" | "success" | "warning" | "danger"> = {
  PENDING: "warning",
  APPROVED: "primary",
  DELIVERED: "success",
  REJECTED: "danger",
  CANCELLED: "neutral",
};

export function OrderStatusBadge({ status }: { status: CoinOrderStatus }) {
  const t = useTranslations("coins");
  return <Badge tone={ORDER_TONE[status]}>{t(`orderStatus.${status}`)}</Badge>;
}

function ProductImage({ productId, hasImage, name }: { productId: string; hasImage: boolean; name: string }) {
  return (
    <div className="flex aspect-square w-full items-center justify-center overflow-hidden rounded-control bg-surface-muted">
      {hasImage ? (
        <AuthImage path={`/coin-shop/products/${productId}/image`} alt={name} className="size-full object-cover" />
      ) : (
        <Gift className="size-10 text-muted" aria-hidden />
      )}
    </div>
  );
}

type OrderPage = {
  items: CoinOrderDto[];
  total: number;
  page: number;
  pageSize: number;
  statusCounts: Record<string, number>;
};

// ---------------------------------------------------------------- staff

export function AdminShopPage() {
  const t = useTranslations("coins");
  const me = useMe();
  const tabs = (
    [
      ["orders", "coin_orders.process"],
      ["products", "coin_shop.manage"],
    ] as const
  )
    .filter(([, p]) => can(me.data, p))
    .map(([value]) => ({ value: value as "orders" | "products", label: t(`shop.tabs.${value}`) }));
  const [tab, setTab] = useState<"orders" | "products">("orders");
  const current = tabs.some((x) => x.value === tab) ? tab : (tabs[0]?.value ?? "orders");
  return (
    <>
      <PageHeader title={t("shop.title")} subtitle={t("shop.subtitle")} />
      <Tabs tabs={tabs} value={current} onChange={setTab} />
      {current === "orders" ? <Orders /> : <Products />}
    </>
  );
}

function Products() {
  const t = useTranslations("coins");
  const api = useApi();
  const products = useQuery({
    queryKey: ["coin-products"],
    queryFn: () => api.get<CoinProductDto[]>("/coin-shop/products"),
  });
  const [editing, setEditing] = useState<CoinProductDto | "new" | null>(null);
  const archive = useSave(
    (p: CoinProductDto) => api.post(`/coin-shop/products/${p.id}/archive`, { archived: !p.archived }),
    ["coin-products"],
  );
  return (
    <Card>
      <CardHeader
        title={t("shop.tabs.products")}
        action={
          <Button size="sm" onClick={() => setEditing("new")}>
            <Plus className="size-4" aria-hidden />
            {t("shop.addProduct")}
          </Button>
        }
      />
      <QueryBoundary
        query={products}
        isEmpty={(l) => l.length === 0}
        empty={<EmptyState text={t("shop.noProducts")} />}
      >
        {(list) => (
          <DataTable
            testId="coin-products"
            rows={list}
            columns={[
              {
                key: "name",
                header: t("shop.product"),
                primary: true,
                cell: (p) => (
                  <span className="flex items-center gap-3">
                    <span className="w-10 shrink-0">
                      <ProductImage productId={p.id} hasImage={p.hasImage} name={p.name} />
                    </span>
                    <span className={p.archived ? "text-muted line-through" : "font-medium"}>{p.name}</span>
                  </span>
                ),
              },
              { key: "price", header: t("shop.price"), cell: (p) => t("coinsN", { n: p.price }) },
              { key: "stock", header: t("shop.stock"), cell: (p) => p.stock },
              {
                key: "visible",
                header: t("shop.visibility"),
                cell: (p) =>
                  p.archived ? (
                    <Badge>{t("shop.archived")}</Badge>
                  ) : (
                    <Badge tone={p.isVisible ? "success" : "neutral"}>
                      {p.isVisible ? t("shop.visible") : t("shop.hidden")}
                    </Badge>
                  ),
              },
              {
                key: "actions",
                header: "",
                cell: (p) => (
                  <span className="flex gap-1">
                    <Button size="sm" variant="ghost" onClick={() => setEditing(p)} aria-label={t("edit")}>
                      <Pencil className="size-4" aria-hidden />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      loading={archive.isPending && archive.variables?.id === p.id}
                      onClick={() => archive.mutate(p)}
                    >
                      {p.archived ? t("shop.restore") : t("shop.archive")}
                    </Button>
                  </span>
                ),
              },
            ]}
          />
        )}
      </QueryBoundary>
      {editing && <ProductDrawer product={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </Card>
  );
}

function ProductDrawer({ product, onClose }: { product: CoinProductDto | null; onClose: () => void }) {
  const t = useTranslations("coins");
  const api = useApi();
  const [d, setD] = useState({
    name: product?.name ?? "",
    description: product?.description ?? "",
    price: String(product?.price ?? 10),
    stock: String(product?.stock ?? 1),
    isVisible: product?.isVisible ?? true,
  });
  const [file, setFile] = useState<File | null>(null);
  const set = (patch: Partial<typeof d>) => setD((x) => ({ ...x, ...patch }));
  const save = useSave(
    async () => {
      const body = {
        name: d.name,
        description: d.description || null,
        price: Number(d.price),
        stock: Number(d.stock),
        isVisible: d.isVisible,
      };
      const saved = product
        ? await api.put<CoinProductDto>(`/coin-shop/products/${product.id}`, body)
        : await api.post<CoinProductDto>("/coin-shop/products", body);
      if (file) {
        const form = new FormData();
        form.set("file", file);
        await api.put(`/coin-shop/products/${saved.id}/image`, form);
      }
    },
    ["coin-products", "image"],
    onClose,
  );
  return (
    <FormDrawer
      title={product ? t("shop.editProduct") : t("shop.addProduct")}
      formId="coin-product"
      busy={save.isPending}
      onClose={onClose}
    >
      <form
        id="coin-product"
        className="flex flex-col gap-4"
        onSubmit={(e: FormEvent) => (e.preventDefault(), save.mutate(undefined))}
      >
        <Field label={t("shop.product")}>
          {(id) => (
            <Input id={id} required maxLength={120} value={d.name} onChange={(e) => set({ name: e.target.value })} />
          )}
        </Field>
        <Field label={t("admin.description")}>
          {(id) => (
            <Input
              id={id}
              maxLength={1000}
              value={d.description}
              onChange={(e) => set({ description: e.target.value })}
            />
          )}
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("shop.price")}>
            {(id) => (
              <Input
                id={id}
                type="number"
                min={1}
                required
                value={d.price}
                onChange={(e) => set({ price: e.target.value })}
              />
            )}
          </Field>
          <Field label={t("shop.stock")}>
            {(id) => (
              <Input
                id={id}
                type="number"
                min={0}
                required
                value={d.stock}
                onChange={(e) => set({ stock: e.target.value })}
              />
            )}
          </Field>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-4 accent-primary"
            checked={d.isVisible}
            onChange={(e) => set({ isVisible: e.target.checked })}
          />
          {t("shop.visibleToStudents")}
        </label>
        <Field label={t("shop.image")} hint={t("shop.imageHint")}>
          {(id) => (
            <label
              htmlFor={id}
              className="flex cursor-pointer items-center gap-2 rounded-control border border-dashed border-border p-3 text-sm text-muted"
            >
              <ImagePlus className="size-4" aria-hidden />
              {file?.name ?? (product?.hasImage ? t("shop.replaceImage") : t("shop.chooseImage"))}
              <input
                id={id}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="sr-only"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </label>
          )}
        </Field>
      </form>
    </FormDrawer>
  );
}

const ORDER_STATUSES: CoinOrderStatus[] = ["PENDING", "APPROVED", "DELIVERED", "REJECTED", "CANCELLED"];

function Orders() {
  const t = useTranslations("coins");
  const api = useApi();
  const locale = useLocale();
  const [status, setStatus] = useState<CoinOrderStatus | "">("PENDING");
  const [page, setPage] = useState(1);
  const [rejecting, setRejecting] = useState<CoinOrderDto | null>(null);
  const orders = useQuery({
    queryKey: ["coin-orders", status, page],
    queryFn: () => api.get<OrderPage>(`/coin-shop/orders?page=${page}&pageSize=20${status ? `&status=${status}` : ""}`),
  });
  const act = useSave(
    ({ id, action }: { id: string; action: "approve" | "deliver" }) =>
      api.post(`/coin-shop/orders/${id}/${action}`, {}),
    ["coin-orders", "coin-overview"],
  );
  const counts = orders.data?.statusCounts ?? {};
  return (
    <Card>
      <div className="flex flex-wrap gap-2 px-5 pt-5" role="tablist" aria-label={t("shop.statusFilter")}>
        {(["", ...ORDER_STATUSES] as const).map((s) => (
          <Button
            key={s || "all"}
            size="sm"
            variant={status === s ? "primary" : "secondary"}
            role="tab"
            aria-selected={status === s}
            onClick={() => (setStatus(s), setPage(1))}
          >
            {s ? t(`orderStatus.${s}`) : t("shop.allOrders")}
            {s && counts[s] ? <span className="tabular ml-1 opacity-80">{counts[s]}</span> : null}
          </Button>
        ))}
      </div>
      <QueryBoundary
        query={orders}
        isEmpty={(p) => p.items.length === 0}
        empty={<EmptyState text={t("shop.noOrders")} />}
      >
        {(p) => (
          <>
            <DataTable
              testId="coin-orders"
              rows={p.items}
              columns={[
                {
                  key: "product",
                  header: t("shop.product"),
                  primary: true,
                  cell: (o) => (
                    <span className="flex flex-col">
                      <span className="font-medium">{o.productName}</span>
                      <span className="text-xs text-muted">
                        {[o.studentName, o.className].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                  ),
                },
                { key: "price", header: t("shop.price"), cell: (o) => t("coinsN", { n: o.price }) },
                { key: "status", header: t("admin.status"), cell: (o) => <OrderStatusBadge status={o.status} /> },
                { key: "when", header: t("when"), cell: (o) => formatDateTime(o.createdAt, locale) },
                {
                  key: "actions",
                  header: "",
                  cell: (o) => (
                    <span className="flex flex-wrap gap-1">
                      {o.status === "PENDING" && (
                        <Button
                          size="sm"
                          loading={act.isPending && act.variables?.id === o.id}
                          onClick={() => act.mutate({ id: o.id, action: "approve" })}
                        >
                          {t("shop.approve")}
                        </Button>
                      )}
                      {o.status === "APPROVED" && (
                        <Button
                          size="sm"
                          loading={act.isPending && act.variables?.id === o.id}
                          onClick={() => act.mutate({ id: o.id, action: "deliver" })}
                        >
                          {t("shop.deliver")}
                        </Button>
                      )}
                      {(o.status === "PENDING" || o.status === "APPROVED") && (
                        <Button size="sm" variant="ghost" onClick={() => setRejecting(o)}>
                          {o.status === "PENDING" ? t("shop.reject") : t("shop.cancelOrder")}
                        </Button>
                      )}
                    </span>
                  ),
                },
              ]}
            />
            <Pagination page={p.page} pageSize={p.pageSize} total={p.total} onPage={setPage} />
          </>
        )}
      </QueryBoundary>
      {rejecting && <RejectDialog order={rejecting} onClose={() => setRejecting(null)} />}
    </Card>
  );
}

function RejectDialog({ order, onClose }: { order: CoinOrderDto; onClose: () => void }) {
  const t = useTranslations("coins");
  const api = useApi();
  const [note, setNote] = useState("");
  const action = order.status === "PENDING" ? "reject" : "cancel";
  const save = useSave(
    () => api.post(`/coin-shop/orders/${order.id}/${action}`, note ? { note } : {}),
    ["coin-orders", "coin-overview"],
    onClose,
  );
  return (
    <Modal
      open
      onClose={onClose}
      title={action === "reject" ? t("shop.reject") : t("shop.cancelOrder")}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button variant="danger" loading={save.isPending} onClick={() => save.mutate(undefined)}>
            {t("confirm")}
          </Button>
        </>
      }
    >
      <p className="mb-3 text-sm text-muted">{t("shop.refundText", { n: order.price, student: order.studentName })}</p>
      <Field label={t("shop.note")}>
        {(id) => <Input id={id} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />}
      </Field>
    </Modal>
  );
}

// ---------------------------------------------------------------- student

export function StudentShop() {
  const t = useTranslations("coins");
  const api = useApi();
  const catalog = useQuery({ queryKey: ["coin-catalog"], queryFn: () => api.get<CatalogDto>("/coin-shop/catalog") });
  const [buying, setBuying] = useState<CatalogItemDto | null>(null);
  const order = useSave(
    (p: CatalogItemDto) => api.post("/coin-shop/orders", { productId: p.id, idempotencyKey: newKey() }),
    ["coin-catalog", "coin-my-orders", "coin-summary", "coin-transactions"],
    () => setBuying(null),
  );
  return (
    <QueryBoundary query={catalog}>
      {(c) => (
        <div className="flex flex-col gap-3">
          {c.blockedReason && (
            <Card className="p-4 text-sm text-warning" data-testid="shop-blocked">
              {t(`shop.blocked.${c.blockedReason}`)}
            </Card>
          )}
          {c.items.length === 0 ? (
            <EmptyState text={t("shop.emptyCatalog")} />
          ) : (
            <ul className="grid grid-cols-2 gap-3" data-testid="catalog">
              {c.items.map((p) => (
                <li key={p.id}>
                  <Card className="flex h-full flex-col gap-2 p-3">
                    <ProductImage productId={p.id} hasImage={p.hasImage} name={p.name} />
                    <p className="line-clamp-2 text-sm font-semibold">{p.name}</p>
                    {p.description && <p className="line-clamp-2 text-xs text-muted">{p.description}</p>}
                    <p className="tabular mt-auto text-sm font-bold text-primary-strong">
                      {t("coinsN", { n: p.price })}
                    </p>
                    <Button size="sm" disabled={!c.canOrder || !p.affordable} onClick={() => setBuying(p)}>
                      {p.stock === 0 ? t("shop.outOfStock") : p.affordable ? t("shop.buy") : t("shop.notEnough")}
                    </Button>
                  </Card>
                </li>
              ))}
            </ul>
          )}
          <ConfirmDialog
            open={!!buying}
            title={t("shop.confirmTitle")}
            text={
              buying
                ? t("shop.confirmText", { name: buying.name, n: buying.price, left: c.balance - buying.price })
                : ""
            }
            loading={order.isPending}
            onConfirm={() => buying && order.mutate(buying)}
            onCancel={() => setBuying(null)}
          />
        </div>
      )}
    </QueryBoundary>
  );
}

export function MyOrders() {
  const t = useTranslations("coins");
  const api = useApi();
  const locale = useLocale();
  const orders = useQuery({
    queryKey: ["coin-my-orders"],
    queryFn: () => api.get<OrderPage>("/coin-shop/my-orders?pageSize=50"),
  });
  const cancel = useSave(
    (id: string) => api.post(`/coin-shop/orders/${id}/cancel`, {}),
    ["coin-my-orders", "coin-catalog", "coin-summary", "coin-transactions"],
  );
  return (
    <QueryBoundary
      query={orders}
      isEmpty={(p) => p.items.length === 0}
      empty={<EmptyState text={t("shop.noMyOrders")} />}
    >
      {(p) => (
        <ul className="flex flex-col gap-2" data-testid="my-orders">
          {p.items.map((o) => (
            <li key={o.id}>
              <Card className="flex items-center justify-between gap-3 p-3">
                <div className="min-w-0">
                  <p className="truncate font-medium">{o.productName}</p>
                  <p className="text-xs text-muted">
                    {t("coinsN", { n: o.price })} · {formatDateTime(o.createdAt, locale)}
                  </p>
                  {o.note && <p className="text-xs text-muted">{o.note}</p>}
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <OrderStatusBadge status={o.status} />
                  {o.status === "PENDING" && (
                    <Button
                      size="sm"
                      variant="ghost"
                      loading={cancel.isPending && cancel.variables === o.id}
                      onClick={() => cancel.mutate(o.id)}
                    >
                      {t("shop.cancelOrder")}
                    </Button>
                  )}
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </QueryBoundary>
  );
}
