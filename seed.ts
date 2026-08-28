import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import mongoose from 'mongoose';
import {
  CustomerOrigin,
  MembershipPaymentStatus,
  MembershipStatus,
  User,
  UserRole,
  UserStatus,
} from './src/users/user.model';
import { ProductoModelo, Categoria } from './src/products/producto.model';
import { ServicioModelo, ModalidadServicio } from './src/services/servicio.model';
import { resolveDbUrl } from './src/shared/db';
import { uploadToR2 } from './src/shared/r2.utils';

// Key del objeto en R2. La sube seed() y se asigna en el remapeo previo a
// insertar: los literales de arriba nacen sin imagenes a proposito.
let IMG_DEFAULT = '';

//  USUARIOS

const usuarios = [
  {
    username: 'admin',
    email: 'admin@arturosalas.com',
    password: 'Admin1234!',
    role: UserRole.ADMIN,
    status: UserStatus.ACTIVE,
    profile: {
      firstName: 'Arturo',
      lastName: 'Salas',
      phone: '+34 600 000 001',
      avatarUrl: 'https://placehold.co/150',
      addresses: [
        {
          calle: 'Calle Mayor 1',
          ciudad: 'Madrid',
          provincia: 'Madrid',
          codigoPostal: '28001',
          pais: 'España',
          esPredeterminada: true,
        },
      ],
    },
    customer: {
      isCustomer: false,
      origin: CustomerOrigin.ADMIN_CREATED,
      since: new Date('2026-01-01'),
    },
    sportsProfile: {
      isAthlete: false,
      isFederated: false,
      federationName: 'No aplica',
      clubName: 'Arturo Salas Academy',
    },
    membership: {
      status: MembershipStatus.INACTIVE,
      monthlyFee: 0,
      currency: 'EUR',
      startDate: new Date('2026-01-01'),
      nextDueDate: new Date('2026-01-01'),
    },
    membershipPayments: [],
    metadata: {
      lastLogin: new Date('2026-06-01'),
      emailVerified: true,
    },
  },
  {
    username: 'cliente_regular',
    email: 'cliente.regular@example.com',
    password: 'Cliente1234!',
    role: UserRole.USER,
    status: UserStatus.ACTIVE,
    profile: {
      firstName: 'Carlos',
      lastName: 'Martínez',
      phone: '+34 600 000 002',
      avatarUrl: 'https://placehold.co/150',
      addresses: [
        {
          calle: 'Avenida Libertad 45',
          ciudad: 'Barcelona',
          provincia: 'Barcelona',
          codigoPostal: '08001',
          pais: 'España',
          esPredeterminada: true,
        },
      ],
    },
    customer: {
      isCustomer: true,
      origin: CustomerOrigin.REGULAR,
      since: new Date('2026-02-01'),
    },
    sportsProfile: {
      isAthlete: false,
      isFederated: false,
      federationName: 'No aplica',
      clubName: 'No aplica',
    },
    membership: {
      status: MembershipStatus.ACTIVE,
      monthlyFee: 45,
      currency: 'EUR',
      startDate: new Date('2026-02-01'),
      nextDueDate: new Date('2026-07-01'),
    },
    membershipPayments: [
      {
        period: '2026-05',
        amount: 45,
        currency: 'EUR',
        status: MembershipPaymentStatus.PAID,
        dueDate: new Date('2026-05-01'),
        paidAt: new Date('2026-05-02'),
        paymentMethod: 'tarjeta',
        notes: 'Cuota mensual abonada correctamente',
      },
      {
        period: '2026-06',
        amount: 45,
        currency: 'EUR',
        status: MembershipPaymentStatus.PAID,
        dueDate: new Date('2026-06-01'),
        paidAt: new Date('2026-06-01'),
        paymentMethod: 'efectivo',
        notes: 'Pago recibido en recepción',
      },
    ],
    metadata: {
      lastLogin: new Date('2026-06-10'),
      emailVerified: true,
    },
  },
  {
    username: 'deportista_no_federado',
    email: 'deportista.no.federado@example.com',
    password: 'Deportista1234!',
    role: UserRole.USER,
    status: UserStatus.ACTIVE,
    profile: {
      firstName: 'Lucía',
      lastName: 'Gómez',
      phone: '+34 600 000 003',
      avatarUrl: 'https://placehold.co/150',
      addresses: [
        {
          calle: 'Calle Tatami 12',
          ciudad: 'Valencia',
          provincia: 'Valencia',
          codigoPostal: '46001',
          pais: 'España',
          esPredeterminada: true,
        },
      ],
    },
    customer: {
      isCustomer: true,
      origin: CustomerOrigin.ATHLETE,
      since: new Date('2026-03-01'),
    },
    sportsProfile: {
      isAthlete: true,
      isFederated: false,
      federationName: 'No federado',
      clubName: 'Arturo Salas Academy',
    },
    membership: {
      status: MembershipStatus.PENDING,
      monthlyFee: 50,
      currency: 'EUR',
      startDate: new Date('2026-03-01'),
      nextDueDate: new Date('2026-07-01'),
    },
    membershipPayments: [
      {
        period: '2026-05',
        amount: 50,
        currency: 'EUR',
        status: MembershipPaymentStatus.PAID,
        dueDate: new Date('2026-05-01'),
        paidAt: new Date('2026-05-03'),
        paymentMethod: 'transferencia',
        notes: 'Cuota de deportista no federado',
      },
      {
        period: '2026-06',
        amount: 50,
        currency: 'EUR',
        status: MembershipPaymentStatus.PENDING,
        dueDate: new Date('2026-06-01'),
        paymentMethod: 'pendiente',
        notes: 'Pago pendiente de confirmación',
      },
    ],
    metadata: {
      lastLogin: new Date('2026-06-12'),
      emailVerified: true,
    },
  },
  {
    username: 'deportista_federado',
    email: 'deportista.federado@example.com',
    password: 'Federado1234!',
    role: UserRole.PREMIUM,
    status: UserStatus.ACTIVE,
    profile: {
      firstName: 'Miguel',
      lastName: 'Ruiz',
      phone: '+34 600 000 004',
      avatarUrl: 'https://placehold.co/150',
      addresses: [
        {
          calle: 'Paseo del Grappling 7',
          ciudad: 'Sevilla',
          provincia: 'Sevilla',
          codigoPostal: '41001',
          pais: 'España',
          esPredeterminada: true,
        },
      ],
    },
    customer: {
      isCustomer: true,
      origin: CustomerOrigin.ATHLETE,
      since: new Date('2026-01-15'),
    },
    sportsProfile: {
      isAthlete: true,
      isFederated: true,
      licenseNumber: 'BJJ-ESP-2026-0001',
      federationName: 'Federación Española de Jiu-Jitsu Brasileño',
      clubName: 'Arturo Salas Academy',
    },
    membership: {
      status: MembershipStatus.ACTIVE,
      monthlyFee: 60,
      currency: 'EUR',
      startDate: new Date('2026-01-15'),
      nextDueDate: new Date('2026-07-01'),
    },
    membershipPayments: [
      {
        period: '2026-05',
        amount: 60,
        currency: 'EUR',
        status: MembershipPaymentStatus.PAID,
        dueDate: new Date('2026-05-01'),
        paidAt: new Date('2026-05-01'),
        paymentMethod: 'tarjeta',
        notes: 'Cuota premium federado',
      },
      {
        period: '2026-06',
        amount: 60,
        currency: 'EUR',
        status: MembershipPaymentStatus.PAID,
        dueDate: new Date('2026-06-01'),
        paidAt: new Date('2026-06-02'),
        paymentMethod: 'domiciliación',
        notes: 'Pago domiciliado correctamente',
      },
    ],
    metadata: {
      lastLogin: new Date('2026-06-15'),
      emailVerified: true,
    },
  },
  {
    username: 'invitado',
    email: 'invitado@example.com',
    password: 'Invitado1234!',
    role: UserRole.USER,
    status: UserStatus.PENDING,
    profile: {
      firstName: 'Invitado',
      lastName: 'Demo',
      phone: '+34 600 000 005',
      avatarUrl: 'https://placehold.co/150',
      addresses: [],
    },
    customer: {
      isCustomer: false,
      origin: CustomerOrigin.REGULAR,
      since: new Date('2026-04-01'),
    },
    sportsProfile: {
      isAthlete: false,
      isFederated: false,
      federationName: 'No aplica',
      clubName: 'No aplica',
    },
    membership: {
      status: MembershipStatus.INACTIVE,
      monthlyFee: 0,
      currency: 'EUR',
      startDate: new Date('2026-04-01'),
      nextDueDate: new Date('2026-04-01'),
    },
    membershipPayments: [],
    metadata: {
      lastLogin: new Date('2026-04-01'),
      emailVerified: false,
    },
  },
];

// ─── PRODUCTOS ────────────────────────────────────────────────────────────────
// Convención de códigos:
//   1XXX → ROPA_ENTRENAMIENTO
//   2XXX → PROTECCIONES
//   3XXX → ROPA_CALLE
//   4XXX → ACCESORIOS
//   5XXX → CALZADO

const productos = [
  // ── PROTECCIONES (2XXX) ──────────────────────────────────────────────────
  {
    codigoArticulo: 2001,
    name: 'Guantes de boxeo Venum Contender',
    price: 49.99,
    description: 'Guantes de boxeo profesionales con relleno de espuma multicapa. Ideales para entrenamiento y sparring.',
    stock: 25,
    category: Categoria.PROTECCIONES,
    subcategoria: 'Guantes de boxeo',
    marca: 'Venum',
    imagenes: [] as string[],
    tags: ['destacado', 'boxeo', 'MMA'],
  },
  {
    codigoArticulo: 2004,
    name: 'Casco de boxeo RDX Pro',
    price: 59.99,
    description: 'Casco con protección completa: frente, mejillas y mentón. Certificado para sparring.',
    stock: 20,
    category: Categoria.PROTECCIONES,
    subcategoria: 'Cascos',
    marca: 'RDX',
    imagenes: [] as string[],
    tags: ['boxeo', 'sparring', 'kickboxing'],
  },
  {
    codigoArticulo: 2007,
    name: 'Espinilleras Muay Thai Fairtex SP5',
    price: 54.99,
    description: 'Espinilleras de cuero sintético con relleno de espuma de alta densidad. Talla única ajustable.',
    stock: 18,
    category: Categoria.PROTECCIONES,
    subcategoria: 'Espinilleras',
    marca: 'Fairtex',
    imagenes: [] as string[],
    tags: ['muay thai', 'kickboxing'],
  },
  {
    codigoArticulo: 2009,
    name: 'Vendas de boxeo Fighter 4.5m',
    price: 9.99,
    description: 'Vendas elásticas de 4.5 metros para protección de muñecas y nudillos. Pack de 2 unidades.',
    stock: 100,
    category: Categoria.PROTECCIONES,
    subcategoria: 'Vendas',
    marca: 'Fighter',
    imagenes: [] as string[],
    tags: ['boxeo', 'MMA', 'kickboxing'],
  },
  {
    codigoArticulo: 2010,
    name: 'Bucal doble dentadura Shock Doctor',
    price: 14.99,
    description: 'Bucal de doble capa con gel de ajuste térmico. Protege dientes, encías y mandíbula en sparring.',
    stock: 60,
    category: Categoria.PROTECCIONES,
    subcategoria: 'Bucales',
    marca: 'Shock Doctor',
    imagenes: [] as string[],
    tags: ['boxeo', 'MMA', 'BJJ', 'sparring'],
  },
  {
    codigoArticulo: 2011,
    name: 'Rodilleras de compresión Rehband',
    price: 29.99,
    description: 'Rodilleras de neopreno 5mm con soporte rotuliano. Previenen lesiones en tatami y jaula.',
    stock: 35,
    category: Categoria.PROTECCIONES,
    subcategoria: 'Rodilleras',
    marca: 'Rehband',
    imagenes: [] as string[],
    tags: ['BJJ', 'grappling', 'MMA'],
  },
  {
    codigoArticulo: 2012,
    name: 'Guantillas de grappling RDX F12',
    price: 24.99,
    description: 'Guantillas abiertas para grappling y MMA. Cuero sintético reforzado en zona de impacto.',
    stock: 30,
    category: Categoria.PROTECCIONES,
    subcategoria: 'Guantillas',
    marca: 'RDX',
    imagenes: [] as string[],
    tags: ['MMA', 'grappling', 'BJJ'],
  },

  // ── ROPA DE ENTRENAMIENTO (1XXX) ─────────────────────────────────────────
  {
    codigoArticulo: 1002,
    name: 'Rashguard de compresión BJJ manga larga',
    price: 34.99,
    description: 'Rashguard de manga larga con tejido de alto rendimiento. Perfecto para BJJ y grappling.',
    stock: 40,
    category: Categoria.ROPA_ENTRENAMIENTO,
    subcategoria: 'Rashguards',
    marca: 'Tatami',
    imagenes: [] as string[],
    tags: ['BJJ', 'grappling'],
  },
  {
    codigoArticulo: 1005,
    name: 'Shorts MMA Venum Challenger',
    price: 39.99,
    description: 'Shorts de combate con panel elástico lateral y cierre velcro. Libertad de movimiento total.',
    stock: 50,
    category: Categoria.ROPA_ENTRENAMIENTO,
    subcategoria: 'Shorts MMA',
    marca: 'Venum',
    imagenes: [] as string[],
    tags: ['MMA', 'kickboxing'],
  },
  {
    codigoArticulo: 1010,
    name: 'Camiseta técnica Artur Salas Training',
    price: 24.99,
    description: 'Camiseta técnica de entrenamiento con tecnología DryFit. Transpirable y de secado rápido.',
    stock: 60,
    category: Categoria.ROPA_ENTRENAMIENTO,
    subcategoria: 'Camisetas técnicas',
    marca: 'Artur Salas',
    imagenes: [] as string[],
    tags: ['lifestyle'],
  },
  {
    codigoArticulo: 1011,
    name: 'Mallas de compresión BJJ manga larga',
    price: 32.99,
    description: 'Leggings de compresión con tejido antimicrobiano. Ideales para entrenamiento No-Gi y grappling.',
    stock: 45,
    category: Categoria.ROPA_ENTRENAMIENTO,
    subcategoria: 'Mallas',
    marca: 'Tatami',
    imagenes: [] as string[],
    tags: ['BJJ', 'grappling'],
  },
  {
    codigoArticulo: 1012,
    name: 'Shorts de grappling No-Gi Scramble',
    price: 44.99,
    description: 'Shorts de grappling con tela stretch 4 vías y costuras planas para mayor comodidad en el suelo.',
    stock: 35,
    category: Categoria.ROPA_ENTRENAMIENTO,
    subcategoria: 'Shorts BJJ',
    marca: 'Scramble',
    imagenes: [] as string[],
    tags: ['BJJ', 'grappling', 'destacado'],
  },
  {
    codigoArticulo: 1013,
    name: 'Rashguard manga corta Artur Salas Team',
    price: 29.99,
    description: 'Rashguard oficial del equipo. Manga corta, sublimación total y tejido con 15% spandex.',
    stock: 55,
    category: Categoria.ROPA_ENTRENAMIENTO,
    subcategoria: 'Rashguards',
    marca: 'Artur Salas',
    imagenes: [] as string[],
    tags: ['BJJ', 'MMA', 'lifestyle'],
  },

  // ── ROPA DE CALLE (3XXX) ─────────────────────────────────────────────────
  {
    codigoArticulo: 3006,
    name: 'Sudadera con capucha Artur Salas Team',
    price: 44.99,
    description: 'Sudadera oficial del equipo. Algodón grueso 320g/m², interior suave y logo bordado.',
    stock: 30,
    category: Categoria.ROPA_CALLE,
    subcategoria: 'Sudaderas',
    marca: 'Artur Salas',
    imagenes: [] as string[],
    tags: ['destacado', 'lifestyle'],
  },
  {
    codigoArticulo: 3007,
    name: 'Camiseta lifestyle Artur Salas Academy',
    price: 22.99,
    description: 'Camiseta de algodón 100% con serigrafía de la academia. Corte unisex y tallas de XS a XXL.',
    stock: 80,
    category: Categoria.ROPA_CALLE,
    subcategoria: 'Camisetas',
    marca: 'Artur Salas',
    imagenes: [] as string[],
    tags: ['lifestyle'],
  },
  {
    codigoArticulo: 3008,
    name: 'Pantalón de chándal Artur Salas Team',
    price: 38.99,
    description: 'Pantalón de chándal con cintura elástica, bolsillos laterales y logo bordado en muslo.',
    stock: 25,
    category: Categoria.ROPA_CALLE,
    subcategoria: 'Pantalones',
    marca: 'Artur Salas',
    imagenes: [] as string[],
    tags: ['lifestyle'],
  },
  {
    codigoArticulo: 3009,
    name: 'Gorra snapback Artur Salas',
    price: 19.99,
    description: 'Gorra snapback de 5 paneles con bordado frontal del logo. Talla única regulable.',
    stock: 40,
    category: Categoria.ROPA_CALLE,
    subcategoria: 'Gorras',
    marca: 'Artur Salas',
    imagenes: [] as string[],
    tags: ['lifestyle'],
  },

  // ── CALZADO (5XXX) ───────────────────────────────────────────────────────
  {
    codigoArticulo: 5003,
    name: 'Botas de boxeo Adidas Box Hog 4',
    price: 89.99,
    description: 'Botas de boxeo con suela antideslizante y tobillera reforzada para máximo soporte.',
    stock: 15,
    category: Categoria.CALZADO,
    subcategoria: 'Botas de boxeo',
    marca: 'Adidas',
    imagenes: [] as string[],
    tags: ['destacado', 'boxeo'],
  },
  {
    codigoArticulo: 5004,
    name: 'Zapatillas de lucha libre Asics Matflex 6',
    price: 74.99,
    description: 'Zapatillas de lucha con suela de caucho vulcanizado y cierre de cordón rápido. Peso ligero.',
    stock: 10,
    category: Categoria.CALZADO,
    subcategoria: 'Zapatillas de lucha',
    marca: 'Asics',
    imagenes: [] as string[],
    tags: ['lucha', 'grappling'],
  },
  {
    codigoArticulo: 5005,
    name: 'Sandalias vestuario Fighter Recovery',
    price: 18.99,
    description: 'Sandalias de EVA para vestuario y piscina. Antideslizantes y de secado instantáneo.',
    stock: 50,
    category: Categoria.CALZADO,
    subcategoria: 'Sandalias',
    marca: 'Fighter',
    imagenes: [] as string[],
    tags: ['lifestyle'],
  },

  // ── ACCESORIOS (4XXX) ────────────────────────────────────────────────────
  {
    codigoArticulo: 4008,
    name: 'Mochila de deporte Artur Salas Pro',
    price: 69.99,
    description: 'Mochila 45L con compartimento para ropa mojada, portaguantes y bolsillo lateral para botella.',
    stock: 12,
    category: Categoria.ACCESORIOS,
    subcategoria: 'Mochilas',
    marca: 'Artur Salas',
    imagenes: [] as string[],
    tags: ['destacado', 'lifestyle'],
  },
  {
    codigoArticulo: 4009,
    name: 'Cinturón BJJ blanco adulto Tatami',
    price: 11.99,
    description: 'Cinturón BJJ de algodón resistente 100% con refuerzo central. Medidas A1 a A4.',
    stock: 70,
    category: Categoria.ACCESORIOS,
    subcategoria: 'Cinturones',
    marca: 'Tatami',
    imagenes: [] as string[],
    tags: ['BJJ'],
  },
  {
    codigoArticulo: 4010,
    name: 'Cuerda de saltar RDX Pro Speed',
    price: 16.99,
    description: 'Cuerda de cable de acero con mangos ergonómicos y rodamientos de bola. Regulable en longitud.',
    stock: 45,
    category: Categoria.ACCESORIOS,
    subcategoria: 'Acondicionamiento',
    marca: 'RDX',
    imagenes: [] as string[],
    tags: ['boxeo', 'MMA', 'kickboxing'],
  },
  {
    codigoArticulo: 4011,
    name: 'Botella de agua acero inoxidable 750ml',
    price: 24.99,
    description: 'Botella térmica doble pared que mantiene el frío 24h. Boca ancha y tapa antigoteo.',
    stock: 30,
    category: Categoria.ACCESORIOS,
    subcategoria: 'Hidratación',
    marca: 'Artur Salas',
    imagenes: [] as string[],
    tags: ['lifestyle'],
  },
  {
    codigoArticulo: 4012,
    name: 'Saco de arena para muñecas 1kg',
    price: 19.99,
    description: 'Par de sacos de arena para muñecas con velcro ajustable. Refuerzan puños y aumentan resistencia.',
    stock: 20,
    category: Categoria.ACCESORIOS,
    subcategoria: 'Acondicionamiento',
    marca: 'Fighter',
    imagenes: [] as string[],
    tags: ['boxeo', 'MMA'],
  },
];


// ─── SERVICIOS ──────────────────────────────────────────────────────────
// Los servicios comparten el espacio de codigoArticulo con los productos: 60XX.
// `duracion` debe cuadrar con la duracion de los slots de disponibilidad.

const servicios = [
  {
    codigoArticulo: 6001,
    nombre: 'Sesión de Coaching',
    precio: 150,
    subcategoria: 'Coaching',
    descripcionCorta: 'Entrenamiento personalizado one-on-one en el tatami.',
    descripcionCompleta: 'Sesión de entrenamiento personalizado con Arturo Salas. Análisis técnico, corrección de postura, trabajo de posiciones específicas y estrategia de combate adaptada a tu nivel y objetivos.',
    modalidad: ModalidadServicio.PRESENCIAL,
    duracion: 60,
    plazas: 1,
    requiereReserva: true,
    requiereConfirmacion: true,
    activo: true,
    imagenes: [] as string[],
    tags: ['coaching', 'presencial', 'destacado'],
    orden: 1,
  },
  {
    codigoArticulo: 6002,
    nombre: 'Mentoría Online',
    precio: 80,
    subcategoria: 'Mentoría',
    descripcionCorta: 'Análisis de tu juego y plan de mejora vía videollamada.',
    descripcionCompleta: 'Sesión de mentoría online por videollamada. Revisión de tu material de competición, identificación de puntos de mejora y diseño de un plan de entrenamiento personalizado. Incluye resumen escrito post-sesión.',
    modalidad: ModalidadServicio.ONLINE,
    duracion: 60,
    plazas: 1,
    requiereReserva: true,
    requiereConfirmacion: true,
    activo: true,
    imagenes: [] as string[],
    tags: ['mentoria', 'online'],
    orden: 2,
  },
  {
    codigoArticulo: 6003,
    nombre: 'Seminario — Fin de Semana',
    precio: 1500,
    subcategoria: 'Seminarios',
    descripcionCorta: 'Dos jornadas intensivas de técnica avanzada en grupo reducido.',
    descripcionCompleta: 'Seminario de BJJ/Grappling de nivel avanzado con Arturo Salas, repartido en dos jornadas. Contenido: sistema de guard, top game, leg locks y estrategia de competición. Incluye material de apoyo y sesión de preguntas. Dos días de 8 horas con descansos.',
    modalidad: ModalidadServicio.PRESENCIAL,
    // 2 jornadas de 8 h. La disponibilidad de un seminario se gestiona como un
    // bloque suelto, no con la parrilla de slots de los servicios de 1 hora.
    duracion: 960,
    plazas: 20,
    requiereReserva: true,
    requiereConfirmacion: true,
    activo: true,
    imagenes: [] as string[],
    tags: ['seminario', 'grupo', 'destacado'],
    orden: 3,
  },
  {
    codigoArticulo: 6004,
    nombre: 'Coaching de Evaluación',
    precio: 60,
    subcategoria: 'Evaluación',
    descripcionCorta: 'Diagnóstico completo de tu nivel técnico y táctico.',
    descripcionCompleta: 'Sesión de evaluación técnica exhaustiva. Arturo analiza tu juego en directo, identifica tus fortalezas y debilidades, y entrega un informe detallado con recomendaciones específicas para los próximos 3-6 meses de entrenamiento.',
    modalidad: ModalidadServicio.PRESENCIAL,
    duracion: 60,
    plazas: 1,
    requiereReserva: true,
    requiereConfirmacion: true,
    activo: true,
    imagenes: [] as string[],
    tags: ['evaluacion', 'presencial'],
    orden: 4,
  },
  {
    codigoArticulo: 6005,
    nombre: 'Clases Privadas',
    precio: 120,
    subcategoria: 'Clases Privadas',
    descripcionCorta: 'Clases regulares individuales adaptadas a tu progresión.',
    descripcionCompleta: 'Clases privadas regulares con Arturo Salas. Programa adaptado a tu nivel (principiante, competidor, cinturón de color). Cada clase incluye calentamiento técnico, trabajo de posiciones y rolling supervisado.',
    modalidad: ModalidadServicio.PRESENCIAL,
    duracion: 90,
    plazas: 1,
    requiereReserva: true,
    requiereConfirmacion: true,
    activo: true,
    imagenes: [] as string[],
    tags: ['clases', 'presencial', 'destacado'],
    orden: 5,
  },
];

// ─── MAIN ─────────────────────────────────────────────────────────────────────

async function seed() {
  const dbUrl = resolveDbUrl();
  await mongoose.connect(dbUrl);
  console.log('Conectado a MongoDB');

  // Subir imagen por defecto a R2
  const imgPath = resolve(__dirname, 'src/assets/nodisponible.jpg');
  const imgBuffer = readFileSync(imgPath);
  IMG_DEFAULT = await uploadToR2(imgBuffer, 'nodisponible.jpg', 'image/jpeg', 'defaults/nodisponible.jpg');
  console.log('Imagen por defecto subida a R2:', IMG_DEFAULT);

  await User.deleteMany({});
  await ProductoModelo.deleteMany({});
  await ServicioModelo.deleteMany({});
  console.log('Colecciones limpiadas');

  for (const u of usuarios) {
    await new User(u).save();
  }
  console.log(`${usuarios.length} usuarios insertados`);

  // Asignar la URL de R2 a todos los productos antes de insertar
  const productosConImagen = productos.map((p) => ({
    ...p,
    imagenes: [IMG_DEFAULT],
  }));
  await ProductoModelo.insertMany(productosConImagen);
  console.log(`${productos.length} productos insertados`);

  const serviciosConImagen = servicios.map((s) => ({
    ...s,
    imagenes: [IMG_DEFAULT],
  }));
  await ServicioModelo.insertMany(serviciosConImagen);
  console.log(`${servicios.length} servicios insertados`);

  await mongoose.disconnect();
  console.log('Seed completado');
}

seed().catch((err) => {
  console.error('Error en seed:', err);
  process.exit(1);
});
