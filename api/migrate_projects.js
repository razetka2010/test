const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function createProjectsTable() {
    const client = await pool.connect();
    try {
        // Создаём таблицу проектов
        const createTableQuery = `
            CREATE TABLE IF NOT EXISTS projects (
                id SERIAL PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                description TEXT,
                tech_stack TEXT[] DEFAULT '{}',
                site_url VARCHAR(500),
                github_url VARCHAR(500),
                image_url VARCHAR(500),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `;
        
        await client.query(createTableQuery);
        console.log('✅ Таблица projects успешно создана или уже существует');
        
        // Проверяем, есть ли тестовые данные
        const checkData = await client.query('SELECT COUNT(*) FROM projects');
        
        if (parseInt(checkData.rows[0].count) === 0) {
            // Добавляем тестовый проект для примера
            await client.query(`
                INSERT INTO projects (name, description, tech_stack, site_url, github_url, image_url)
                VALUES (
                    'Знание Севера',
                    'Корпоративный сайт компании Знание Севера',
                    ARRAY['HTML5', 'CSS3', 'JavaScript', 'Node.js', 'Express', 'PostgreSQL'],
                    'https://znaniesevera.vercel.app',
                    'https://github.com/razetka2010/znanie-severa',
                    NULL
                )
            `);
            console.log('📝 Добавлен тестовый проект');
        }
        
    } catch (err) {
        console.error('❌ Ошибка создания таблицы projects:', err);
    } finally {
        client.release();
        await pool.end();
    }
}

createProjectsTable();