export {};
const cloudinary = require("cloudinary").v2;

// --- Eliminar Imagen ---
const deleteImgCloudinary = async (publicID: string) => {

    if (!publicID) return;
    try {
        await cloudinary.uploader.destroy(publicID);
        console.log("Imagen eliminada de Cloudinary:", publicID);
    } catch (error) {
        console.error("Error al borrar en Cloudinary:", error);
    }
};

// --- Subir Imagen ---
const createImgBook = async (filePath: string) => {
    try {
        const result = await cloudinary.uploader.upload(filePath, {
            folder: "libreria", // Carpeta en Cloudinary
            allowedFormats: ["jpg", "png", "jpeg", "webp"],
        });
        return {
            imgUrl: result.secure_url,
            imgId: result.public_id,
        };
    } catch (error) {
        console.error("Error al subir imagen a Cloudinary:", error);
        throw error;
    }
};

// Exportamos las funciones
module.exports = {
    deleteImgCloudinary,
    createImgBook,
};