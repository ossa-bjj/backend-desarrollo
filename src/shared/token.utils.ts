import jwt from 'jsonwebtoken';

export interface TokenPayload {
  id:       string;
  username: string;
  rol:      string;
}

declare global {
  namespace Express {
    interface Request {
      user?: TokenPayload;
    }
  }
}

export const generateToken = (payload: TokenPayload): string =>
  jwt.sign(payload, process.env.JWT_SECRET!, { expiresIn: '8h' });


export const verifyToken = (token: string): TokenPayload =>
  jwt.verify(token, process.env.JWT_SECRET!) as TokenPayload;
