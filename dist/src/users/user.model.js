import { Schema, model } from 'mongoose';
import bcrypt from 'bcryptjs';
// --- ENUMS ---
export var UserRole;
(function (UserRole) {
    UserRole["USER"] = "user";
    UserRole["ADMIN"] = "admin";
    UserRole["PREMIUM"] = "premium";
})(UserRole || (UserRole = {}));
export var UserStatus;
(function (UserStatus) {
    UserStatus["PENDING"] = "pendiente";
    UserStatus["ACTIVE"] = "activo";
    UserStatus["BANNED"] = "baneado";
})(UserStatus || (UserStatus = {}));
export var CustomerOrigin;
(function (CustomerOrigin) {
    CustomerOrigin["REGULAR"] = "regular";
    CustomerOrigin["ATHLETE"] = "athlete";
    CustomerOrigin["ADMIN_CREATED"] = "admin_created";
})(CustomerOrigin || (CustomerOrigin = {}));
export var MembershipStatus;
(function (MembershipStatus) {
    MembershipStatus["INACTIVE"] = "inactive";
    MembershipStatus["ACTIVE"] = "active";
    MembershipStatus["PENDING"] = "pending";
    MembershipStatus["EXPIRED"] = "expired";
})(MembershipStatus || (MembershipStatus = {}));
export var MembershipPaymentStatus;
(function (MembershipPaymentStatus) {
    MembershipPaymentStatus["PENDING"] = "pending";
    MembershipPaymentStatus["PAID"] = "paid";
    MembershipPaymentStatus["FAILED"] = "failed";
    MembershipPaymentStatus["CANCELLED"] = "cancelled";
})(MembershipPaymentStatus || (MembershipPaymentStatus = {}));
// --- SUBESQUEMAS ---
const DireccionEnvioSchema = new Schema({
    calle: { type: String, required: true, trim: true },
    ciudad: { type: String, required: true, trim: true },
    provincia: { type: String, required: true, trim: true },
    codigoPostal: { type: String, required: true, trim: true },
    pais: { type: String, required: true, trim: true },
    esPredeterminada: { type: Boolean, default: false },
}, { _id: true }); // _id: true para poder actualizar o borrar una dirección concreta
const UserProfileSchema = new Schema({
    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, required: true, trim: true },
    phone: { type: String, trim: true },
    avatarUrl: { type: String, default: 'https://placehold.co/150' },
    addresses: [DireccionEnvioSchema],
}, { _id: false });
const UserCustomerSchema = new Schema({
    isCustomer: { type: Boolean, default: false },
    origin: {
        type: String,
        enum: Object.values(CustomerOrigin),
        default: CustomerOrigin.REGULAR,
    },
    since: { type: Date },
}, { _id: false });
const UserSportsProfileSchema = new Schema({
    isAthlete: { type: Boolean, default: false },
    isFederated: { type: Boolean, default: false },
    licenseNumber: {
        type: String,
        trim: true,
        validate: {
            validator(value) {
                return !this.isFederated || Boolean(value?.trim());
            },
            message: 'El número de licencia es obligatorio para deportistas federados',
        },
    },
    federationName: { type: String, trim: true },
    clubName: { type: String, trim: true },
}, { _id: false });
const UserMembershipSchema = new Schema({
    status: {
        type: String,
        enum: Object.values(MembershipStatus),
        default: MembershipStatus.INACTIVE,
    },
    monthlyFee: { type: Number, min: 0 },
    currency: { type: String, default: 'EUR', uppercase: true, trim: true },
    startDate: { type: Date },
    nextDueDate: { type: Date },
}, { _id: false });
const UserMembershipPaymentSchema = new Schema({
    period: {
        type: String,
        required: true,
        trim: true,
        match: [/^\d{4}-(0[1-9]|1[0-2])$/, 'El período debe tener formato YYYY-MM'],
    },
    amount: { type: Number, required: true, min: 0 },
    currency: { type: String, default: 'EUR', uppercase: true, trim: true },
    status: {
        type: String,
        enum: Object.values(MembershipPaymentStatus),
        default: MembershipPaymentStatus.PENDING,
    },
    dueDate: { type: Date, required: true },
    paidAt: { type: Date },
    paymentMethod: { type: String, trim: true },
    notes: { type: String, trim: true },
}, { _id: true });
// --- ESQUEMA PRINCIPAL ---
const userSchema = new Schema({
    username: {
        type: String,
        required: [true, 'El nombre de usuario es obligatorio'],
        unique: true,
        trim: true,
        lowercase: true,
        minlength: [3, 'El username debe tener al menos 3 caracteres'],
    },
    email: {
        type: String,
        required: [true, 'El correo es obligatorio'],
        unique: true,
        trim: true,
        lowercase: true,
        match: [/^\S+@\S+\.\S+$/, 'Introduce un correo válido'],
    },
    password: {
        type: String,
        required: [true, 'La contraseña es obligatoria'],
        minlength: [6, 'La contraseña debe tener al menos 6 caracteres'],
    },
    role: { type: String, enum: Object.values(UserRole), default: UserRole.USER },
    status: { type: String, enum: Object.values(UserStatus), default: UserStatus.PENDING },
    profile: { type: UserProfileSchema, required: true },
    customer: {
        type: UserCustomerSchema,
        default: () => ({
            isCustomer: false,
            origin: CustomerOrigin.REGULAR,
        }),
    },
    sportsProfile: {
        type: UserSportsProfileSchema,
        default: undefined,
    },
    membership: {
        type: UserMembershipSchema,
        default: () => ({
            status: MembershipStatus.INACTIVE,
            currency: 'EUR',
        }),
    },
    membershipPayments: {
        type: [UserMembershipPaymentSchema],
        default: [],
    },
    metadata: {
        lastLogin: { type: Date },
        emailVerified: { type: Boolean, default: false },
        resetPasswordToken: { type: String, select: false },
        resetPasswordExpires: { type: Date, select: false },
    },
}, { timestamps: true, versionKey: false });
// --- HOOKS ---
userSchema.pre('save', async function () {
    if (!this.isModified('password') || !this.password)
        return;
    this.password = await bcrypt.hash(this.password, 10);
});
userSchema.set('toJSON', {
    transform: (_, ret) => {
        delete ret.password;
        return ret;
    },
});
// --- MODELO ---
export const User = model('User', userSchema);
