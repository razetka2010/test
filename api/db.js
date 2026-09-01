const { Pool } = require('pg');
require('dotenv').config();

// Создаем пул соединений
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false, // Для Neon обязательно
        sslmode: 'require'
    },
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 30000,
    max: 20
});

// Функция для проверки подключения
async function testConnection() {
    let client;
    try {
        client = await pool.connect();
        const result = await client.query('SELECT NOW() as time');
        console.log('✅ База данных подключена успешно');
        console.log('🕐 Время на сервере БД:', result.rows[0].time);
        
        const tables = await client.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public'
            ORDER BY table_name
        `);
        
        if (tables.rows.length > 0) {
            console.log('📋 Таблицы в БД:', tables.rows.map(t => t.table_name).join(', '));
        } else {
            console.warn('⚠️ В базе данных нет таблиц! Выполните SQL скрипт.');
        }
        
        return true;
    } catch (err) {
        console.error('❌ Ошибка подключения к базе данных:', err.message);
        return false;
    } finally {
        if (client) client.release();
    }
}

testConnection();

pool.on('error', (err) => {
    console.error('❌ Неожиданная ошибка пула соединений:', err);
});

module.exports = pool;