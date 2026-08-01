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

    // TABLA DE IMÁGENES DE PRODUCTOS
    await pool.query(`
      CREATE TABLE IF NOT EXISTS imagenes_producto (
        id SERIAL PRIMARY KEY,
        producto_id INTEGER REFERENCES productos(id) ON DELETE CASCADE,
        url TEXT NOT NULL
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

    await pool.query(`
      CREATE TABLE IF NOT EXISTS categorias (
        id SERIAL PRIMARY KEY,
        nombre VARCHAR(100) UNIQUE NOT NULL
      );
    `);

    // Insertamos categorías por defecto solo si no existen
    const categoriasIniciales = [
      'Sweaters', 'Vestidos', 'Tops', 'Conjuntos',
      'Calzas', 'Remeras', 'Pantalones', 'Buzos', "Jeans", "Abrigos", "Accesorios"
    ];
    for (const cat of categoriasIniciales) {
      await pool.query(
        'INSERT INTO categorias (nombre) VALUES ($1) ON CONFLICT (nombre) DO NOTHING;',
        [cat]
      );
    }

    // 1. TABLA PEDIDOS
    await pool.query(`
      CREATE TABLE IF NOT EXISTS pedidos (
        id SERIAL PRIMARY KEY,
        usuario_id INTEGER REFERENCES usuarios(id),
        nombre_comprador VARCHAR(150) NOT NULL,
        email_comprador VARCHAR(150) NOT NULL,
        domicilio TEXT NOT NULL,
        total NUMERIC(10, 2) NOT NULL,
        estado_pedido VARCHAR(50) DEFAULT 'En proceso',
        estado_pago VARCHAR(50) DEFAULT 'Pendiente',
        fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 2. TABLA DETALLE_PEDIDOS (Renglón por cada prenda comprada)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS detalle_pedidos (
        id SERIAL PRIMARY KEY,
        pedido_id INTEGER REFERENCES pedidos(id) ON DELETE CASCADE,
        producto_id INTEGER,
        nombre_producto VARCHAR(150),
        talle VARCHAR(10),
        color VARCHAR(50),
        precio_unitario NUMERIC(10, 2)
      );
    `);

    // TABLA DE DIRECCIONES DE CLIENTES
    await pool.query(`
      CREATE TABLE IF NOT EXISTS direcciones (
        id SERIAL PRIMARY KEY,
        usuario_id INTEGER REFERENCES usuarios(id) ON DELETE CASCADE,
        calle_numero VARCHAR(200) NOT NULL,
        codigo_postal VARCHAR(20) NOT NULL,
        localidad VARCHAR(100) NOT NULL,
        provincia VARCHAR(100) NOT NULL,
        pais VARCHAR(100) DEFAULT 'Argentina'
      );
    `);

    console.log('Tablas y estructura de stock creadas en PostgreSQL.');
    console.log('Tabla "categorias" verificada/creada con sus datos iniciales.');
    console.log('Tablas "pedidos" y "detalle_pedidos" verificadas/creadas con éxito.');
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
    const resImagenes = await pool.query('SELECT * FROM imagenes_producto');

    const catalogoCompleto = resProductos.rows.map(prod => {
      const variantes = resVariantes.rows.filter(v => v.producto_id === prod.id);
      const imagenes = resImagenes.rows
        .filter(img => img.producto_id === prod.id)
        .map(img => img.url);

      return {
        ...prod,
        variantes: variantes,
        // Si no tiene imágenes en la tabla nueva, usamos la imagen principal anterior como respaldo
        imagenes: imagenes.length > 0 ? imagenes : [prod.imagen]
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
// Cambiamos upload.single('foto') por upload.array('fotos', 5)
app.post('/api/productos', upload.array('fotos', 5), async (req, res) => {
  const { nombre, precio, categoria, variantes } = req.body;
  
  // Guardamos como imagen principal la primera que hayan subido
  const imagenPrincipal = req.files && req.files.length > 0 
    ? `imagenes/${req.files[0].filename}` 
    : "https://via.placeholder.com/300x400?text=Prenda";

  try {
    const resProd = await pool.query(
      'INSERT INTO productos (nombre, precio, categoria, imagen) VALUES ($1, $2, $3, $4) RETURNING *',
      [nombre, precio, categoria, imagenPrincipal]
    );
    const nuevoId = resProd.rows[0].id;

    // A. Guardamos las fotos en la tabla imagenes_producto
    if (req.files && req.files.length > 0) {
      for (const file of req.files) {
        await pool.query(
          'INSERT INTO imagenes_producto (producto_id, url) VALUES ($1, $2)',
          [nuevoId, `imagenes/${file.filename}`]
        );
      }
    } else {
      await pool.query(
        'INSERT INTO imagenes_producto (producto_id, url) VALUES ($1, $2)',
        [nuevoId, imagenPrincipal]
      );
    }

    // B. Guardamos las variantes de stock (Talle + Color)
    const listaVariantes = JSON.parse(variantes || "[]");
    for (const v of listaVariantes) {
      await pool.query(
        'INSERT INTO variantes (producto_id, talle, color, stock) VALUES ($1, $2, $3, $4)',
        [nuevoId, v.talle, v.color, parseInt(v.stock)]
      );
    }

    res.status(201).json({ mensaje: "¡Producto, stock y fotos guardados!" });
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

// GET: Obtener todas las categorías ordenadas alfabéticamente
app.get('/api/categorias', async (req, res) => {
  try {
    const respuesta = await pool.query('SELECT * FROM categorias ORDER BY nombre ASC');
    res.json(respuesta.rows);
  } catch (err) {
    res.status(500).json({ error: "Error al obtener categorías." });
  }
});

// POST: Crear una categoría nueva
app.post('/api/categorias', async (req, res) => {
  const { nombre } = req.body;

  if (!nombre || !nombre.trim()) {
    return res.status(400).json({ error: "El nombre de la categoría no puede estar vacío." });
  }

  try {
    const respuesta = await pool.query(
      'INSERT INTO categorias (nombre) VALUES ($1) RETURNING *;',
      [nombre.trim()]
    );
    res.status(201).json({
      mensaje: "¡Categoría creada!",
      categoria: respuesta.rows[0]
    });
  } catch (err) {
    // Código 23505 = Nombre duplicado en PostgreSQL
    if (err.code === '23505') {
      res.status(400).json({ error: "Esa categoría ya existe." });
    } else {
      res.status(500).json({ error: "Error al crear categoría." });
    }
  }
});



// USUARIOS

// ==========================================
// 2. Creación de usuario admin
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


// PUT: Modificar nombre o contraseña del cliente
app.put('/api/usuarios/:id', async (req, res) => {
  const { id } = req.params;
  const { nombre, password } = req.body;

  try {
    if (password) {
      await pool.query('UPDATE usuarios SET nombre = $1, password = $2 WHERE id = $3', [nombre, password, id]);
    } else {
      await pool.query('UPDATE usuarios SET nombre = $1 WHERE id = $2', [nombre, id]);
    }
    const resUser = await pool.query('SELECT id, nombre, email, rol FROM usuarios WHERE id = $1', [id]);
    res.json({ mensaje: "Datos actualizados correctamente.", usuario: resUser.rows[0] });
  } catch (err) {
    res.status(500).json({ error: "Error al actualizar el perfil." });
  }
});

// DELETE: Eliminar cuenta de usuario
app.delete('/api/usuarios/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query('DELETE FROM usuarios WHERE id = $1', [id]);
    res.json({ mensaje: "Tu cuenta fue eliminada del sistema." });
  } catch (err) {
    res.status(500).json({ error: "Error al eliminar la cuenta." });
  }
});

// ==========================================================
// 3. ENDPOINTS PARA DIRECCIONES
// ==========================================================

// GET: Obtener direcciones guardadas de un cliente
app.get('/api/direcciones/:usuario_id', async (req, res) => {
  try {
    const respuesta = await pool.query(
      'SELECT * FROM direcciones WHERE usuario_id = $1 ORDER BY id DESC',
      [req.params.usuario_id]
    );
    res.json(respuesta.rows);
  } catch (err) {
    res.status(500).json({ error: "Error obteniendo direcciones." });
  }
});

// POST: Guardar una nueva dirección
app.post('/api/direcciones', async (req, res) => {
  const { usuario_id, calle_numero, codigo_postal, localidad, provincia, pais } = req.body;
  try {
    const resp = await pool.query(
      `INSERT INTO direcciones (usuario_id, calle_numero, codigo_postal, localidad, provincia, pais)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *;`,
      [usuario_id, calle_numero, codigo_postal, localidad, provincia, pais || 'Argentina']
    );
    res.status(201).json(resp.rows[0]);
  } catch (err) {
    res.status(500).json({ error: "Error al guardar la dirección." });
  }
});

// ==========================================================
// 4. ENDPOINT: VER PEDIDOS DEL CLIENTE ("MIS PEDIDOS")
// ==========================================================
app.get('/api/mis-pedidos/:usuario_id', async (req, res) => {
  try {
    const resPedidos = await pool.query(
      'SELECT * FROM pedidos WHERE usuario_id = $1 ORDER BY fecha DESC',
      [req.params.usuario_id]
    );
    const resDetalles = await pool.query('SELECT * FROM detalle_pedidos');

    const misPedidos = resPedidos.rows.map(ped => ({
      ...ped,
      items: resDetalles.rows.filter(d => d.pedido_id === ped.id)
    }));

    res.json(misPedidos);
  } catch (err) {
    res.status(500).json({ error: "Error al cargar tus pedidos." });
  }
});

// ==========================================================
// --- ENDPOINTS DE PEDIDOS Y CONTROL DE STOCK ---
// ==========================================================

// 1. POST: Crear un nuevo pedido y DESCONTAR EL STOCK automáticamente
app.post('/api/pedidos', async (req, res) => {
  const { usuario_id, nombre, email, domicilio, total, items } = req.body;

  if (!domicilio || !items || items.length === 0) {
    return res.status(400).json({ error: "Faltan datos para procesar el pedido o el carrito está vacío." });
  }

  // Usamos un cliente dedicado para manejar la transacción de PostgreSQL
  const client = await pool.connect();

  try {
    await client.query('BEGIN'); // Empezamos la transacción

    // A. Guardamos la cabecera del pedido
    const resPedido = await client.query(
      `INSERT INTO pedidos (usuario_id, nombre_comprador, email_comprador, domicilio, total)
       VALUES ($1, $2, $3, $4, $5) RETURNING id;`,
      [usuario_id, nombre, email, domicilio, total]
    );
    const idPedido = resPedido.rows[0].id;

    // B. Recorremos cada ítem del carrito para guardarlo y descontar stock
    for (const item of items) {
      // Guardamos el detalle del renglón
      await client.query(
        `INSERT INTO detalle_pedidos (pedido_id, producto_id, nombre_producto, talle, color, precio_unitario)
         VALUES ($1, $2, $3, $4, $5, $6);`,
        [idPedido, item.id, item.nombre, item.talleElegido, item.colorElegido, item.precio]
      );

      // DESCONTAMOS EL STOCK (-1) en la variante elegida
      await client.query(
        `UPDATE variantes 
         SET stock = stock - 1 
         WHERE producto_id = $1 AND talle = $2 AND color = $3 AND stock > 0;`,
        [item.id, item.talleElegido, item.colorElegido]
      );
    }

    await client.query('COMMIT'); // Confirmamos todos los cambios en PostgreSQL
    res.status(201).json({ mensaje: "¡Pedido registrado y stock actualizado!", pedido_id: idPedido });

  } catch (error) {
    await client.query('ROLLBACK'); // Si algo falló, deshacemos todo para no dejar datos a medias
    console.error("Error procesando pedido:", error);
    res.status(500).json({ error: "Error interno procesando la compra." });
  } finally {
    client.release();
  }
});

// 2. GET: Obtener todos los pedidos (Para el Panel de Administración)
app.get('/api/pedidos', async (req, res) => {
  try {
    // Obtenemos los pedidos generales ordenados por fecha más reciente
    const resPedidos = await pool.query('SELECT * FROM pedidos ORDER BY fecha DESC');
    const resDetalles = await pool.query('SELECT * FROM detalle_pedidos');

    // Juntamos cada pedido con su lista de productos
    const pedidosCompletos = resPedidos.rows.map(ped => {
      const ítems = resDetalles.rows.filter(d => d.pedido_id === ped.id);
      return { ...ped, items: ítems };
    });

    res.json(pedidosCompletos);
  } catch (err) {
    res.status(500).json({ error: "Error obteniendo los pedidos." });
  }
});

// 3. PUT: Actualizar estados del pedido y de pago (Desde la web del Admin)
app.put('/api/pedidos/:id/estado', async (req, res) => {
  const { id } = req.params;
  const { estado_pedido, estado_pago } = req.body;

  try {
    await pool.query(
      `UPDATE pedidos SET estado_pedido = $1, estado_pago = $2 WHERE id = $3;`,
      [estado_pedido, estado_pago, id]
    );
    res.json({ mensaje: "Estado del pedido actualizado." });
  } catch (err) {
    res.status(500).json({ error: "Error actualizando estado del pedido." });
  }
});

// ENCENDER EL SERVIDOR
app.listen(PUERTO, () => {
  console.log(`Servidor backend corriendo en http://localhost:${PUERTO}`);
});

