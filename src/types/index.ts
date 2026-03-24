export type UserRole = 'admin' | 'manager' | 'cashier' | 'viewer';
export type PaymentMethod = 'mpesa' | 'credit_card' | 'debit_card' | 'cash' | 'bank_transfer' | 'voucher' | 'split';
export type TransactionStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'refunded' | 'cancelled' | 'partial_refund';
export type ProductStatus = 'active' | 'inactive' | 'out_of_stock' | 'discontinued';

export interface Business {
  id: string;
  name: string;
  email: string;
  phone?: string;
  address?: string;
  city?: string;
  country: string;
  logo_url?: string;
  currency: string;
  tax_rate: number;
  tax_name: string;
  receipt_footer?: string;
  mpesa_shortcode?: string;
  stripe_account_id?: string;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface User {
  id: string;
  business_id: string;
  email: string;
  password_hash: string;
  first_name: string;
  last_name: string;
  phone?: string;
  role: UserRole;
  avatar_url?: string;
  is_active: boolean;
  last_login?: Date;
  created_at: Date;
  updated_at: Date;
}

export interface Category {
  id: string;
  business_id: string;
  name: string;
  description?: string;
  color: string;
  icon?: string;
  parent_id?: string;
  sort_order: number;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface Product {
  id: string;
  business_id: string;
  category_id?: string;
  name: string;
  description?: string;
  sku?: string;
  barcode?: string;
  price: number;
  cost_price: number;
  tax_rate?: number;
  unit: string;
  image_url?: string;
  stock_quantity: number;
  min_stock_level: number;
  track_inventory: boolean;
  status: ProductStatus;
  tags?: string[];
  metadata?: Record<string, any>;
  category_name?: string;
  created_at: Date;
  updated_at: Date;
}

export interface Customer {
  id: string;
  business_id: string;
  first_name: string;
  last_name?: string;
  email?: string;
  phone?: string;
  address?: string;
  city?: string;
  loyalty_points: number;
  total_spent: number;
  visit_count: number;
  notes?: string;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface OrderItem {
  id: string;
  order_id: string;
  product_id?: string;
  product_name: string;
  quantity: number;
  unit_price: number;
  discount_amount: number;
  tax_amount: number;
  total_amount: number;
  notes?: string;
  metadata?: Record<string, any>;
  created_at: Date;
}

export interface Order {
  id: string;
  business_id: string;
  order_number: string;
  customer_id?: string;
  cashier_id: string;
  subtotal: number;
  tax_amount: number;
  discount_amount: number;
  tip_amount: number;
  total_amount: number;
  status: TransactionStatus;
  payment_method?: PaymentMethod;
  notes?: string;
  table_number?: string;
  receipt_sent: boolean;
  metadata?: Record<string, any>;
  items?: OrderItem[];
  customer?: Customer;
  cashier?: User;
  payments?: Payment[];
  created_at: Date;
  updated_at: Date;
}

export interface Payment {
  id: string;
  business_id: string;
  order_id?: string;
  payment_method: PaymentMethod;
  amount: number;
  currency: string;
  status: TransactionStatus;
  reference_number?: string;
  provider_transaction_id?: string;
  provider_response?: Record<string, any>;
  mpesa_phone?: string;
  card_last_four?: string;
  card_brand?: string;
  checkout_request_id?: string;
  merchant_request_id?: string;
  stripe_payment_intent_id?: string;
  processed_at?: Date;
  failed_reason?: string;
  metadata?: Record<string, any>;
  created_at: Date;
  updated_at: Date;
}

export interface AuthenticatedRequest extends Express.Request {
  user?: {
    id: string;
    business_id: string;
    role: UserRole;
    email: string;
  };
}

export interface PaginationParams {
  page?: number;
  limit?: number;
  search?: string;
  sort_by?: string;
  sort_order?: 'ASC' | 'DESC';
}

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  message?: string;
  error?: string;
  meta?: {
    page?: number;
    limit?: number;
    total?: number;
    total_pages?: number;
  };
}

export interface DashboardStats {
  today_sales: number;
  today_orders: number;
  today_customers: number;
  monthly_sales: number;
  monthly_orders: number;
  avg_order_value: number;
  top_products: Array<{ name: string; quantity: number; revenue: number }>;
  sales_by_payment: Array<{ method: string; amount: number; count: number }>;
  hourly_sales: Array<{ hour: number; amount: number; count: number }>;
  low_stock_products: Product[];
}
