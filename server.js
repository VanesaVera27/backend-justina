const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const PUERTO = 3000;

// Permite que tu frontend (Live Server en puerto 5500) le haga pedidos a tu backend
app.use(cors());
app.use(express.json());

// 1. CONEXIÓN A LA BASE DE DATOS SQLITE
// (Si no existe el archivo tienda.db, lo crea automáticamente en tu carpeta)
const db = new sqlite3.Database('./tienda.db', (err) => {
    if (err) {
        console.error('Error abriendo base de datos:', err.message);
    } else {
        console.log('Conectado exitosamente a la base de datos SQLite.');
        crearTablas();
    }
});

// 2. CREACIÓN DE TABLAS (SQL)
function crearTablas() {
    db.serialize(() => {
        // Tabla de Usuarios
        db.run(`CREATE TABLE IF NOT EXISTS usuarios (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nombre TEXT NOT NULL,
            email TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL
        )`);

        // Tabla de Productos
        db.run(`CREATE TABLE IF NOT EXISTS productos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nombre TEXT NOT NULL,
            precio REAL NOT NULL,
            categoria TEXT,
            talles TEXT,
            imagen TEXT
        )`);
        
        console.log('Tablas "usuarios" y "productos" verificadas/creadas.');
    });
}

// 3. ENDPOINTS / RUTAS DE LA API

// RUTA PARA CARGAR TU ROPA REAL EN LA BASE DE DATOS
app.get('/api/seed', (req, res) => {
    const misProductos = [
      {
        nombre: "Sweater oversize",
        precio: 25000,
        categoria: "Sweaters",
        talles: ["U"],
        imagen: "imagenes/1.jpeg"
      },
      {
        nombre: "Vestido Halter",
        precio: 19000,
        categoria: "Vestidos",
        talles: ["M", "L"],
        imagen: "imagenes/2.jpeg"
      },
      {
        nombre: "Top Moon",
        precio: 15000,
        categoria: "Tops",
        talles: ["U"],
        imagen: "imagenes/3.jpeg"
      },
      {
        nombre: "Sweater cuello bote",
        precio: 25000,
        categoria: "Sweaters",
        talles: ["U"],
        imagen: "imagenes/4.jpeg"
      },
      {
        nombre: "Conjunto Morley Brush",
        precio: 38000,
        categoria: "Conjuntos",
        talles: ["38", "40"],
        imagen: "imagenes/5.jpeg"
      },
      {
        nombre: "Calza Oxford",
        precio: 22000,
        categoria: "Calzas",
        talles: ["M", "L", "XL"],
        imagen: "imagenes/6.jpeg"
      }
    ];

    const sql = 'INSERT INTO productos (nombre, precio, categoria, talles, imagen) VALUES (?, ?, ?, ?, ?)';

    misProductos.forEach(prod => {
        // Convertimos el array ["M", "L"] en texto "M,L" para guardarlo en la base
        const tallesTexto = prod.talles.join(',');
        
        db.run(sql, [prod.nombre, prod.precio, prod.categoria, tallesTexto, prod.imagen], err => {
            if (err) console.error("Error insertando producto:", err);
        });
    });

    res.send("¡Tus 6 prendas reales se cargaron con éxito en la base de datos tienda.db!");
});

// Ruta GET para obtener todos los productos de la base de datos
app.get('/api/productos', (req, res) => {
    db.all('SELECT * FROM productos', [], (err, filas) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        res.json(filas);
    });
});

// Ruta POST para registrar un usuario nuevo en la base de datos
app.post('/api/usuarios/registro', (req, res) => {
    const { nombre, email, password } = req.body;

    const sql = 'INSERT INTO usuarios (nombre, email, password) VALUES (?, ?, ?)';
    
    db.run(sql, [nombre, email, password], function(err) {
        if (err) {
            res.status(400).json({ error: 'Ese email ya se encuentra registrado.' });
            return;
        }
        res.status(201).json({
            mensaje: 'Usuario creado exitosamente',
            idUsuario: this.lastID
        });
    });
});

// 4. ENCENDER EL SERVIDOR
app.listen(PUERTO, () => {
    console.log(`Servidor backend corriendo en http://localhost:${PUERTO}`);
});