const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const mysql = require("mysql2/promise");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const sanitizeHtml = require("sanitize-html");

const PORT = Number(process.env.PORT || 4000);
const CORS_ORIGIN = process.env.CORS_ORIGIN || "*";
const NODE_ENV = process.env.NODE_ENV || "development";
const IS_PROD = NODE_ENV === "production";

const DB_CLIENT = (process.env.DB_CLIENT || (IS_PROD ? "mysql" : "sqlite")).toLowerCase();

const MYSQL_HOST = process.env.MYSQL_HOST || "localhost";
const MYSQL_PORT = Number(process.env.MYSQL_PORT || 3306);
const MYSQL_USER = process.env.MYSQL_USER || "mysql";
const MYSQL_PASSWORD = process.env.MYSQL_PASSWORD || "";
const MYSQL_DATABASE = process.env.MYSQL_DATABASE || "mysql";

const SQLITE_FILE = process.env.SQLITE_FILE || "./data/news.db";

const SUPERADMIN_EMAIL = (process.env.SUPERADMIN_EMAIL || "").trim().toLowerCase();
const SUPERADMIN_PASSWORD = process.env.SUPERADMIN_PASSWORD || "";

const JWT_SECRET = process.env.JWT_SECRET || (IS_PROD ? "" : "dev-secret-change");
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "8h";
const JWT_FIRST_USE_EXPIRES_IN = process.env.JWT_FIRST_USE_EXPIRES_IN || "15m";

if (IS_PROD && (!JWT_SECRET || JWT_SECRET === "dev-secret-change")) {
  throw new Error("JWT_SECRET is required in production");
}

const app = express();
const rootDir = __dirname;
const uploadsDir = path.join(rootDir, "uploads");
const dataDir = path.join(rootDir, "data");
const sqlitePath = path.isAbsolute(SQLITE_FILE) ? SQLITE_FILE : path.join(rootDir, SQLITE_FILE);

fs.mkdirSync(uploadsDir, { recursive: true });
fs.mkdirSync(dataDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const allowed = [".jpg", ".jpeg", ".png", ".webp"];
    const ext = path.extname(file.originalname).toLowerCase();
    const safeExt = allowed.includes(ext) ? ext : ".jpg";
    const base = path
      .basename(file.originalname, ext)
      .replace(/[^a-zA-Z0-9_-]/g, "-")
      .slice(0, 50);
    cb(null, `${Date.now()}-${base}${safeExt}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ["image/jpeg", "image/png", "image/webp"];
    if (!allowed.includes((file.mimetype || "").toLowerCase())) {
      cb(new Error("Invalid file type. Only JPG, PNG and WEBP are allowed"));
      return;
    }
    cb(null, true);
  }
});

app.use(cors({ origin: CORS_ORIGIN }));
app.use(express.json());
app.use("/uploads", express.static(uploadsDir, {
  setHeaders: (res) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
  }
}));
app.use("/admin", express.static(path.join(rootDir, "public", "admin")));

function asyncHandler(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function validatePassword(password) {
  return typeof password === "string" && password.length >= 8;
}

function sanitizeDescriptionHtml(input) {
  return sanitizeHtml(String(input || ""), {
    allowedTags: [
      "p", "br", "strong", "em", "u", "s",
      "ul", "ol", "li", "blockquote",
      "h3", "h4", "a"
    ],
    allowedAttributes: {
      a: ["href", "target", "rel"]
    },
    allowedSchemes: ["http", "https", "mailto", "tel"],
    transformTags: {
      a: sanitizeHtml.simpleTransform("a", { rel: "noopener noreferrer" })
    }
  }).trim();
}

function htmlHasReadableText(html) {
  var txt = sanitizeHtml(String(html || ""), { allowedTags: [], allowedAttributes: {} }).trim();
  return txt.length > 0;
}

function randomTempPassword() {
  return crypto.randomBytes(9).toString("base64url");
}

function mapNews(row) {
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

function mapUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    isActive: Boolean(row.is_active ?? row.isActive),
    mustChangePassword: Boolean(row.must_change_password ?? row.mustChangePassword),
    createdAt: row.created_at || row.createdAt,
    updatedAt: row.updated_at || row.updatedAt
  };
}

function sanitizeUser(user) {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    isActive: Boolean(user.isActive),
    mustChangePassword: Boolean(user.mustChangePassword)
  };
}

function signAccessToken(user) {
  return jwt.sign(
    {
      type: "access",
      sub: String(user.id),
      role: user.role,
      email: user.email
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

function signFirstUseToken(user) {
  return jwt.sign(
    {
      type: "first_use",
      sub: String(user.id),
      email: user.email
    },
    JWT_SECRET,
    { expiresIn: JWT_FIRST_USE_EXPIRES_IN }
  );
}

function decodeBearerToken(req) {
  const header = req.headers.authorization || "";
  const parts = header.split(" ");
  if (parts.length !== 2 || parts[0] !== "Bearer") return null;
  return parts[1];
}

let store;

const requireAuth = asyncHandler(async (req, res, next) => {
  const token = decodeBearerToken(req);
  if (!token) return res.status(401).json({ error: "Unauthorized" });

  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET);
  } catch (_err) {
    return res.status(401).json({ error: "Invalid token" });
  }

  if (payload.type !== "access") return res.status(401).json({ error: "Invalid token type" });

  const user = await store.usersGetById(Number(payload.sub));
  if (!user || !user.isActive) return res.status(401).json({ error: "Unauthorized" });

  req.user = user;
  next();
});

function requireSuperAdmin(req, res, next) {
  if (!req.user || req.user.role !== "superadmin") {
    return res.status(403).json({ error: "Forbidden" });
  }
  next();
}

function createSqliteStore() {
  let Database;
  try {
    Database = require("better-sqlite3");
  } catch (_err) {
    throw new Error("SQLite selected but better-sqlite3 is not installed. Run: npm install --include=optional");
  }

  const db = new Database(sqlitePath);
  db.pragma("journal_mode = WAL");

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

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'admin',
      is_active INTEGER NOT NULL DEFAULT 1,
      must_change_password INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  return {
    type: "sqlite",
    async newsGetById(id) {
      return mapNews(
        db.prepare(
          "SELECT id, title, description, image_url, status, created_at, updated_at FROM news WHERE id = ?"
        ).get(id)
      );
    },
    async newsListPublished(limit = 20) {
      const rows = db.prepare(
        "SELECT id, title, description, image_url, status, created_at, updated_at FROM news WHERE status = 'published' ORDER BY datetime(created_at) DESC LIMIT ?"
      ).all(limit);
      return rows.map(mapNews);
    },
    async newsListAll() {
      const rows = db.prepare(
        "SELECT id, title, description, image_url, status, created_at, updated_at FROM news ORDER BY datetime(created_at) DESC"
      ).all();
      return rows.map(mapNews);
    },
    async newsCreate(payload) {
      const now = nowIso();
      const result = db.prepare(
        "INSERT INTO news (title, description, image_url, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
      ).run(payload.title, payload.description, payload.imageUrl, payload.status, now, now);
      return this.newsGetById(result.lastInsertRowid);
    },
    async newsUpdate(id, payload) {
      const row = db.prepare("SELECT id FROM news WHERE id = ?").get(id);
      if (!row) return null;
      const now = nowIso();
      db.prepare(
        "UPDATE news SET title = ?, description = ?, image_url = ?, status = ?, updated_at = ? WHERE id = ?"
      ).run(payload.title, payload.description, payload.imageUrl, payload.status, now, id);
      return this.newsGetById(id);
    },
    async newsDelete(id) {
      const result = db.prepare("DELETE FROM news WHERE id = ?").run(id);
      return result.changes > 0;
    },

    async usersGetById(id) {
      return mapUser(
        db.prepare(
          "SELECT id, email, role, is_active, must_change_password, created_at, updated_at FROM users WHERE id = ?"
        ).get(id)
      );
    },
    async usersGetByEmail(email) {
      return db.prepare("SELECT * FROM users WHERE email = ?").get(email) || null;
    },
    async usersList() {
      const rows = db.prepare(
        "SELECT id, email, role, is_active, must_change_password, created_at, updated_at FROM users ORDER BY datetime(created_at) DESC"
      ).all();
      return rows.map(mapUser);
    },
    async usersCreate(payload) {
      const now = nowIso();
      const result = db.prepare(
        "INSERT INTO users (email, password_hash, role, is_active, must_change_password, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
      ).run(payload.email, payload.passwordHash, payload.role, payload.isActive ? 1 : 0, payload.mustChangePassword ? 1 : 0, now, now);
      return this.usersGetById(result.lastInsertRowid);
    },
    async usersUpdatePassword(id, passwordHash, mustChangePassword) {
      const now = nowIso();
      const result = db.prepare(
        "UPDATE users SET password_hash = ?, must_change_password = ?, updated_at = ? WHERE id = ?"
      ).run(passwordHash, mustChangePassword ? 1 : 0, now, id);
      return result.changes > 0;
    },
    async usersSetActive(id, isActive) {
      const now = nowIso();
      const result = db.prepare("UPDATE users SET is_active = ?, updated_at = ? WHERE id = ?").run(isActive ? 1 : 0, now, id);
      return result.changes > 0;
    },
    async usersCountActiveSuperAdmins() {
      const row = db.prepare("SELECT COUNT(*) AS total FROM users WHERE role = 'superadmin' AND is_active = 1").get();
      return Number(row.total || 0);
    },
    async usersCountAll() {
      const row = db.prepare("SELECT COUNT(*) AS total FROM users").get();
      return Number(row.total || 0);
    }
  };
}

async function createMysqlStore() {
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

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id INT AUTO_INCREMENT PRIMARY KEY,
      email VARCHAR(255) NOT NULL UNIQUE,
      password_hash VARCHAR(255) NOT NULL,
      role ENUM('admin','superadmin') NOT NULL DEFAULT 'admin',
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      must_change_password TINYINT(1) NOT NULL DEFAULT 1,
      created_at VARCHAR(40) NOT NULL,
      updated_at VARCHAR(40) NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  return {
    type: "mysql",
    async newsGetById(id) {
      const [rows] = await pool.query(
        "SELECT id, title, description, image_url, status, created_at, updated_at FROM news WHERE id = ?",
        [id]
      );
      return mapNews(rows[0]);
    },
    async newsListPublished(limit = 20) {
      const [rows] = await pool.query(
        "SELECT id, title, description, image_url, status, created_at, updated_at FROM news WHERE status = 'published' ORDER BY created_at DESC LIMIT ?",
        [limit]
      );
      return rows.map(mapNews);
    },
    async newsListAll() {
      const [rows] = await pool.query(
        "SELECT id, title, description, image_url, status, created_at, updated_at FROM news ORDER BY created_at DESC"
      );
      return rows.map(mapNews);
    },
    async newsCreate(payload) {
      const now = nowIso();
      const [result] = await pool.query(
        "INSERT INTO news (title, description, image_url, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
        [payload.title, payload.description, payload.imageUrl, payload.status, now, now]
      );
      return this.newsGetById(result.insertId);
    },
    async newsUpdate(id, payload) {
      const [exists] = await pool.query("SELECT id FROM news WHERE id = ?", [id]);
      if (!exists.length) return null;
      const now = nowIso();
      await pool.query(
        "UPDATE news SET title = ?, description = ?, image_url = ?, status = ?, updated_at = ? WHERE id = ?",
        [payload.title, payload.description, payload.imageUrl, payload.status, now, id]
      );
      return this.newsGetById(id);
    },
    async newsDelete(id) {
      const [result] = await pool.query("DELETE FROM news WHERE id = ?", [id]);
      return result.affectedRows > 0;
    },

    async usersGetById(id) {
      const [rows] = await pool.query(
        "SELECT id, email, role, is_active, must_change_password, created_at, updated_at FROM users WHERE id = ?",
        [id]
      );
      return mapUser(rows[0]);
    },
    async usersGetByEmail(email) {
      const [rows] = await pool.query("SELECT * FROM users WHERE email = ?", [email]);
      return rows[0] || null;
    },
    async usersList() {
      const [rows] = await pool.query(
        "SELECT id, email, role, is_active, must_change_password, created_at, updated_at FROM users ORDER BY created_at DESC"
      );
      return rows.map(mapUser);
    },
    async usersCreate(payload) {
      const now = nowIso();
      const [result] = await pool.query(
        "INSERT INTO users (email, password_hash, role, is_active, must_change_password, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [payload.email, payload.passwordHash, payload.role, payload.isActive ? 1 : 0, payload.mustChangePassword ? 1 : 0, now, now]
      );
      return this.usersGetById(result.insertId);
    },
    async usersUpdatePassword(id, passwordHash, mustChangePassword) {
      const now = nowIso();
      const [result] = await pool.query(
        "UPDATE users SET password_hash = ?, must_change_password = ?, updated_at = ? WHERE id = ?",
        [passwordHash, mustChangePassword ? 1 : 0, now, id]
      );
      return result.affectedRows > 0;
    },
    async usersSetActive(id, isActive) {
      const now = nowIso();
      const [result] = await pool.query(
        "UPDATE users SET is_active = ?, updated_at = ? WHERE id = ?",
        [isActive ? 1 : 0, now, id]
      );
      return result.affectedRows > 0;
    },
    async usersCountActiveSuperAdmins() {
      const [rows] = await pool.query("SELECT COUNT(*) AS total FROM users WHERE role = 'superadmin' AND is_active = 1");
      return Number(rows[0].total || 0);
    },
    async usersCountAll() {
      const [rows] = await pool.query("SELECT COUNT(*) AS total FROM users");
      return Number(rows[0].total || 0);
    }
  };
}

async function ensureInitialSuperAdmin() {
  const totalUsers = await store.usersCountAll();
  if (totalUsers > 0) return;

  if (!SUPERADMIN_EMAIL || !SUPERADMIN_PASSWORD) {
    if (IS_PROD) {
      throw new Error("First boot requires SUPERADMIN_EMAIL and SUPERADMIN_PASSWORD in production");
    }

    const fallbackEmail = "admin@local.test";
    const fallbackPassword = "ChangeMe123!";
    const hash = await bcrypt.hash(fallbackPassword, 10);
    await store.usersCreate({
      email: fallbackEmail,
      passwordHash: hash,
      role: "superadmin",
      isActive: true,
      mustChangePassword: true
    });
    // eslint-disable-next-line no-console
    console.warn(`Created local superadmin ${fallbackEmail} with temporary password ${fallbackPassword}`);
    return;
  }

  const hash = await bcrypt.hash(SUPERADMIN_PASSWORD, 10);
  await store.usersCreate({
    email: SUPERADMIN_EMAIL,
    passwordHash: hash,
    role: "superadmin",
    isActive: true,
    mustChangePassword: true
  });
}

app.get("/health", (_req, res) => {
  res.json({ ok: true, db: store ? store.type : DB_CLIENT });
});

app.post(
  "/api/auth/login",
  asyncHandler(async (req, res) => {
    const email = normalizeEmail(req.body.email);
    const password = String(req.body.password || "");

    if (!email || !password) return res.status(400).json({ error: "Email and password are required" });

    const userRow = await store.usersGetByEmail(email);
    if (!userRow) return res.status(401).json({ error: "Invalid credentials" });

    const isActive = Boolean(userRow.is_active ?? userRow.isActive);
    if (!isActive) return res.status(403).json({ error: "User is disabled" });

    const matches = await bcrypt.compare(password, userRow.password_hash);
    if (!matches) return res.status(401).json({ error: "Invalid credentials" });

    const user = mapUser(userRow);
    if (!user) return res.status(401).json({ error: "Invalid credentials" });

    if (user.mustChangePassword) {
      const changeToken = signFirstUseToken(user);
      return res.json({
        mustChangePassword: true,
        changeToken,
        user: sanitizeUser(user)
      });
    }

    const token = signAccessToken(user);
    res.json({ token, user: sanitizeUser(user) });
  })
);

app.post(
  "/api/auth/change-password-first-use",
  asyncHandler(async (req, res) => {
    const changeToken = String(req.body.changeToken || "");
    const newPassword = String(req.body.newPassword || "");

    if (!changeToken || !newPassword) return res.status(400).json({ error: "changeToken and newPassword are required" });
    if (!validatePassword(newPassword)) return res.status(400).json({ error: "Password must have at least 8 characters" });

    let payload;
    try {
      payload = jwt.verify(changeToken, JWT_SECRET);
    } catch (_err) {
      return res.status(401).json({ error: "Invalid or expired token" });
    }

    if (payload.type !== "first_use") return res.status(401).json({ error: "Invalid token type" });

    const user = await store.usersGetById(Number(payload.sub));
    if (!user || !user.isActive) return res.status(401).json({ error: "Unauthorized" });

    const hash = await bcrypt.hash(newPassword, 10);
    await store.usersUpdatePassword(user.id, hash, false);

    const updatedUser = await store.usersGetById(user.id);
    const token = signAccessToken(updatedUser);

    res.json({ token, user: sanitizeUser(updatedUser) });
  })
);

app.get(
  "/api/auth/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({ user: sanitizeUser(req.user) });
  })
);

app.post(
  "/api/auth/change-password",
  requireAuth,
  asyncHandler(async (req, res) => {
    const currentPassword = String(req.body.currentPassword || "");
    const newPassword = String(req.body.newPassword || "");

    if (!currentPassword || !newPassword) return res.status(400).json({ error: "currentPassword and newPassword are required" });
    if (!validatePassword(newPassword)) return res.status(400).json({ error: "Password must have at least 8 characters" });

    const userRow = await store.usersGetByEmail(req.user.email);
    if (!userRow) return res.status(404).json({ error: "User not found" });

    const matches = await bcrypt.compare(currentPassword, userRow.password_hash);
    if (!matches) return res.status(401).json({ error: "Current password is invalid" });

    const hash = await bcrypt.hash(newPassword, 10);
    await store.usersUpdatePassword(req.user.id, hash, false);

    res.json({ ok: true });
  })
);

app.get(
  "/api/news",
  asyncHandler(async (_req, res) => {
    const items = await store.newsListPublished(20);
    res.json({ items });
  })
);

app.get(
  "/api/news/:id",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "Invalid id" });

    const item = await store.newsGetById(id);
    if (!item || item.status !== "published") {
      return res.status(404).json({ error: "Not found" });
    }

    res.json({ item });
  })
);

app.get(
  "/api/admin/news",
  requireAuth,
  asyncHandler(async (_req, res) => {
    const items = await store.newsListAll();
    res.json({ items });
  })
);

app.post(
  "/api/admin/news",
  requireAuth,
  upload.single("image"),
  asyncHandler(async (req, res) => {
    const title = String(req.body.title || "").trim();
    const description = sanitizeDescriptionHtml(req.body.description || "");
    const status = String(req.body.status || "draft").trim();

    if (!title) return res.status(400).json({ error: "Title is required" });
    if (!htmlHasReadableText(description)) return res.status(400).json({ error: "Description is required" });
    if (!["draft", "published"].includes(status)) return res.status(400).json({ error: "Invalid status" });

    const imageUrl = req.file ? `/uploads/${req.file.filename}` : null;
    const created = await store.newsCreate({ title, description, status, imageUrl });
    res.status(201).json(created);
  })
);

app.put(
  "/api/admin/news/:id",
  requireAuth,
  upload.single("image"),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "Invalid id" });

    const current = await store.newsGetById(id);
    if (!current) return res.status(404).json({ error: "Not found" });

    const title = String(req.body.title || current.title).trim();
    const rawDescription = (typeof req.body.description === "undefined") ? current.description : req.body.description;
    const description = sanitizeDescriptionHtml(rawDescription || "");
    const status = String(req.body.status || current.status).trim();

    if (!title) return res.status(400).json({ error: "Title is required" });
    if (!htmlHasReadableText(description)) return res.status(400).json({ error: "Description is required" });
    if (!["draft", "published"].includes(status)) return res.status(400).json({ error: "Invalid status" });

    const imageUrl = req.file ? `/uploads/${req.file.filename}` : current.imageUrl;
    const updated = await store.newsUpdate(id, { title, description, status, imageUrl });
    res.json(updated);
  })
);

app.delete(
  "/api/admin/news/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "Invalid id" });

    const removed = await store.newsDelete(id);
    if (!removed) return res.status(404).json({ error: "Not found" });

    res.status(204).send();
  })
);

app.get(
  "/api/admin/users",
  requireAuth,
  requireSuperAdmin,
  asyncHandler(async (_req, res) => {
    const users = await store.usersList();
    res.json({ items: users });
  })
);

app.post(
  "/api/admin/users",
  requireAuth,
  requireSuperAdmin,
  asyncHandler(async (req, res) => {
    const email = normalizeEmail(req.body.email);
    const role = String(req.body.role || "admin").trim();

    if (!email) return res.status(400).json({ error: "Email is required" });
    if (!["admin", "superadmin"].includes(role)) return res.status(400).json({ error: "Invalid role" });

    const exists = await store.usersGetByEmail(email);
    if (exists) return res.status(409).json({ error: "User already exists" });

    const tempPassword = randomTempPassword();
    const hash = await bcrypt.hash(tempPassword, 10);

    const created = await store.usersCreate({
      email,
      passwordHash: hash,
      role,
      isActive: true,
      mustChangePassword: true
    });

    res.status(201).json({ user: created, tempPassword });
  })
);

app.patch(
  "/api/admin/users/:id/status",
  requireAuth,
  requireSuperAdmin,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const isActive = Boolean(req.body.isActive);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "Invalid id" });

    const target = await store.usersGetById(id);
    if (!target) return res.status(404).json({ error: "User not found" });

    if (target.id === req.user.id && !isActive) {
      return res.status(400).json({ error: "Cannot disable your own user" });
    }

    if (target.role === "superadmin" && !isActive) {
      const activeSuperAdmins = await store.usersCountActiveSuperAdmins();
      if (activeSuperAdmins <= 1) {
        return res.status(400).json({ error: "Cannot disable the last active superadmin" });
      }
    }

    await store.usersSetActive(id, isActive);
    const updated = await store.usersGetById(id);
    res.json({ user: updated });
  })
);

app.post(
  "/api/admin/users/:id/reset-password",
  requireAuth,
  requireSuperAdmin,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "Invalid id" });

    const user = await store.usersGetById(id);
    if (!user) return res.status(404).json({ error: "User not found" });

    const tempPassword = randomTempPassword();
    const hash = await bcrypt.hash(tempPassword, 10);

    await store.usersUpdatePassword(id, hash, true);

    res.json({ user: await store.usersGetById(id), tempPassword });
  })
);

app.use((err, _req, res, _next) => {
  // eslint-disable-next-line no-console
  console.error(err);
  const msg = err && err.message ? err.message : "Internal server error";
  if (/Invalid file type/.test(msg)) {
    return res.status(400).json({ error: msg });
  }
  res.status(500).json({ error: "Internal server error" });
});

async function bootstrap() {
  if (DB_CLIENT === "sqlite") {
    store = createSqliteStore();
  } else if (DB_CLIENT === "mysql") {
    store = await createMysqlStore();
  } else {
    throw new Error(`Unsupported DB_CLIENT: ${DB_CLIENT}`);
  }

  await ensureInitialSuperAdmin();

  app.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`News backend running on http://localhost:${PORT} (db=${store.type})`);
  });
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("Failed to start backend:", err);
  process.exit(1);
});
