import { Request, Response } from 'express';
import { query, queryOne, withTransaction } from '../config/database';
import { AuthRequest } from '../middleware/auth';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

export const getUsers = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { page = 1, limit = 20, search } = req.query;
    const businessId = req.user!.businessId;
    const offset = (Number(page) - 1) * Number(limit);

    let where = 'WHERE business_id = $1';
    const params: any[] = [businessId];

    if (search) {
      where += ` AND (name ILIKE $2 OR email ILIKE $2 OR phone ILIKE $2)`;
      params.push(`%${search}%`);
    }

    const [countResult] = await query(`SELECT COUNT(*) as total FROM users ${where}`, params);
    const users = await query(
      `SELECT * FROM users ${where} ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset]
    );

    res.json({
      success: true,
      data: users,
      meta: { page: Number(page), limit: Number(limit), total: Number(countResult.total) },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch customers' });
  }
};

export const createUser = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { businessName, email, password, phone, name, userType } = req.body;
    const hash = await bcrypt.hash(password, 12);
    const users = await queryOne(
      `INSERT INTO users (business_id, name, email, password_hash, role)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [req.user!.businessId, name, email,hash,userType]
    );

    res.status(201).json({ success: true, data: users });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to create customer' });
  }
};



