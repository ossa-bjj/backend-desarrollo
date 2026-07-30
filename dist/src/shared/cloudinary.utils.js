import { v2 as cloudinary } from 'cloudinary';
// --- Eliminar Imagen ---
export const deleteImgCloudinary = async (publicID) => {
    if (!publicID)
        return;
    try {
        await cloudinary.uploader.destroy(publicID);
        console.log("Imagen eliminada de Cloudinary:", publicID);
    }
    catch (error) {
        console.error("Error al borrar en Cloudinary:", error);
    }
};
// --- Subir Imagen ---
export const createImgBook = async (filePath) => {
    try {
        const result = await cloudinary.uploader.upload(filePath, {
            folder: "libreria", // Carpeta en Cloudinary
            allowedFormats: ["jpg", "png", "jpeg", "webp"],
        });
        return {
            imgUrl: result.secure_url,
            imgId: result.public_id,
        };
    }
    catch (error) {
        console.error("Error al subir imagen a Cloudinary:", error);
        throw error;
    }
};
