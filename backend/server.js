const path = require("path");
const fs = require("fs");
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const mysql = require("mysql2/promise");

const PORT = Number(process.env.PORT || 4000);
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "change-this-token";
const CORS_ORIGIN = process.env.CORS_ORIGIN || "*";

const MYSQL_HOST = process.env.MYSQL_HOST || "localhost";
const MYSQL_PORT = Number(process.env.MYSQL_PORT || 3306);
const MYSQL_USER = process.env.MYSQL_USER || "mysql";
const MYSQL_PASSWORD = process.env.MYSQL_PASSWORD || "";
const MYSQL_DATABASE = process.env.MYSQL_DATABASE || "mysql";

const app = express();
const rootDir = __dirname;
const uploadsDir = path.join(rootDir, "uploads");

fs.mkdirSync(uploadsDir, { recursive: true });

const pool = mysql.createPool({
  host: MYSQL_HOST,
  port: MYSQL_PORT,
  user: MYSQL_USER,
  password: MYSQL_PASSWORD,
  database: MYSQL_DATABASE,
  waitForConnections: true,
  connectionLimit: 10
});

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

async function getNewsById(id) {
  const [rows] = await pool.query(
    `SELECT id, title, description, image_url AS imageUrl, status, created_at AS createdAt, updated_at AS updatedAt
     FROM news
     WHERE id = ?`,
    [id]
  );
  return rows[0] || null;
}

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.get(
  "/api/news",
  asyncHandler(async (_req, res) => {
    const [rows] = await pool.query(
      `SELECT id, title, description, image_url AS imageUrl, status, created_at AS createdAt, updated_at AS updatedAt
       FROM news
       WHERE status = 'published'
       ORDER BY created_at DESC
       LIMIT 20`
    );
    res.json({ items: rows });
  })
);

app.get(
  "/api/admin/news",
  requireAdmin,
  asyncHandler(async (_req, res) => {
    const [rows] = await pool.query(
      `SELECT id, title, description, image_url AS imageUrl, status, created_at AS createdAt, updated_at AS updatedAt
       FROM news
       ORDER BY created_at DESC`
    );
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
    const now = new Date().toISOString();

    const [result] = await pool.query(
      `INSERT INTO news (title, description, image_url, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [title, description, imageUrl, status, now, now]
    );

    const created = await getNewsById(result.insertId);
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

    const [currentRows] = await pool.query("SELECT * FROM news WHERE id = ?", [id]);
    const current = currentRows[0];
    if (!current) return res.status(404).json({ error: "Not found" });

    const title = (req.body.title || current.title).trim();
    const description = (req.body.description || current.description).trim();
    const status = (req.body.status || current.status).trim();

    if (!title) return res.status(400).json({ error: "Title is required" });
    if (!description) return res.status(400).json({ error: "Description is required" });
    if (!isValidStatus(status)) return res.status(400).json({ error: "Invalid status" });

    const imageUrl = req.file ? `/uploads/${req.file.filename}` : current.image_url;
    const now = new Date().toISOString();

    await pool.query(
      `UPDATE news
       SET title = ?, description = ?, image_url = ?, status = ?, updated_at = ?
       WHERE id = ?`,
      [title, description, imageUrl, status, now, id]
    );

    const updated = await getNewsById(id);
    res.json(updated);
  })
);

app.delete(
  "/api/admin/news/:id",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "Invalid id" });

    const [existingRows] = await pool.query("SELECT id FROM news WHERE id = ?", [id]);
    if (!existingRows.length) return res.status(404).json({ error: "Not found" });

    await pool.query("DELETE FROM news WHERE id = ?", [id]);
    res.status(204).send();
  })
);

app.use((err, _req, res, _next) => {
  // eslint-disable-next-line no-console
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

async function bootstrap() {
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

  app.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`News backend running on http://localhost:${PORT}`);
  });
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("Failed to start backend:", err);
  process.exit(1);
});
