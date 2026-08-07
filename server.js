const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const multer = require('multer');
const path = require('path');

const app = express();
const PUERTO = 3000;

// Permite que el frontend le haga pedidos al back
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
  user: 'postgres',        // Usuario local de PostgreSQL
  host: 'localhost',       // Computadora local
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

        // TABLA DE USUARIOS
    await pool.query(`
      CREATE TABLE IF NOT EXISTS usuarios (
        id SERIAL PRIMARY KEY,
        nombre VARCHAR(150) NOT NULL,
        email VARCHAR(150) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        rol VARCHAR(20) DEFAULT 'cliente'
      );
    `);

        // TABLA DE PRODUCTOS
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
    // TABLA DE CATEGORIAS
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

    // TABLA PEDIDOS
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

    // TABLA DETALLE_PEDIDOS (Renglón por cada prenda comprada)
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

        // TABLA DE FAVORITOS
    await pool.query(`
    CREATE TABLE IF NOT EXISTS favoritos (
        id SERIAL PRIMARY KEY,
        usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
        producto_id INTEGER NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
        fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT uniq_fav UNIQUE (usuario_id, producto_id)
    );
    `);

  } catch (err) {
    console.error('Error creando tablas:', err.message);
  }
}


// ENDPOINTS / RUTAS DE LA API 

//----------------------------------------------------------------------------------------------------PRODUCTOS Y VARIANTES

// ==========================================
// GET: Obtener todos los productos CON sus variantes y stock
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
// POST: Cargar producto con sus variantes
// ==========================================
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
// PUT: Actualizar precio, datos, stock y orden de fotos
// ==========================================
app.put('/api/productos/:id', upload.array('fotosNuevas', 5), async (req, res) => {
  const { id } = req.params;
  const { nombre, precio, categoria, variantes, fotosExistentes } = req.body;

  try {
    // 1. Actualizamos datos generales del producto
    await pool.query(
      'UPDATE productos SET nombre = $1, precio = $2, categoria = $3 WHERE id = $4',
      [nombre, precio, categoria, id]
    );

    // 2. Si mandaron variantes para actualizar (Re-stock)
    if (variantes) {
      const listaVariantes = typeof variantes === 'string' ? JSON.parse(variantes) : variantes;
      await pool.query('DELETE FROM variantes WHERE producto_id = $1', [id]);
      for (const v of listaVariantes) {
        await pool.query(
          'INSERT INTO variantes (producto_id, talle, color, stock) VALUES ($1, $2, $3, $4)',
          [id, v.talle, v.color, parseInt(v.stock)]
        );
      }
    }

    // 3. Actualización del ORDEN de las fotos y nuevas cargas
    let listaFotosFinal = [];

    // A. Fotos que decidieron dejar/reordenar en el modal
    if (fotosExistentes) {
      const parsedExistentes = typeof fotosExistentes === 'string' 
        ? JSON.parse(fotosExistentes) 
        : fotosExistentes;
      listaFotosFinal = [...parsedExistentes];
    }

    // B. Fotos nuevas que hayan subido en este momento
    if (req.files && req.files.length > 0) {
      for (const file of req.files) {
        listaFotosFinal.push(`imagenes/${file.filename}`);
      }
    }

    // C. Si tenemos fotos en la lista, actualizamos la tabla y la portada
    if (listaFotosFinal.length > 0) {
      // Reemplazamos la imagen de portada en la tabla productos (la posición 0)
      await pool.query('UPDATE productos SET imagen = $1 WHERE id = $2', [listaFotosFinal[0], id]);

      // Regeneramos las filas en imagenes_producto para respetar el nuevo orden
      await pool.query('DELETE FROM imagenes_producto WHERE producto_id = $1', [id]);
      for (const urlFoto of listaFotosFinal) {
        await pool.query(
          'INSERT INTO imagenes_producto (producto_id, url) VALUES ($1, $2)',
          [id, urlFoto]
        );
      }
    }

    res.json({ mensaje: "Producto, stock e imágenes actualizados correctamente." });
  } catch (err) {
    console.error("Error actualizando producto:", err);
    res.status(500).json({ error: "Error actualizando el producto." });
  }
});

// ==========================================
// DELETE: Borrar un producto 
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


//--------------------------------------------------------------------------------------------CATEGORIAS

// ============================================================
// GET: Obtener todas las categorías ordenadas alfabéticamente
// ============================================================
app.get('/api/categorias', async (req, res) => {
  try {
    const respuesta = await pool.query('SELECT * FROM categorias ORDER BY nombre ASC');
    res.json(respuesta.rows);
  } catch (err) {
    res.status(500).json({ error: "Error al obtener categorías." });
  }
});
// ==========================================
// POST: Crear una categoría nueva
// ==========================================
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
    if (err.code === '23505') {
      res.status(400).json({ error: "Esa categoría ya existe." });
    } else {
      res.status(500).json({ error: "Error al crear categoría." });
    }
  }
});



// -------------------------------------------------------------------------------------------USUARIOS

// ==========================================
//  Creación de usuario admin
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
// POST: Login de usuario
// ==========================================

app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;

  try {
    const consulta = await pool.query(
      'SELECT id, nombre, email, rol FROM usuarios WHERE email = $1 AND password = $2',
      [email, password]
    );

    if (consulta.rows.length === 0) {
      return res.status(401).json({ error: "Correo o contraseña incorrectos." });
    }

    res.json({
      mensaje: "¡Inicio de sesión exitoso!",
      usuario: consulta.rows[0]
    });
  } catch (err) {
    console.error("Error en login:", err.message);
    res.status(500).json({ error: "Error interno del servidor al iniciar sesión." });
  }
});

// ==========================================
// POST: Registro de usuario
// ==========================================

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

// ==========================================
// PUT: Modificar nombre o contraseña del cliente
// ==========================================

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


// POST: Verificar si la contraseña del usuario es correcta
app.post('/api/usuarios/verificar-password', async (req, res) => {
    const { usuario_id, password } = req.body;
    try {
        const result = await pool.query('SELECT password FROM usuarios WHERE id = $1', [usuario_id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Usuario no encontrado." });
        }

        const passwordDB = result.rows[0].password;
        // Si la clave coincide (si usás bcrypt, acá iría bcrypt.compare)
        if (passwordDB === password) {
            res.json({ valido: true });
        } else {
            res.status(401).json({ error: "Contraseña incorrecta." });
        }
    } catch (err) {
        res.status(500).json({ error: "Error al verificar seguridad." });
    }
});

// ==========================================================
// DELETE: Eliminar cuenta de usuario
// ==========================================================

app.delete('/api/usuarios/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query('DELETE FROM usuarios WHERE id = $1', [id]);
    res.json({ mensaje: "Tu cuenta fue eliminada del sistema." });
  } catch (err) {
    res.status(500).json({ error: "Error al eliminar la cuenta." });
  }
});

//------------------------------------------------------------------------------------------- DIRECCIONES

// ==========================================================
// GET: Obtener direcciones guardadas de un cliente
// ==========================================================

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


// ==========================================================
// POST: Guardar una nueva dirección
// ==========================================================

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
// PUT: Editar dirección existente 
// ==========================================================

app.put('/api/direcciones/:id', async (req, res) => {
    const { id } = req.params;
    const { calle_numero, codigo_postal, localidad, provincia, pais } = req.body;
    try {
        await pool.query(
            'UPDATE direcciones SET calle_numero = $1, codigo_postal = $2, localidad = $3, provincia = $4, pais = $5 WHERE id = $6',
            [calle_numero, codigo_postal, localidad, provincia, pais, id]
        );
        res.json({ mensaje: "Dirección actualizada con éxito." });
    } catch (err) {
        res.status(500).json({ error: "Error al actualizar la dirección." });
    }
});

// ==========================================================
// DELETE: Borrar direccion
// ==========================================================
app.delete('/api/direcciones/:id', async (req, res) => {
    const { id } = req.params;
    try {
        await pool.query('DELETE FROM direcciones WHERE id = $1', [id]);
        res.json({ mensaje: "Dirección eliminada correctamente." });
    } catch (err) {
        res.status(500).json({ error: "Error al eliminar la dirección." });
    }
});


//-------------------------------------------------------------------------------------------PEDIDOS

// ==========================================================
//GET : VER PEDIDOS DEL CLIENTE ("MIS PEDIDOS")
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
// POST: Crear un nuevo pedido y DESCONTAR EL STOCK automáticamente
// ==========================================================

app.post('/api/pedidos', async (req, res) => {
  const { usuario_id, nombre, email, domicilio, total, items } = req.body;

  if (!domicilio || !items || items.length === 0) {
    return res.status(400).json({ error: "Faltan datos para procesar el pedido o el carrito está vacío." });
  }

  // Usamos un cliente dedicado para manejar la transacción de PostgreSQL
  const client = await pool.connect();

  try {
    await client.query('BEGIN'); 

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

    await client.query('COMMIT'); 
    res.status(201).json({ mensaje: "¡Pedido registrado y stock actualizado!", pedido_id: idPedido });

  } catch (error) {
    await client.query('ROLLBACK'); // Si algo falló, deshacemos todo para no dejar datos a medias
    console.error("Error procesando pedido:", error);
    res.status(500).json({ error: "Error interno procesando la compra." });
  } finally {
    client.release();
  }
});


// ==================================================================
// GET: Obtener todos los pedidos (Para el Panel de Administración)
// ==================================================================

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


// ==========================================================
// Actualizar estados del pedido y de pago (Desde la web del Admin)
// ==========================================================

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

//----------------------------------------------------------------------------------FAVORITOS


// GET: Obtener solo la lista de IDs de prendas favoritas de un usuario
app.get('/api/favoritos/:usuarioId', async (req, res) => {
    const { usuarioId } = req.params;
    try {
        const result = await pool.query(
            'SELECT producto_id FROM favoritos WHERE usuario_id = $1',
            [usuarioId]
        );
        // Devolvemos un array simple de números: [1, 4, 7]
        const arrayIds = result.rows.map(row => row.producto_id);
        res.json(arrayIds);
    } catch (err) {
        res.status(500).json({ error: "Error al cargar favoritos del usuario." });
    }
});

// POST: Guardar una prenda en favoritos
app.post('/api/favoritos', async (req, res) => {
    const { usuario_id, producto_id } = req.body;
    try {
        // ON CONFLICT DO NOTHING evita errores si le dan doble clic al corazón
        await pool.query(
            'INSERT INTO favoritos (usuario_id, producto_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
            [usuario_id, producto_id]
        );
        res.status(201).json({ mensaje: "¡Agregado a favoritos!" });
    } catch (err) {
        res.status(500).json({ error: "Error al guardar favorito." });
    }
});

// DELETE: Quitar una prenda de favoritos
app.delete('/api/favoritos/:usuarioId/:productoId', async (req, res) => {
    const { usuarioId, productoId } = req.params;
    try {
        await pool.query(
            'DELETE FROM favoritos WHERE usuario_id = $1 AND producto_id = $2',
            [usuarioId, productoId]
        );
        res.json({ mensaje: "¡Eliminado de favoritos!" });
    } catch (err) {
        res.status(500).json({ error: "Error al eliminar favorito." });
    }
});


// ---------------------------------------------------------------------------------ENCENDER EL SERVIDOR
app.listen(PUERTO, () => {
  console.log(`Servidor backend corriendo en http://localhost:${PUERTO}`);
});

