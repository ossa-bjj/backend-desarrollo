import jwt from 'jsonwebtoken';

export interface TokenPayload {
  id: string;
  username: string;
  rol: string;
}

declare global {
  // Ampliar los tipos de Express exige un namespace: es como lo declara
  // @types/express y no hay equivalente con sintaxis de modulos.
  // eslint-disable-next-line @typescript-eslint/no-namespace
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
