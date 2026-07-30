"use strict";
// src/config/db.js
// Importamos mongoose para conectarnos a la base de datos MongoDB
const mongoose = require('mongoose');
// Funcion para comprobar y resolver la URL de la base de datos
const resolverDbUrl = async () => {
    const direccionUrl = process.env.DB_URL;
    if (!direccionUrl) {
        throw new Error('DB_URL no esta definida en las variables de entorno');
    }
    const user = process.env.DATABASE_USER;
    const pass = process.env.DATABASE_PASS;
    return direccionUrl
        .replace('$DATABASE_USER', encodeURIComponent(user || ''))
        .replace('$DATABASE_PASS', encodeURIComponent(pass || ''));
};
// Conexion a la base de datos MongoDB usando mongoose (cacheada entre invocaciones serverless)
let conexionPromise = null;
const conectarDB = async () => {
    if (mongoose.connection.readyState === 1)
        return mongoose.connection;
    if (!conexionPromise) {
        const direccionUrl = await resolverDbUrl();
        conexionPromise = mongoose.connect(direccionUrl)
            .then((conexion) => {
            console.log('🎉🎉🥳🎉🎉 MongoDB connected 🎉🎉🥳🎉🎉');
            return conexion;
        })
            .catch((error) => {
            console.error('🍑🍆 MongoDB connection error:', error);
            conexionPromise = null;
            throw error;
        });
    }
    return conexionPromise;
};
module.exports = conectarDB;
