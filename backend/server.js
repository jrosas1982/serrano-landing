const path = require("path");
const fs = require("fs");
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const mysql = require("mysql2/promise");

const PORT = Number(process.env.PORT || 4000);
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "change-this-token";
const CORS_ORIGIN = process.env.CORS_ORIGIN || "*";
const DB_CLIENT = (process.env.DB_CLIENT || (process.env.NODE_ENV === "production" ? "mysql" : "sqlite")).toLowerCase();

const MYSQL_HOST = process.env.MYSQL_HOST || "localhost";
const MYSQL_PORT = Number(process.env.MYSQL_PORT || 3306);
const MYSQL_USER = process.env.MYSQL_USER || "mysql";
const MYSQL_PASSWORD = process.env.MYSQL_PASSWORD || "";
const MYSQL_DATABASE = process.env.MYSQL_DATABASE || "mysql";

const app = express();
const rootDir = __dirname;
const uploadsDir = path.join(rootDir, "uploads");
const dataDir = path.join(rootDir, "data");
const sqlitePath = process.env.SQLITE_FILE || path.join(dataDir, "news.db");

fs.mkdirSync(uploadsDir, { recursive: true });
fs.mkdirSync(dataDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const safeExt = path.extname(file.originalname).toLowerCase() || ".jpg";
    const base = path
      .basename(file.originalname, path.extname(file.originalname))
      .replace(/[^a-zA-Z0-9_-]/g, "-")
      .slice(0, 50);
    cb(null, `${Date.now()}-${base}${safeExt}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }
});

app.use(cors({ origin: CORS_ORIGIN }));
app.use(express.json());
app.use("/uploads", express.static(uploadsDir));
app.use("/admin", express.static(path.join(rootDir, "public", "admin")));

function isValidStatus(status) {
  return status === "draft" || status === "published";
}

function requireAdmin(req, res, next) {
  const token = req.headers["x-admin-token"];
  if (!token || token !== ADMIN_TOKEN) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

function asyncHandler(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

function mapRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    imageUrl: row.image_url || row.imageUrl || null,
    status: row.status,
    createdAt: row.created_at || row.createdAt,
    updatedAt: row.updated_at || row.updatedAt
  };
}

function createSqliteRepo() {
  let Database;
  try {
    Database = require("better-sqlite3");
  } catch (_err) {
    throw new Error(
      "SQLite selected but better-sqlite3 is not installed. Run: npm install --include=optional"
    );
  }

  const db = new Database(sqlitePath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS news (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      image_url TEXT,
      status TEXT NOT NULL DEFAULT 'draft',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  return {
    type: "sqlite",
    async getById(id) {
      const row = db
        .prepare(
          `SELECT id, title, description, image_url, status, created_at, updated_at
           FROM news
           WHERE id = ?`
        )
        .get(id);
      return mapRow(row);
    },
    async listPublished(limit = 20) {
      const rows = db
        .prepare(
          `SELECT id, title, description, image_url, status, created_at, updated_at
           FROM news
           WHERE status = 'published'
           ORDER BY datetime(created_at) DESC
           LIMIT ?`
        )
        .all(limit);
      return rows.map(mapRow);
    },
    async listAll() {
      const rows = db
        .prepare(
          `SELECT id, title, description, image_url, status, created_at, updated_at
           FROM news
           ORDER BY datetime(created_at) DESC`
        )
        .all();
      return rows.map(mapRow);
    },
    async create(payload) {
      const now = new Date().toISOString();
      const result = db
        .prepare(
          `INSERT INTO news (title, description, image_url, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(payload.title, payload.description, payload.imageUrl, payload.status, now, now);
      return this.getById(result.lastInsertRowid);
    },
    async update(id, payload) {
      const current = db.prepare("SELECT * FROM news WHERE id = ?").get(id);
      if (!current) return null;
      const now = new Date().toISOString();
      db.prepare(
        `UPDATE news
         SET title = ?, description = ?, image_url = ?, status = ?, updated_at = ?
         WHERE id = ?`
      ).run(payload.title, payload.description, payload.imageUrl, payload.status, now, id);
      return this.getById(id);
    },
    async remove(id) {
      const existing = db.prepare("SELECT id FROM news WHERE id = ?").get(id);
      if (!existing) return false;
      db.prepare("DELETE FROM news WHERE id = ?").run(id);
      return true;
    }
  };
}

async function createMysqlRepo() {
  const pool = mysql.createPool({
    host: MYSQL_HOST,
    port: MYSQL_PORT,
    user: MYSQL_USER,
    password: MYSQL_PASSWORD,
    database: MYSQL_DATABASE,
    waitForConnections: true,
    connectionLimit: 10
  });

  await pool.query(`
    CREATE TABLE IF NOT EXISTS news (
      id INT AUTO_INCREMENT PRIMARY KEY,
      title VARCHAR(255) NOT NULL,
      description TEXT NOT NULL,
      image_url VARCHAR(512) NULL,
      status ENUM('draft','published') NOT NULL DEFAULT 'draft',
      created_at VARCHAR(40) NOT NULL,
      updated_at VARCHAR(40) NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  return {
    type: "mysql",
    async getById(id) {
      const [rows] = await pool.query(
        `SELECT id, title, description, image_url, status, created_at, updated_at
         FROM news
         WHERE id = ?`,
        [id]
      );
      return mapRow(rows[0]);
    },
    async listPublished(limit = 20) {
      const [rows] = await pool.query(
        `SELECT id, title, description, image_url, status, created_at, updated_at
         FROM news
         WHERE status = 'published'
         ORDER BY created_at DESC
         LIMIT ?`,
        [limit]
      );
      return rows.map(mapRow);
    },
    async listAll() {
      const [rows] = await pool.query(
        `SELECT id, title, description, image_url, status, created_at, updated_at
         FROM news
         ORDER BY created_at DESC`
      );
      return rows.map(mapRow);
    },
    async create(payload) {
      const now = new Date().toISOString();
      const [result] = await pool.query(
        `INSERT INTO news (title, description, image_url, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [payload.title, payload.description, payload.imageUrl, payload.status, now, now]
      );
      return this.getById(result.insertId);
    },
    async update(id, payload) {
      const [currentRows] = await pool.query("SELECT id FROM news WHERE id = ?", [id]);
      if (!currentRows.length) return null;
      const now = new Date().toISOString();
      await pool.query(
        `UPDATE news
         SET title = ?, description = ?, image_url = ?, status = ?, updated_at = ?
         WHERE id = ?`,
        [payload.title, payload.description, payload.imageUrl, payload.status, now, id]
      );
      return this.getById(id);
    },
    async remove(id) {
      const [existingRows] = await pool.query("SELECT id FROM news WHERE id = ?", [id]);
      if (!existingRows.length) return false;
      await pool.query("DELETE FROM news WHERE id = ?", [id]);
      return true;
    }
  };
}

let repo;

app.get("/health", (_req, res) => {
  res.json({ ok: true, db: repo ? repo.type : DB_CLIENT });
});

app.get(
  "/api/news",
  asyncHandler(async (_req, res) => {
    const rows = await repo.listPublished(20);
    res.json({ items: rows });
  })
);

app.get(
  "/api/admin/news",
  requireAdmin,
  asyncHandler(async (_req, res) => {
    const rows = await repo.listAll();
    res.json({ items: rows });
  })
);

app.post(
  "/api/admin/news",
  requireAdmin,
  upload.single("image"),
  asyncHandler(async (req, res) => {
    const title = (req.body.title || "").trim();
    const description = (req.body.description || "").trim();
    const status = (req.body.status || "draft").trim();

    if (!title) return res.status(400).json({ error: "Title is required" });
    if (!description) return res.status(400).json({ error: "Description is required" });
    if (!isValidStatus(status)) return res.status(400).json({ error: "Invalid status" });

    const imageUrl = req.file ? `/uploads/${req.file.filename}` : null;
    const created = await repo.create({ title, description, status, imageUrl });
    res.status(201).json(created);
  })
);

app.put(
  "/api/admin/news/:id",
  requireAdmin,
  upload.single("image"),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "Invalid id" });

    const current = await repo.getById(id);
    if (!current) return res.status(404).json({ error: "Not found" });

    const title = (req.body.title || current.title).trim();
    const description = (req.body.description || current.description).trim();
    const status = (req.body.status || current.status).trim();

    if (!title) return res.status(400).json({ error: "Title is required" });
    if (!description) return res.status(400).json({ error: "Description is required" });
    if (!isValidStatus(status)) return res.status(400).json({ error: "Invalid status" });

    const imageUrl = req.file ? `/uploads/${req.file.filename}` : current.imageUrl;
    const updated = await repo.update(id, { title, description, status, imageUrl });
    res.json(updated);
  })
);

app.delete(
  "/api/admin/news/:id",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "Invalid id" });
    const removed = await repo.remove(id);
    if (!removed) return res.status(404).json({ error: "Not found" });
    res.status(204).send();
  })
);

app.use((err, _req, res, _next) => {
  // eslint-disable-next-line no-console
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

async function bootstrap() {
  if (DB_CLIENT === "sqlite") {
    repo = createSqliteRepo();
  } else if (DB_CLIENT === "mysql") {
    repo = await createMysqlRepo();
  } else {
    throw new Error(`Unsupported DB_CLIENT: ${DB_CLIENT}`);
  }

  app.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`News backend running on http://localhost:${PORT} (db=${repo.type})`);
  });
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("Failed to start backend:", err);
  process.exit(1);
});
