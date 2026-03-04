// @jowork/core/gateway/routes/users — User management REST API
//
// Routes:
//   GET    /api/users/me       — get current authenticated user profile
//   GET    /api/users          — list all users (admin/owner only)
//   POST   /api/users          — create a new user (admin/owner only)
//   PATCH  /api/users/:id      — update user role/name (admin/owner only)
//   DELETE /api/users/:id      — delete user (owner only; cannot delete self)

import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth.js';
import { signToken } from '../../auth/index.js';
import { getDb } from '../../datamap/index.js';
import { generateId, nowISO } from '../../utils/index.js';
import type { User, Role } from '../../types.js';

interface UserRow {
  id: string;
  name: string;
  email: string;
  role: string;
  created_at: string;
}

function rowToUser(row: UserRow): User {
  return {
    id:        row.id,
    name:      row.name,
    email:     row.email,
    role:      row.role as Role,
    createdAt: row.created_at,
  };
}

const VALID_ROLES: Role[] = ['owner', 'admin', 'member', 'guest'];

export function usersRouter(): Router {
  const router = Router();

  // Get the currently authenticated user's profile
  router.get('/api/users/me', authenticate, (req, res, next) => {
    try {
      const db  = getDb();
      const row = db.prepare(`SELECT * FROM users WHERE id = ?`).get(req.auth!.userId) as UserRow | undefined;
      if (!row) { res.status(404).json({ error: 'NOT_FOUND' }); return; }
      res.json(rowToUser(row));
    } catch (err) { next(err); }
  });

  // List all users (admin+ only)
  router.get('/api/users', authenticate, requireRole('admin'), (req, res, next) => {
    try {
      const db   = getDb();
      const rows = db.prepare(`SELECT * FROM users ORDER BY created_at DESC`).all() as UserRow[];
      res.json(rows.map(rowToUser));
    } catch (err) { next(err); }
  });

  // Create a new user (admin+ only); returns the user + a sign-in token
  router.post('/api/users', authenticate, requireRole('admin'), (req, res, next) => {
    try {
      const db = getDb();
      const { name, email, role } =
        req.body as { name?: string; email?: string; role?: Role };

      if (!name || typeof name !== 'string') {
        res.status(400).json({ error: 'name is required' });
        return;
      }
      if (!email || typeof email !== 'string') {
        res.status(400).json({ error: 'email is required' });
        return;
      }
      const userRole: Role = VALID_ROLES.includes(role as Role) ? (role as Role) : 'member';

      // Owners can only be created by the initial setup — prevent escalation
      if (userRole === 'owner' && req.auth!.role !== 'owner') {
        res.status(403).json({ error: 'Only an existing owner can create another owner' });
        return;
      }

      const user: User = {
        id:        generateId(),
        name,
        email,
        role:      userRole,
        createdAt: nowISO(),
      };

      db.prepare(
        `INSERT INTO users (id, name, email, role, created_at) VALUES (?, ?, ?, ?, ?)`,
      ).run(user.id, user.name, user.email, user.role, user.createdAt);

      // Generate a token so the new user can start a session
      const token = signToken(user.id, user.role);
      res.status(201).json({ user, token });
    } catch (err) { next(err); }
  });

  // Update user role or name (admin+ only)
  router.patch('/api/users/:id', authenticate, requireRole('admin'), (req, res, next) => {
    try {
      const db  = getDb();
      const id  = String(req.params['id']);
      const row = db.prepare(`SELECT * FROM users WHERE id = ?`).get(id) as UserRow | undefined;

      if (!row) { res.status(404).json({ error: 'NOT_FOUND' }); return; }

      const { name, role } = req.body as { name?: string; role?: Role };
      const newName = name ?? row.name;
      const newRole: Role = VALID_ROLES.includes(role as Role) ? (role as Role) : (row.role as Role);

      // Prevent non-owners from promoting to owner
      if (newRole === 'owner' && req.auth!.role !== 'owner') {
        res.status(403).json({ error: 'Only an owner can assign the owner role' });
        return;
      }

      db.prepare(`UPDATE users SET name = ?, role = ? WHERE id = ?`).run(newName, newRole, id);
      res.json({ id, name: newName, role: newRole });
    } catch (err) { next(err); }
  });

  // Delete user (owner only; cannot delete self)
  router.delete('/api/users/:id', authenticate, requireRole('owner'), (req, res, next) => {
    try {
      const db = getDb();
      const id = String(req.params['id']);

      if (id === req.auth!.userId) {
        res.status(400).json({ error: 'Cannot delete your own account' });
        return;
      }

      const row = db.prepare(`SELECT id FROM users WHERE id = ?`).get(id) as { id: string } | undefined;
      if (!row) { res.status(404).json({ error: 'NOT_FOUND' }); return; }

      db.prepare(`DELETE FROM users WHERE id = ?`).run(id);
      res.status(204).end();
    } catch (err) { next(err); }
  });

  return router;
}
