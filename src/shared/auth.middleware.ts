import { Request, Response, NextFunction } from 'express';
import { verifyToken } from './token.utils';

// --- IS AUTH ---
export const isAuth = (req: Request, res: Response, next: NextFunction): void => {
  const token = req.headers.authorization?.replace('Bearer ', '');

  if (!token) {
    res.status(401).json({ error: 'Token requerido' });
    return;
  }

  try {
    req.user = verifyToken(token);
    next();
  } catch {
    res.status(401).json({ error: 'Token inválido o expirado' });
  }
};

// --- IS ADMIN ---
export const isAdmin = (req: Request, res: Response, next: NextFunction): void => {
  if (req.user?.rol !== 'admin') {
    res.status(403).json({ error: 'Solo administradores' });
    return;
  }
  next();
};
