export type OrderStatus = "Pending" | "Delivered";

export type OrderStatusUpdateEvent = {
  type: "ORDER_STATUS_UPDATE";
  order_id: string;
  customer_phone: string;
  status: OrderStatus;
  product_name: string;
  timestamp: string;
};

export type NewProductCreatedEvent = {
  type: "NEW_PRODUCT_CREATED";
  product_id: string;
  name: string;
  price: number;
  category: string;
  timestamp: string;
};

export const botSync = {
  ORDER_STATUS_UPDATE(input: {
    order_id: string | number;
    customer_phone: string | null;
    status: string | null;
    product_name: string | null;
  }): OrderStatusUpdateEvent {
    const status =
      input.status === "Delivered" || input.status === "Pending"
        ? input.status
        : "Pending";

    return {
      type: "ORDER_STATUS_UPDATE",
      order_id: String(input.order_id),
      customer_phone: input.customer_phone ?? "",
      status,
      product_name: input.product_name ?? "",
      timestamp: new Date().toISOString(),
    };
  },

  NEW_PRODUCT_CREATED(input: {
    product_id: string | number;
    name: string | null;
    price: number | null;
    category: string | null;
  }): NewProductCreatedEvent {
    return {
      type: "NEW_PRODUCT_CREATED",
      product_id: String(input.product_id),
      name: input.name ?? "",
      price: Number(input.price ?? 0),
      category: input.category ?? "",
      timestamp: new Date().toISOString(),
    };
  },
};

