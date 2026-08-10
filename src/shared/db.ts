import mongoose from 'mongoose';

const resolveDbUrl = (): string => {
  const url = process.env.DB_URL;
  if (!url) throw new Error('DB_URL no esta definida en las variables de entorno');

  const user = process.env.DATABASE_USER;
  const pass = process.env.DATABASE_PASS;

  return url
    .replace('$DATABASE_USER', encodeURIComponent(user || ''))
    .replace('$DATABASE_PASS', encodeURIComponent(pass || ''));
};

let connectionPromise: Promise<typeof mongoose> | null = null;

const connectDB = async (): Promise<typeof mongoose> => {
  if (mongoose.connection.readyState === 1) return mongoose;

  if (!connectionPromise) {
    const url = resolveDbUrl();
    connectionPromise = mongoose.connect(url)
      .then((conn) => {
        console.log('MongoDB connected');
        return conn;
      })
      .catch((error) => {
        console.error('MongoDB connection error:', error);
        connectionPromise = null;
        throw error;
      });
  }

  return connectionPromise;
};

export default connectDB;
export { resolveDbUrl };
