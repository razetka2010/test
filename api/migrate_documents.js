const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false,
        sslmode: 'require'
    }
});

async function migrateDocuments() {
    let client;
    try {
        client = await pool.connect();

        console.log('🔄 Создаём таблицу documents...');
        await client.query(`
            CREATE TABLE IF NOT EXISTS documents (
                id SERIAL PRIMARY KEY,
                title VARCHAR(255) NOT NULL,
                category VARCHAR(50) NOT NULL,
                description TEXT NOT NULL,
                file_name VARCHAR(255) NOT NULL,
                icon VARCHAR(50) DEFAULT 'fas fa-file-pdf',
                file_url TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                is_active BOOLEAN DEFAULT true,
                view_count INTEGER DEFAULT 0,
                download_count INTEGER DEFAULT 0
            )
        `);

        await client.query('CREATE INDEX IF NOT EXISTS idx_documents_category ON documents(category)');
        await client.query('CREATE INDEX IF NOT EXISTS idx_documents_is_active ON documents(is_active)');
        await client.query('CREATE INDEX IF NOT EXISTS idx_documents_created_at ON documents(created_at DESC)');
        await client.query('CREATE INDEX IF NOT EXISTS idx_documents_title ON documents(title)');

        console.log('✅ Миграция documents завершена (без тестовых данных)');
    } catch (err) {
        console.error('❌ Ошибка миграции documents:', err.message);
        process.exit(1);
    } finally {
        if (client) client.release();
        await pool.end();
    }
}

migrateDocuments();
