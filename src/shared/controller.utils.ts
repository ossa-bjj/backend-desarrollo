import { Request, Response } from 'express';
import { UserRole } from '../users/user.model';

export const sendServerError = (res: Response, message: string, error: unknown): void => {
  res.status(500).json({ error: message, detail: (error as Error).message });
};

export const isOwnerOrAdmin = (req: Request, userId: string | string[]): boolean =>
  typeof userId === 'string' && (req.user?.id === userId || req.user?.rol === UserRole.ADMIN);
