import { Request, Response } from 'express';
import { query, queryOne, withTransaction } from '../config/database';
import { logger } from '../utils/logger';

export const getProducts = async (req: Request, res: Response): Promise<void> => {
  try {
    const { page = 1, limit = 50, search, category_id, status } = req.query;
    const businessId = req.user!.business_id;
    const offset = (Number(page) - 1) * Number(limit);

    let whereClause = 'WHERE p.business_id = $1';
    const params: any[] = [businessId];
    let paramIndex = 2;

    if (search) {
      whereClause += ` AND (p.name ILIKE $${paramIndex} OR p.sku ILIKE $${paramIndex} OR p.barcode = $${paramIndex + 1})`;
      params.push(`%${search}%`, search);
      paramIndex += 2;
    }

    if (category_id) {
      whereClause += ` AND p.category_id = $${paramIndex}`;
      params.push(category_id);
      paramIndex++;
    }

    if (status) {
      whereClause += ` AND p.status = $${paramIndex}`;
      params.push(status);
      paramIndex++;
    }

    const [countResult] = await query(
      `SELECT COUNT(*) as total FROM products p ${whereClause}`,
      params
    );

    const products = await query(
      `SELECT p.*, c.name as category_name, c.color as category_color
       FROM products p
       LEFT JOIN categories c ON p.category_id = c.id
       ${whereClause}
       ORDER BY p.name ASC
       LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      [...params, limit, offset]
    );

    res.json({
      success: true,
      data: products,
      meta: {
        page: Number(page),
        limit: Number(limit),
        total: Number(countResult.total),
        total_pages: Math.ceil(Number(countResult.total) / Number(limit)),
      },
    });
  } catch (error) {
    logger.error('Get products error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch products' });
  }
};

export const getProduct = async (req: Request, res: Response): Promise<void> => {
  try {
    const product = await queryOne(
      `SELECT p.*, c.name as category_name FROM products p
       LEFT JOIN categories c ON p.category_id = c.id
       WHERE p.id = $1 AND p.business_id = $2`,
      [req.params.id, req.user!.business_id]
    );

    if (!product) {
      res.status(404).json({ success: false, message: 'Product not found' });
      return;
    }

    res.json({ success: true, data: product });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch product' });
  }
};

export const createProduct = async (req: Request, res: Response): Promise<void> => {
  try {
    const businessId = req.user!.business_id;
    const {
      category_id, name, description, sku, barcode, price, cost_price,
      tax_rate, unit, image_url, stock_quantity, min_stock_level, track_inventory, tags
    } = req.body;

    const product = await queryOne(
      `INSERT INTO products (
        business_id, category_id, name, description, sku, barcode, price, cost_price,
        tax_rate, unit, image_url, stock_quantity, min_stock_level, track_inventory, tags
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
      RETURNING *`,
      [businessId, category_id, name, description, sku, barcode, price, cost_price || 0,
       tax_rate, unit || 'piece', image_url, stock_quantity || 0, min_stock_level || 0,
       track_inventory !== false, tags || []]
    );

    res.status(201).json({ success: true, data: product, message: 'Product created' });
  } catch (error: any) {
    if (error.code === '23505') {
      res.status(409).json({ success: false, message: 'SKU already exists' });
      return;
    }
    logger.error('Create product error:', error);
    res.status(500).json({ success: false, message: 'Failed to create product' });
  }
};

export const updateProduct = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const businessId = req.user!.business_id;
    const {
      category_id, name, description, sku, barcode, price, cost_price,
      tax_rate, unit, image_url, stock_quantity, min_stock_level, track_inventory, status, tags
    } = req.body;

    const product = await queryOne(
      `UPDATE products SET
        category_id=$1, name=$2, description=$3, sku=$4, barcode=$5, price=$6,
        cost_price=$7, tax_rate=$8, unit=$9, image_url=$10, stock_quantity=$11,
        min_stock_level=$12, track_inventory=$13, status=$14, tags=$15, updated_at=NOW()
       WHERE id=$16 AND business_id=$17 RETURNING *`,
      [category_id, name, description, sku, barcode, price, cost_price,
       tax_rate, unit, image_url, stock_quantity, min_stock_level, track_inventory,
       status, tags, id, businessId]
    );

    if (!product) {
      res.status(404).json({ success: false, message: 'Product not found' });
      return;
    }

    res.json({ success: true, data: product, message: 'Product updated' });
  } catch (error) {
    logger.error('Update product error:', error);
    res.status(500).json({ success: false, message: 'Failed to update product' });
  }
};

export const deleteProduct = async (req: Request, res: Response): Promise<void> => {
  try {
    const result = await queryOne(
      `UPDATE products SET status = 'discontinued', updated_at = NOW()
       WHERE id = $1 AND business_id = $2 RETURNING id`,
      [req.params.id, req.user!.business_id]
    );

    if (!result) {
      res.status(404).json({ success: false, message: 'Product not found' });
      return;
    }

    res.json({ success: true, message: 'Product deleted' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to delete product' });
  }
};

export const getCategories = async (req: Request, res: Response): Promise<void> => {
  try {
    const categories = await query(
      `SELECT c.*, COUNT(p.id) as product_count
       FROM categories c
       LEFT JOIN products p ON c.id = p.category_id AND p.status = 'active'
       WHERE c.business_id = $1 AND c.is_active = true
       GROUP BY c.id
       ORDER BY c.sort_order, c.name`,
      [req.user!.business_id]
    );

    res.json({ success: true, data: categories });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch categories' });
  }
};

export const createCategory = async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, description, color, icon, parent_id } = req.body;
    const category = await queryOne(
      `INSERT INTO categories (business_id, name, description, color, icon, parent_id)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [req.user!.business_id, name, description, color || '#6366f1', icon, parent_id]
    );

    res.status(201).json({ success: true, data: category });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to create category' });
  }
};
