// config.js - Конфигурация для всех страниц
const API_BASE_URL = '/api';

window.API_BASE_URL = API_BASE_URL;

// Функция для проверки maintenance mode
async function checkMaintenanceMode() {
    if (window.location.pathname.includes('admin.html') || 
        window.location.pathname.includes('maintenance.html')) {
        return;
    }
    
    try {
        const response = await fetch(`${API_BASE_URL}/maintenance-status`, { cache: 'no-store' });
        if (!response.ok) return;
        
        const settings = await response.json();
        
        if (!settings.maintenance_mode) return;
        
        let blockedPages = [];
        if (settings.maintenance_pages && settings.maintenance_pages.trim()) {
            blockedPages = settings.maintenance_pages.split(',').map(p => p.trim().toLowerCase());
        }
        
        let currentPage = window.location.pathname.replace('/', '').replace('.html', '').toLowerCase();
        if (currentPage === '' || currentPage === '/') currentPage = 'index';
        
        const shouldBlock = blockedPages.length === 0 || blockedPages.includes(currentPage);
        
        if (shouldBlock) {
            sessionStorage.setItem('redirectAfterMaintenance', window.location.href);
            window.location.replace('/maintenance.html');
        }
    } catch (error) {
        console.error('Ошибка проверки maintenance mode:', error);
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', checkMaintenanceMode);
} else {
    checkMaintenanceMode();
}

window.addEventListener('pageshow', checkMaintenanceMode);

console.log('✅ API URL:', API_BASE_URL);