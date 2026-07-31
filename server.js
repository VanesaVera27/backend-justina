const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const multer = require('multer');
const path = require('path');

const app = express();
const PUERTO = 3000;

// Permite que el frontend le haga pedidos a tu backend
app.use(cors());
app.use(express.json());

// CONFIGURACIÓN DE MULTER

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        // Apuntamos a la carpeta imagenes del frontend
        cb(null, path.join(__dirname, '../frontend-justina/imagenes'));
    },
    filename: function (req, file, cb) {
        const extension = path.extname(file.originalname);
        const nombreUnico = 'prenda-' + Date.now() + extension;
        cb(null, nombreUnico);
    }
});

const upload = multer({ storage: storage });

// CONEXIÓN A LA BASE DE DATOS POSTGRESQL LOCAL
const pool = new Pool({
    user: 'postgres',        // Tu usuario local de PostgreSQL
    host: 'localhost',       // Tu computadora local
    database: 'tienda_db',   // El nombre de la base de datos que vas a usar
    password: 'postgres27', // Contraseña de postgreSQL
    port: 5432,              // Puerto por defecto de PostgreSQL
});

// Verificamos la conexión al arrancar el servidor
pool.connect((err, client, release) => {
    if (err) {
        console.error('Error al conectar con PostgreSQL:', err.message);
    } else {
        console.log('Conectado exitosamente a PostgreSQL local.');
        release();
        crearTablas();
    }
});

// CREACIÓN DE TABLAS 

async function crearTablas() {
    try {
        await pool.query(`
      CREATE TABLE IF NOT EXISTS usuarios (
        id SERIAL PRIMARY KEY,
        nombre VARCHAR(150) NOT NULL,
        email VARCHAR(150) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        rol VARCHAR(20) DEFAULT 'cliente'
      );
    `);

        await pool.query(`
      CREATE TABLE IF NOT EXISTS productos (
        id SERIAL PRIMARY KEY,
        nombre VARCHAR(150) NOT NULL,
        precio NUMERIC(10, 2) NOT NULL,
        categoria VARCHAR(100),
        imagen TEXT
      );
    `);

        // Nueva tabla de Variantes (Talle + Color + Stock)
        await pool.query(`
      CREATE TABLE IF NOT EXISTS variantes (
        id SERIAL PRIMARY KEY,
        producto_id INTEGER REFERENCES productos(id) ON DELETE CASCADE,
        talle VARCHAR(10) NOT NULL,
        color VARCHAR(50) NOT NULL,
        stock INTEGER NOT NULL DEFAULT 0
      );
    `);

        console.log('Tablas y estructura de stock creadas en PostgreSQL.');
    } catch (err) {
        console.error('Error creando tablas:', err.message);
    }
}


// ENDPOINTS / RUTAS DE LA API 

//PRODUCTOS Y VARIANTES

// ==========================================
// 1. GET: Obtener todos los productos CON sus variantes y stock
// ==========================================
app.get('/api/productos', async (req, res) => {
    try {
        const resProductos = await pool.query('SELECT * FROM productos ORDER BY id ASC');
        const resVariantes = await pool.query('SELECT * FROM variantes');

        // Juntamos cada producto con su lista de variantes
        const catalogoCompleto = resProductos.rows.map(prod => {
            const variantes = resVariantes.rows.filter(v => v.producto_id === prod.id);
            return {
                ...prod,
                variantes: variantes
            };
        });

        res.json(catalogoCompleto);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==========================================
// 2. POST: Cargar producto con sus variantes
// ==========================================
app.post('/api/productos', upload.single('foto'), async (req, res) => {
    const { nombre, precio, categoria, variantes } = req.body;

    const imagen = req.file
        ? `imagenes/${req.file.filename}`
        : "https://via.placeholder.com/300x400?text=Prenda";

    try {
        // 1. Guardamos el producto general
        const resProd = await pool.query(
            'INSERT INTO productos (nombre, precio, categoria, imagen) VALUES ($1, $2, $3, $4) RETURNING *',
            [nombre, precio, categoria, imagen]
        );
        const nuevoId = resProd.rows[0].id;

        // 2. Parseamos las variantes que envía el frontend (llegan como string JSON al usar FormData)
        const listaVariantes = JSON.parse(variantes || "[]");

        // 3. Guardamos cada variante combinada
        for (const v of listaVariantes) {
            await pool.query(
                'INSERT INTO variantes (producto_id, talle, color, stock) VALUES ($1, $2, $3, $4)',
                [nuevoId, v.talle, v.color, parseInt(v.stock)]
            );
        }

        res.status(201).json({ mensaje: "¡Producto y stock guardados!" });
    } catch (err) {
        console.error("Error al guardar producto:", err);
        res.status(500).json({ error: "Error guardando el producto." });
    }
});

// ==========================================
// 3. PUT: Actualizar precio, datos o stock
// ==========================================
app.put('/api/productos/:id', async (req, res) => {
    const { id } = req.params;
    const { nombre, precio, categoria, variantes } = req.body;

    try {
        // Actualizamos datos generales
        await pool.query(
            'UPDATE productos SET nombre = $1, precio = $2, categoria = $3 WHERE id = $4',
            [nombre, precio, categoria, id]
        );

        // Si mandaron variantes para actualizar, borramos las viejas de ese id y cargamos las nuevas
        if (variantes) {
            await pool.query('DELETE FROM variantes WHERE producto_id = $1', [id]);
            for (const v of variantes) {
                await pool.query(
                    'INSERT INTO variantes (producto_id, talle, color, stock) VALUES ($1, $2, $3, $4)',
                    [id, v.talle, v.color, parseInt(v.stock)]
                );
            }
        }

        res.json({ mensaje: "Producto actualizado correctamente." });
    } catch (err) {
        res.status(500).json({ error: "Error actualizando el producto." });
    }
});

// ==========================================
// 4. DELETE: Borrar un producto (y sus variantes por CASCADE)
// ==========================================
app.delete('/api/productos/:id', async (req, res) => {
    const { id } = req.params;
    try {
        await pool.query('DELETE FROM productos WHERE id = $1', [id]);
        res.json({ mensaje: "Producto eliminado del catálogo." });
    } catch (err) {
        res.status(500).json({ error: "Error al borrar el producto." });
    }
});


// USUARIOS

// ==========================================
// 2. RUTA SEED: Crear tu cuenta de dueña administradora
// ==========================================
app.get('/api/seed-admin', async (req, res) => {
  try {
    // Te crea una cuenta admin con email y clave listos para probar
    await pool.query(`
      INSERT INTO usuarios (nombre, email, password, rol)
      VALUES ('Justina Store', 'admin@justina.com', 'admin1234', 'admin')
      ON CONFLICT (email) DO NOTHING;
    `);
    res.send("¡Cuenta de admin creada! Email: admin@justina.com / Clave: admin1234");
  } catch (err) {
    res.status(500).send("Error al crear usuario admin: " + err.message);
  }
});

// ==========================================
// 3. RUTA POST: Login de usuario
// ==========================================

app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;

  try {
    // Buscamos el usuario en PostgreSQL por email y contraseña
    const consulta = await pool.query(
      'SELECT id, nombre, email, rol FROM usuarios WHERE email = $1 AND password = $2',
      [email, password]
    );

    if (consulta.rows.length === 0) {
      return res.status(401).json({ error: "Correo o contraseña incorrectos." });
    }

    // Devolvemos el usuario (su objeto incluirá rol: 'admin' o rol: 'cliente')
    res.json({
      mensaje: "¡Inicio de sesión exitoso!",
      usuario: consulta.rows[0]
    });
  } catch (err) {
    console.error("Error en login:", err.message);
    res.status(500).json({ error: "Error interno del servidor al iniciar sesión." });
  }
});

app.post('/api/usuarios/registro', async (req, res) => {
    const { nombre, email, password } = req.body;

    const sql = `
        INSERT INTO usuarios (nombre, email, password) 
        VALUES ($1, $2, $3) 
        RETURNING id;
    `;

    try {
        const respuesta = await pool.query(sql, [nombre, email, password]);
        res.status(201).json({
            mensaje: 'Usuario creado exitosamente',
            idUsuario: respuesta.rows[0].id
        });
    } catch (err) {
        if (err.code === '23505') {
            res.status(400).json({ error: 'Ese correo electrónico ya está registrado.' });
        } else {
            res.status(500).json({ error: 'Error interno al registrar el usuario.' });
        }
    }
});

// ENCENDER EL SERVIDOR
app.listen(PUERTO, () => {
    console.log(`Servidor backend corriendo en http://localhost:${PUERTO}`);
});

