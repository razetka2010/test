const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const { Pool } = require('pg');

const app = express();

// Middleware
const allowedOrigin = process.env.FRONTEND_ORIGIN || 'https://znaniesevera.vercel.app';
app.use(cors({ origin: allowedOrigin, credentials: true }));
app.use(express.json({ limit: '100kb' }));
app.disable('x-powered-by');
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com; font-src 'self' https://cdnjs.cloudflare.com; img-src 'self' data: https:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
    next();
});

const sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret) {
    console.warn('SESSION_SECRET не задан: админские сессии не будут работать в production');
}

const loginAttempts = new Map();
const sessionCookie = 'admin_session';

function parseCookies(req) {
    return Object.fromEntries((req.headers.cookie || '').split(';').filter(Boolean).map(cookie => {
        const separator = cookie.indexOf('=');
        return [cookie.slice(0, separator).trim(), decodeURIComponent(cookie.slice(separator + 1).trim())];
    }));
}

function createSession(email) {
    const payload = Buffer.from(JSON.stringify({ email, exp: Date.now() + 8 * 60 * 60 * 1000 })).toString('base64url');
    const signature = crypto.createHmac('sha256', sessionSecret || 'missing-secret').update(payload).digest('base64url');
    return `${payload}.${signature}`;
}

function getSession(req) {
    if (!sessionSecret) return null;
    const token = parseCookies(req)[sessionCookie];
    if (!token) return null;
    const [payload, signature] = token.split('.');
    if (!payload || !signature) return null;
    const expected = crypto.createHmac('sha256', sessionSecret).update(payload).digest('base64url');
    if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
    try {
        const session = JSON.parse(Buffer.from(payload, 'base64url').toString());
        return session.exp > Date.now() ? session : null;
    } catch (error) {
        return null;
    }
}

function requireAdmin(req, res, next) {
    if (!getSession(req)) return res.status(401).json({ error: 'Требуется авторизация' });
    next();
}

function isProtectedApiRequest(req) {
    if (!req.path.startsWith('/api/')) return false;
    if (req.path === '/api/admin/login' || req.path === '/api/maintenance-status') return false;
    if (req.path.startsWith('/api/admin/')) return true;
    if (req.path.startsWith('/api/profiles') || req.path.startsWith('/api/projects')) return true;
    if (!['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) return false;
    return /^\/api\/(posts|vacancies|projects|profiles|documents)(\/|$)/.test(req.path);
}

function isValidHttpUrl(value) {
    if (!value) return true;
    try {
        const url = new URL(value);
        return url.protocol === 'http:' || url.protocol === 'https:';
    } catch (error) {
        return false;
    }
}

app.use((req, res, next) => {
    if (!req.body || typeof req.body !== 'object') return next();
    const stringValues = Object.values(req.body).filter(value => typeof value === 'string');
    if (stringValues.some(value => value.length > 10000)) {
        return res.status(400).json({ error: 'Слишком длинное значение' });
    }
    const urlFields = ['image_url', 'file_url', 'site_url', 'github_url', 'portfolio'];
    if (urlFields.some(field => req.body[field] && !isValidHttpUrl(req.body[field]))) {
        return res.status(400).json({ error: 'Разрешены только корректные HTTP/HTTPS-ссылки' });
    }
    if (req.path === '/api/applications' && req.method === 'POST') {
        const { vacancy_title, name, email, contact, message } = req.body;
        if (![vacancy_title, name, email, contact, message].every(value => typeof value === 'string' && value.trim())) {
            return res.status(400).json({ error: 'Заполните все обязательные поля' });
        }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
            return res.status(400).json({ error: 'Укажите корректный email' });
        }
    }
    const requiredByRoute = [
        [/^\/api\/posts(?:\/\d+)?$/, ['title', 'category', 'excerpt', 'content']],
        [/^\/api\/vacancies(?:\/\d+)?$/, ['title', 'description']],
        [/^\/api\/projects(?:\/\d+)?$/, ['name']],
        [/^\/api\/documents(?:\/\d+)?$/, ['title', 'category', 'file_name', 'file_url']],
        [/^\/api\/profiles(?:\/\d+)?$/, ['full_name', 'role']]
    ].find(([pattern]) => pattern.test(req.path));
    if (requiredByRoute && ['POST', 'PUT'].includes(req.method)) {
        const missing = requiredByRoute[1].filter(field => typeof req.body[field] !== 'string' || !req.body[field].trim());
        if (missing.length) return res.status(400).json({ error: `Заполните обязательные поля: ${missing.join(', ')}` });
    }
    next();
});

app.use((req, res, next) => isProtectedApiRequest(req) ? requireAdmin(req, res, next) : next());

// Настройка базы данных
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// Функция для получения настроек
async function getSetting(key) {
    try {
        const result = await pool.query(
            'SELECT setting_value FROM site_settings WHERE setting_key = $1',
            [key]
        );
        return result.rows[0]?.setting_value || null;
    } catch (err) {
        console.error('Ошибка получения настройки:', err);
        return null;
    }
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
    const hash = crypto.scryptSync(password, salt, 64).toString('hex');
    return `scrypt$${salt}$${hash}`;
}

function verifyPassword(password, storedPassword) {
    if (!storedPassword) return false;
    if (!storedPassword.startsWith('scrypt$')) return password === storedPassword;
    const [, salt, storedHash] = storedPassword.split('$');
    if (!salt || !storedHash) return false;
    const calculatedHash = crypto.scryptSync(password, salt, 64).toString('hex');
    return calculatedHash.length === storedHash.length && crypto.timingSafeEqual(
        Buffer.from(calculatedHash),
        Buffer.from(storedHash)
    );
}

// Middleware для проверки maintenance mode
app.use(async (req, res, next) => {
    if (req.path.startsWith('/api/')) {
        return next();
    }
    if (req.path.includes('admin.html') || req.path.includes('maintenance.html')) {
        return next();
    }
    
    try {
        const maintenanceMode = await getSetting('maintenance_mode');
        if (maintenanceMode === '1') {
            const maintenancePages = await getSetting('maintenance_pages');
            let currentPage = 'index';
            if (req.path !== '/' && req.path !== '') {
                currentPage = req.path.replace('/', '').replace('.html', '').toLowerCase();
            }
            let blockedPages = [];
            if (maintenancePages && maintenancePages.trim()) {
                blockedPages = maintenancePages.split(',').map(p => p.trim().toLowerCase());
            }
            const shouldBlock = blockedPages.length === 0 || blockedPages.includes(currentPage);
            if (shouldBlock) {
                const maintenanceHtmlPath = path.join(__dirname, '../public/maintenance.html');
                if (fs.existsSync(maintenanceHtmlPath)) {
                    const maintenanceHtml = fs.readFileSync(maintenanceHtmlPath, 'utf8');
                    return res.send(maintenanceHtml);
                } else {
                    return res.status(503).send('Сайт на техническом обслуживании');
                }
            }
        }
        next();
    } catch (err) {
        console.error('Ошибка maintenance middleware:', err);
        next();
    }
});

// Sitemap и robots.txt
app.get('/sitemap.xml', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/sitemap.xml'));
});

app.get('/robots.txt', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/robots.txt'));
});


// ============ API МАРШРУТЫ ============

app.get('/api/maintenance-status', async (req, res) => {
    try {
        const maintenanceMode = await getSetting('maintenance_mode');
        const maintenancePages = await getSetting('maintenance_pages');
        res.setHeader('Cache-Control', 'no-store');
        res.json({
            maintenance_mode: maintenanceMode === '1',
            maintenance_pages: maintenancePages || ''
        });
    } catch (err) {
        res.status(500).json({ error: 'Не удалось получить статус сайта' });
    }
});

// Настройки
app.get('/api/admin/settings', async (req, res) => {
    try {
        const maintenanceMode = await getSetting('maintenance_mode');
        const maintenancePages = await getSetting('maintenance_pages');
        res.json({
            maintenance_mode: maintenanceMode === '1',
            maintenance_pages: maintenancePages || ''
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/admin/settings', async (req, res) => {
    try {
        const { maintenance_mode, maintenance_pages } = req.body;
        await pool.query(
            'UPDATE site_settings SET setting_value = $1 WHERE setting_key = $2',
            [maintenance_mode ? '1' : '0', 'maintenance_mode']
        );
        await pool.query(
            'UPDATE site_settings SET setting_value = $1 WHERE setting_key = $2',
            [maintenance_pages || '', 'maintenance_pages']
        );
        res.json({ success: true, message: 'Настройки сохранены' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Посты
app.get('/api/posts', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM posts ORDER BY created_at DESC');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/posts/:id', async (req, res) => {
    try {
        const { id } = req.params;
        await pool.query('UPDATE posts SET views = views + 1 WHERE id = $1', [id]);
        const result = await pool.query('SELECT * FROM posts WHERE id = $1', [id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Пост не найден' });
        }
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/posts', async (req, res) => {
    try {
        const { title, category, date, excerpt, content, image_url } = req.body;
        const result = await pool.query(
            'INSERT INTO posts (title, category, date, excerpt, content, image_url, views) VALUES ($1, $2, $3, $4, $5, $6, 0) RETURNING *',
            [title, category, date, excerpt, content, image_url || null]
        );
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/posts/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { title, category, date, excerpt, content, image_url } = req.body;
        const result = await pool.query(
            'UPDATE posts SET title=$1, category=$2, date=$3, excerpt=$4, content=$5, image_url=$6 WHERE id=$7 RETURNING *',
            [title, category, date, excerpt, content, image_url || null, id]
        );
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/posts/:id', async (req, res) => {
    try {
        const { id } = req.params;
        await pool.query('DELETE FROM posts WHERE id = $1', [id]);
        res.json({ message: 'Пост удален' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Вакансии
app.get('/api/vacancies', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM vacancies WHERE is_active = true ORDER BY created_at DESC');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/admin/vacancies', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM vacancies ORDER BY created_at DESC');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/vacancies/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query('SELECT * FROM vacancies WHERE id = $1', [id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Вакансия не найдена' });
        }
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/vacancies', async (req, res) => {
    try {
        const { title, icon, tags, description, is_active } = req.body;
        const result = await pool.query(
            'INSERT INTO vacancies (title, icon, tags, description, is_active) VALUES ($1, $2, $3, $4, $5) RETURNING *',
            [title, icon, tags, description, is_active]
        );
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/vacancies/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { title, icon, tags, description, is_active } = req.body;
        const result = await pool.query(
            'UPDATE vacancies SET title=$1, icon=$2, tags=$3, description=$4, is_active=$5 WHERE id=$6 RETURNING *',
            [title, icon, tags, description, is_active, id]
        );
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/vacancies/:id', async (req, res) => {
    try {
        const { id } = req.params;
        await pool.query('DELETE FROM vacancies WHERE id = $1', [id]);
        res.json({ message: 'Вакансия удалена' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Отклики
app.post('/api/applications', async (req, res) => {
    try {
        const { vacancy_title, name, email, contact, message, portfolio } = req.body;
        const result = await pool.query(
            `INSERT INTO applications (vacancy_title, name, email, contact, message, portfolio, status) 
             VALUES ($1, $2, $3, $4, $5, $6, 'new') RETURNING *`,
            [vacancy_title, name, email, contact, message, portfolio]
        );
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/admin/applications', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM applications ORDER BY created_at DESC');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/admin/applications/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;
        const result = await pool.query(
            'UPDATE applications SET status=$1 WHERE id=$2 RETURNING *',
            [status, id]
        );
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Админ логин
app.post('/api/admin/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const normalizedEmail = String(email || '').trim().toLowerCase();
        const attempt = loginAttempts.get(normalizedEmail) || { count: 0, resetAt: Date.now() + 15 * 60 * 1000 };
        if (attempt.resetAt <= Date.now()) {
            attempt.count = 0;
            attempt.resetAt = Date.now() + 15 * 60 * 1000;
        }
        if (attempt.count >= 5) {
            return res.status(429).json({ error: 'Слишком много попыток. Попробуйте позже.' });
        }

        if (!normalizedEmail || typeof password !== 'string' || password.length < 1) {
            return res.status(400).json({ error: 'Введите email и пароль' });
        }

        const result = await pool.query('SELECT * FROM admins WHERE LOWER(email) = $1', [normalizedEmail]);
        if (result.rows.length === 0) {
            attempt.count += 1;
            loginAttempts.set(normalizedEmail, attempt);
            return res.status(401).json({ error: 'Неверный email или пароль' });
        }
        const admin = result.rows[0];
        if (verifyPassword(password, admin.password_hash)) {
            loginAttempts.delete(normalizedEmail);
            if (!admin.password_hash.startsWith('scrypt$')) {
                await pool.query('UPDATE admins SET password_hash = $1 WHERE id = $2', [hashPassword(password), admin.id]);
            }
            const secureCookie = process.env.NODE_ENV === 'production' ? '; Secure' : '';
            res.setHeader('Set-Cookie', `${sessionCookie}=${encodeURIComponent(createSession(admin.email))}; Max-Age=28800; HttpOnly; SameSite=Lax; Path=/${secureCookie}`);
            res.json({ success: true, message: 'Вход выполнен', user: { email: admin.email } });
        } else {
            attempt.count += 1;
            loginAttempts.set(normalizedEmail, attempt);
            res.status(401).json({ error: 'Неверный email или пароль' });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/admin/session', requireAdmin, (req, res) => {
    res.json({ authenticated: true, user: { email: getSession(req).email } });
});

app.post('/api/admin/logout', (req, res) => {
    res.setHeader('Set-Cookie', `${sessionCookie}=; Max-Age=0; HttpOnly; SameSite=Lax; Path=/`);
    res.json({ success: true });
});

// ============ ПРОЕКТЫ ============

app.get('/api/projects', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM projects ORDER BY created_at DESC');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/projects/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query('SELECT * FROM projects WHERE id = $1', [id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Проект не найден' });
        }
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/projects', async (req, res) => {
    try {
        const { name, description, tech_stack, site_url, github_url } = req.body;
        const result = await pool.query(
            `INSERT INTO projects (name, description, tech_stack, site_url, github_url) 
             VALUES ($1, $2, $3, $4, $5) RETURNING *`,
            [name, description, tech_stack || [], site_url || null, github_url || null]
        );
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/projects/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { name, description, tech_stack, site_url, github_url } = req.body;
        const result = await pool.query(
            `UPDATE projects 
             SET name = $1, description = $2, tech_stack = $3, site_url = $4, github_url = $5, updated_at = CURRENT_TIMESTAMP
             WHERE id = $6 RETURNING *`,
            [name, description, tech_stack || [], site_url || null, github_url || null, id]
        );
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/projects/:id', async (req, res) => {
    try {
        const { id } = req.params;
        await pool.query('DELETE FROM projects WHERE id = $1', [id]);
        res.json({ message: 'Проект удален' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============ ПРОФИЛИ (CRM) ============

// Получить все профили
app.get('/api/profiles', async (req, res) => {
    try {
        const { role, category, status } = req.query;
        
        let query = 'SELECT * FROM profiles';
        let params = [];
        let whereClause = '';
        
        if (role && role !== '') {
            whereClause = ' WHERE role = $1';
            params.push(role);
        }
        
        if (category && category !== '') {
            if (whereClause === '') {
                whereClause = ' WHERE category = $1';
                params.push(category);
            } else {
                whereClause += ' AND category = $2';
                params.push(category);
            }
        }
        
        if (status && status !== '') {
            if (whereClause === '') {
                whereClause = ' WHERE status = $1';
                params.push(status);
            } else {
                whereClause += ' AND status = $' + (params.length + 1);
                params.push(status);
            }
        }
        
        query += whereClause + ' ORDER BY created_at DESC';
        
        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (err) {
        console.error('Ошибка в /api/profiles:', err);
        res.status(500).json({ error: err.message });
    }
});

// Получить один профиль
app.get('/api/profiles/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query('SELECT * FROM profiles WHERE id = $1', [id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Профиль не найден' });
        }
        res.json(result.rows[0]);
    } catch (err) {
        console.error('Ошибка в /api/profiles/:id:', err);
        res.status(500).json({ error: err.message });
    }
});

// Создать профиль
app.post('/api/profiles', async (req, res) => {
    try {
        const { 
            full_name, email, phone, telegram, role, category, 
            position, company, status, notes, avatar_url, 
            birth_date, city, social_links 
        } = req.body;
        
        const result = await pool.query(
            `INSERT INTO profiles (full_name, email, phone, telegram, role, category, 
             position, company, status, notes, avatar_url, birth_date, city, social_links) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING *`,
            [full_name, email, phone, telegram, role, category, 
             position, company, status || 'active', notes, avatar_url, 
             birth_date, city, social_links || '{}']
        );
        res.json(result.rows[0]);
    } catch (err) {
        console.error('Ошибка в POST /api/profiles:', err);
        res.status(500).json({ error: err.message });
    }
});

// Обновить профиль
app.put('/api/profiles/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { 
            full_name, email, phone, telegram, role, category, 
            position, company, status, notes, avatar_url, 
            birth_date, city, social_links 
        } = req.body;
        
        const result = await pool.query(
            `UPDATE profiles 
             SET full_name = $1, email = $2, phone = $3, telegram = $4, 
                 role = $5, category = $6, position = $7, company = $8, 
                 status = $9, notes = $10, avatar_url = $11, birth_date = $12, 
                 city = $13, social_links = $14, updated_at = CURRENT_TIMESTAMP
             WHERE id = $15 RETURNING *`,
            [full_name, email, phone, telegram, role, category, 
             position, company, status, notes, avatar_url, 
             birth_date, city, social_links || '{}', id]
        );
        res.json(result.rows[0]);
    } catch (err) {
        console.error('Ошибка в PUT /api/profiles/:id:', err);
        res.status(500).json({ error: err.message });
    }
});

// Удалить профиль
app.delete('/api/profiles/:id', async (req, res) => {
    try {
        const { id } = req.params;
        await pool.query('DELETE FROM profiles WHERE id = $1', [id]);
        res.json({ message: 'Профиль удален' });
    } catch (err) {
        console.error('Ошибка в DELETE /api/profiles/:id:', err);
        res.status(500).json({ error: err.message });
    }
});

// Получить статистику по профилям
app.get('/api/profiles/stats/summary', async (req, res) => {
    try {
        const stats = await pool.query(`
            SELECT 
                COUNT(*) as total,
                COUNT(CASE WHEN role = 'employee' THEN 1 END) as employees,
                COUNT(CASE WHEN role = 'client' THEN 1 END) as clients,
                COUNT(CASE WHEN role = 'partner' THEN 1 END) as partners,
                COUNT(CASE WHEN role = 'freelancer' THEN 1 END) as freelancers,
                COUNT(CASE WHEN role = 'admin' THEN 1 END) as admins,
                COUNT(CASE WHEN status = 'active' THEN 1 END) as active,
                COUNT(CASE WHEN status = 'inactive' THEN 1 END) as inactive,
                COUNT(CASE WHEN status = 'blocked' THEN 1 END) as blocked
            FROM profiles
        `);
        
        const categories = await pool.query(`
            SELECT category, COUNT(*) as count 
            FROM profiles 
            WHERE category IS NOT NULL AND category != ''
            GROUP BY category 
            ORDER BY count DESC
        `);
        
        res.json({
            stats: stats.rows[0] || { total: 0, employees: 0, clients: 0, partners: 0, freelancers: 0, admins: 0, active: 0, inactive: 0, blocked: 0 },
            categories: categories.rows || []
        });
    } catch (err) {
        console.error('Ошибка в /api/profiles/stats/summary:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============ СТАТУСЫ ПРОЕКТОВ ============

// Проверка доступности одного сайта
async function checkSiteAvailability(url) {
    if (!url) return { available: false, statusCode: null, error: 'Нет URL' };
    
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 секунд таймаут
        
        const response = await fetch(url, {
            method: 'HEAD',
            signal: controller.signal,
            headers: {
                'User-Agent': 'ZnanieSevera-Bot/1.0'
            }
        });
        
        clearTimeout(timeoutId);
        
        const isAvailable = response.ok;
        return {
            available: isAvailable,
            statusCode: response.status,
            error: null
        };
    } catch (error) {
        let errorMessage = 'Ошибка соединения';
        if (error.name === 'AbortError') {
            errorMessage = 'Таймаут (5 сек)';
        } else if (error.code === 'ENOTFOUND') {
            errorMessage = 'Домен не найден';
        } else if (error.code === 'ECONNREFUSED') {
            errorMessage = 'Сервер недоступен';
        }
        
        return {
            available: false,
            statusCode: null,
            error: errorMessage
        };
    }
}

// Проверка всех проектов
app.post('/api/projects/check-all', async (req, res) => {
    try {
        const result = await pool.query('SELECT id, name, site_url FROM projects WHERE site_url IS NOT NULL');
        const updates = [];
        
        for (const project of result.rows) {
            const check = await checkSiteAvailability(project.site_url);
            
            let status = 'offline';
            if (check.available) {
                if (check.statusCode >= 200 && check.statusCode < 300) {
                    status = 'online';
                } else if (check.statusCode >= 500) {
                    status = 'error';
                } else {
                    status = 'redirect';
                }
            }
            
            await pool.query(`
                UPDATE projects 
                SET status = $1, 
                    http_status = $2, 
                    last_checked = NOW(),
                    status_type = 'auto'
                WHERE id = $3
            `, [status, check.statusCode, project.id]);
            
            updates.push({
                id: project.id,
                name: project.name,
                status: status,
                http_status: check.statusCode,
                error: check.error
            });
        }
        
        res.json({ 
            success: true, 
            message: `Проверено ${updates.length} проектов`,
            updates: updates
        });
    } catch (err) {
        console.error('Ошибка проверки проектов:', err);
        res.status(500).json({ error: err.message });
    }
});

// Проверка одного проекта
app.post('/api/projects/:id/check', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query('SELECT id, name, site_url FROM projects WHERE id = $1', [id]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Проект не найден' });
        }
        
        const project = result.rows[0];
        const check = await checkSiteAvailability(project.site_url);
        
        let status = 'offline';
        if (check.available) {
            if (check.statusCode >= 200 && check.statusCode < 300) {
                status = 'online';
            } else if (check.statusCode >= 500) {
                status = 'error';
            } else {
                status = 'redirect';
            }
        }
        
        await pool.query(`
            UPDATE projects 
            SET status = $1, 
                http_status = $2, 
                last_checked = NOW(),
                status_type = 'auto'
            WHERE id = $3
        `, [status, check.statusCode, id]);
        
        res.json({
            success: true,
            project: {
                id: project.id,
                name: project.name,
                status: status,
                http_status: check.statusCode,
                last_checked: new Date(),
                error: check.error
            }
        });
    } catch (err) {
        console.error('Ошибка проверки проекта:', err);
        res.status(500).json({ error: err.message });
    }
});

// Обновление статуса проекта вручную
app.put('/api/projects/:id/manual-status', async (req, res) => {
    try {
        const { id } = req.params;
        const { manual_status, status } = req.body;
        
        const result = await pool.query(`
            UPDATE projects 
            SET manual_status = $1, 
                status = $2,
                status_type = 'manual',
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $3
            RETURNING *
        `, [manual_status, status, id]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Проект не найден' });
        }
        
        res.json(result.rows[0]);
    } catch (err) {
        console.error('Ошибка обновления статуса:', err);
        res.status(500).json({ error: err.message });
    }
});

// Автоматический статус (вернуться к авто-проверке)
app.post('/api/projects/:id/auto-status', async (req, res) => {
    try {
        const { id } = req.params;
        
        // Сначала проверяем доступность
        const projectResult = await pool.query('SELECT site_url FROM projects WHERE id = $1', [id]);
        if (projectResult.rows.length === 0) {
            return res.status(404).json({ error: 'Проект не найден' });
        }
        
        const check = await checkSiteAvailability(projectResult.rows[0].site_url);
        
        let status = 'offline';
        if (check.available) {
            if (check.statusCode >= 200 && check.statusCode < 300) {
                status = 'online';
            } else if (check.statusCode >= 500) {
                status = 'error';
            } else {
                status = 'redirect';
            }
        }
        
        const result = await pool.query(`
            UPDATE projects 
            SET status_type = 'auto',
                manual_status = NULL,
                status = $1,
                http_status = $2,
                last_checked = NOW()
            WHERE id = $3
            RETURNING *
        `, [status, check.statusCode, id]);
        
        res.json(result.rows[0]);
    } catch (err) {
        console.error('Ошибка авто-статуса:', err);
        res.status(500).json({ error: err.message });
    }
});

// Документы
app.get('/api/documents', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT * FROM documents WHERE is_active = true ORDER BY created_at DESC'
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/admin/documents', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM documents ORDER BY created_at DESC');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/documents/:id', async (req, res) => {
    try {
        const { id } = req.params;
        await pool.query('UPDATE documents SET view_count = view_count + 1 WHERE id = $1', [id]);
        const result = await pool.query('SELECT * FROM documents WHERE id = $1', [id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Документ не найден' });
        }
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/documents', async (req, res) => {
    try {
        const { title, category, description, file_name, icon, file_url, is_active } = req.body;
        const result = await pool.query(
            `INSERT INTO documents (title, category, description, file_name, icon, file_url, is_active)
             VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
            [
                title,
                category,
                description,
                file_name,
                icon || 'fas fa-file-pdf',
                file_url,
                is_active !== false
            ]
        );
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/documents/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { title, category, description, file_name, icon, file_url, is_active } = req.body;
        const result = await pool.query(
            `UPDATE documents
             SET title = $1, category = $2, description = $3, file_name = $4,
                 icon = $5, file_url = $6, is_active = $7, updated_at = CURRENT_TIMESTAMP
             WHERE id = $8 RETURNING *`,
            [
                title,
                category,
                description,
                file_name,
                icon || 'fas fa-file-pdf',
                file_url,
                is_active !== false,
                id
            ]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Документ не найден' });
        }
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/documents/:id', async (req, res) => {
    try {
        const { id } = req.params;
        await pool.query('DELETE FROM documents WHERE id = $1', [id]);
        res.json({ message: 'Документ удален' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/documents/:id/download', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query(
            'UPDATE documents SET download_count = download_count + 1 WHERE id = $1 RETURNING file_url',
            [id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Документ не найден' });
        }
        res.json({ file_url: result.rows[0].file_url });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ============ СТАТИЧЕСКИЕ ФАЙЛЫ ============
app.use(express.static(path.join(__dirname, '../public'), {
    maxAge: 0,
    etag: false,
    lastModified: false
}));

app.get('*', (req, res) => {
    if (req.path.startsWith('/api/')) {
        return res.status(404).json({ error: 'API endpoint not found' });
    }
    if (req.path === '/') return res.sendFile(path.join(__dirname, '../public/index.html'));
    res.status(404).sendFile(path.join(__dirname, '../public/404.html'));
});

module.exports = app;
