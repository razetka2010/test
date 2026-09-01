const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false,
        sslmode: 'require'
    }
});

async function migrate() {
    let client;
    try {
        client = await pool.connect();
        
        // Проверяем существует ли колонка image_url
        const checkColumn = await client.query(`
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'posts' AND column_name = 'image_url'
        `);
        
        if (checkColumn.rows.length === 0) {
            console.log('🔄 Добавляем колонку image_url в таблицу posts...');
            await client.query(`
                ALTER TABLE posts 
                ADD COLUMN image_url TEXT
            `);
            console.log('✅ Колонка image_url успешно добавлена!');
        } else {
            console.log('✅ Колонка image_url уже существует');
        }
        
        // Также добавляем колонку для аватара пользователя, если нужно
        const vacancyCheck = await client.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' AND table_name = 'vacancies'
        `);
        
        if (vacancyCheck.rows.length > 0) {
            const vacancyImageCheck = await client.query(`
                SELECT column_name 
                FROM information_schema.columns 
                WHERE table_name = 'vacancies' AND column_name = 'image_url'
            `);
            
            if (vacancyImageCheck.rows.length === 0) {
                console.log('🔄 Добавляем колонку image_url в таблицу vacancies...');
                await client.query(`
                    ALTER TABLE vacancies 
                    ADD COLUMN image_url TEXT
                `);
                console.log('✅ Колонка image_url в vacancies успешно добавлена!');
            }
        }
        
    } catch (err) {
        console.error('❌ Ошибка миграции:', err.message);
        process.exit(1);
    } finally {
        if (client) client.release();
        await pool.end();
    }
}

migrate();
