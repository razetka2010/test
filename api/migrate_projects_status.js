const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function migrateProjectsStatus() {
    const client = await pool.connect();
    try {
        // Добавляем колонки для статуса проекта
        const addColumnsQuery = `
            DO $$ 
            BEGIN
                -- Статус проекта (manual, online, offline, maintenance, completed, development)
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                    WHERE table_name = 'projects' AND column_name = 'status') THEN
                    ALTER TABLE projects ADD COLUMN status VARCHAR(50) DEFAULT 'online';
                END IF;
                
                -- Ручной статус (пользовательский текст)
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                    WHERE table_name = 'projects' AND column_name = 'manual_status') THEN
                    ALTER TABLE projects ADD COLUMN manual_status TEXT;
                END IF;
                
                -- Тип статуса (auto/manual)
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                    WHERE table_name = 'projects' AND column_name = 'status_type') THEN
                    ALTER TABLE projects ADD COLUMN status_type VARCHAR(20) DEFAULT 'auto';
                END IF;
                
                -- Последняя проверка доступности
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                    WHERE table_name = 'projects' AND column_name = 'last_checked') THEN
                    ALTER TABLE projects ADD COLUMN last_checked TIMESTAMP;
                END IF;
                
                -- HTTP статус код последней проверки
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                    WHERE table_name = 'projects' AND column_name = 'http_status') THEN
                    ALTER TABLE projects ADD COLUMN http_status INTEGER;
                END IF;
            END $$;
        `;
        
        await client.query(addColumnsQuery);
        console.log('✅ Таблица projects обновлена: добавлены поля для статусов');
        
        // Обновляем существующие проекты
        await client.query(`
            UPDATE projects 
            SET status = 'online', status_type = 'auto', last_checked = NOW()
            WHERE status IS NULL
        `);
        
        console.log('✅ Существующие проекты обновлены');
        
    } catch (err) {
        console.error('❌ Ошибка миграции:', err);
    } finally {
        client.release();
        await pool.end();
    }
}

migrateProjectsStatus();