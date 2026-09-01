// Mobile Menu Toggle
const mobileMenuBtn = document.getElementById('mobileMenuBtn');
const navMenu = document.getElementById('navMenu');
let isMenuOpen = false;

if (mobileMenuBtn && navMenu) {
    mobileMenuBtn.addEventListener('click', () => {
        isMenuOpen = !isMenuOpen;
        navMenu.classList.toggle('active', isMenuOpen);
        navMenu.classList.toggle('open', isMenuOpen);
        mobileMenuBtn.setAttribute('aria-expanded', String(isMenuOpen));
        
        const icon = mobileMenuBtn.querySelector('i');
        if (isMenuOpen) {
            icon.classList.remove('fa-bars');
            icon.classList.add('fa-times');
        } else {
            icon.classList.remove('fa-times');
            icon.classList.add('fa-bars');
        }
    });
}

if (mobileMenuBtn) {
    mobileMenuBtn.setAttribute('aria-label', 'Открыть меню');
    mobileMenuBtn.setAttribute('aria-expanded', 'false');
}

// Close mobile menu when clicking on a link
const navLinks = document.querySelectorAll('.nav-link');
navLinks.forEach(link => {
    link.addEventListener('click', () => {
        if (navMenu && navMenu.classList.contains('active')) {
            navMenu.classList.remove('active');
            navMenu.classList.remove('open');
            isMenuOpen = false;
            if (mobileMenuBtn) mobileMenuBtn.setAttribute('aria-expanded', 'false');
            const icon = mobileMenuBtn.querySelector('i');
            icon.classList.remove('fa-times');
            icon.classList.add('fa-bars');
        }
    });
});

// Header scroll effect
const header = document.querySelector('.header');
if (header) {
    window.addEventListener('scroll', () => {
        if (window.pageYOffset > 50) {
            header.classList.add('scrolled');
        } else {
            header.classList.remove('scrolled');
        }
    });
}

const backToTop = document.createElement('button');
backToTop.type = 'button';
backToTop.className = 'back-to-top';
backToTop.setAttribute('aria-label', 'Вернуться наверх');
backToTop.innerHTML = '<i class="fas fa-arrow-up" aria-hidden="true"></i>';
document.body.appendChild(backToTop);

window.addEventListener('scroll', () => {
    backToTop.classList.toggle('visible', window.scrollY > 500);
});

backToTop.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
});

// Smooth scrolling for anchor links
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
        e.preventDefault();
        const targetId = this.getAttribute('href');
        
        if (targetId === '#') return;
        
        const targetElement = document.querySelector(targetId);
        if (targetElement) {
            const headerOffset = 70;
            const elementPosition = targetElement.getBoundingClientRect().top;
            const offsetPosition = elementPosition + window.pageYOffset - headerOffset;
            
            window.scrollTo({
                top: offsetPosition,
                behavior: 'smooth'
            });
        }
    });
});

// Intersection Observer for animations
const observerOptions = {
    threshold: 0.1,
    rootMargin: '0px 0px -50px 0px'
};

const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            entry.target.style.opacity = '1';
            entry.target.style.transform = 'translateY(0)';
            observer.unobserve(entry.target);
        }
    });
}, observerOptions);

// Animate elements on scroll
document.querySelectorAll('.service-card, .feature-item, .contact-card, .stat-card, .portfolio-card, .testimonial-card').forEach(el => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(30px)';
    el.style.transition = 'opacity 0.6s ease, transform 0.6s ease';
    observer.observe(el);
});

// FAQ Accordion
document.querySelectorAll('.faq-question').forEach(question => {
    question.addEventListener('click', () => {
        const faqItem = question.parentElement;
        faqItem.classList.toggle('active');
    });
});

// ============= DOCUMENTS SECTION =============

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function normalizeDocument(doc) {
    return {
        id: doc.id,
        title: doc.title,
        category: doc.category,
        description: doc.description,
        fileName: doc.file_name || doc.fileName,
        icon: doc.icon || 'fas fa-file-pdf',
        date: doc.created_at || doc.date,
        downloadUrl: doc.file_url || doc.downloadUrl
    };
}

async function trackDocumentDownload(id) {
    try {
        await fetch(`${window.API_BASE_URL || '/api'}/documents/${id}/download`, { method: 'POST' });
    } catch (error) {
        console.error('Ошибка учёта скачивания:', error);
    }
}

function getCategoryName(category) {
    const categoryMap = {
        'tech-spec': 'Техническое задание',
        'methodology': 'Методические материалы',
        'guides': 'Инструкция',
        'report': 'Отчёт',
        'presentation': 'Презентация',
        'certificate': 'Сертификат',
        'manual': 'Руководство пользователя',
        'template': 'Шаблон',
        'standard': 'Стандарт / Регламент',
        'order': 'Приказ',
        'protocol': 'Протокол',
        'other': 'Другое'
    };
    return categoryMap[category] || category;
}

function displayDocuments(documents) {
    const documentsList = document.getElementById('documentsList');
    const noResults = document.getElementById('noResults');
    const resultsCount = document.getElementById('resultsCount');
    
    if (!documentsList) return;
    
    if (documentsList.querySelector('.doc-loading')) {
        documentsList.innerHTML = '';
    }
    
    if (documents.length === 0) {
        documentsList.style.display = 'none';
        if (noResults) noResults.style.display = 'flex';
        if (resultsCount) resultsCount.textContent = 'Документы не найдены';
        return;
    }
    
    if (noResults) noResults.style.display = 'none';
    documentsList.style.display = 'flex';
    
    if (resultsCount) {
        const word = documents.length === 1 ? 'документ' : 'документов';
        resultsCount.textContent = `Найдено ${documents.length} ${word}`;
    }
    
    const sortedDocuments = [...documents].sort((first, second) => {
        const sortMode = window.documentSort || 'newest';
        if (sortMode === 'title') return String(first.title || '').localeCompare(String(second.title || ''), 'ru');
        const firstDate = new Date(first.date || 0).getTime();
        const secondDate = new Date(second.date || 0).getTime();
        return sortMode === 'oldest' ? firstDate - secondDate : secondDate - firstDate;
    });

    documentsList.innerHTML = sortedDocuments.map(doc => {
        const categoryName = getCategoryName(doc.category);
        const formattedDate = doc.date
            ? new Date(doc.date).toLocaleDateString('ru-RU', {
                year: 'numeric',
                month: 'long',
                day: 'numeric'
            })
            : '';
        
        return `
            <div class="doc-card" data-category="${escapeHtml(doc.category)}" data-title="${escapeHtml(doc.title.toLowerCase())}">
                <div class="doc-card-icon">
                    <i class="${escapeHtml(doc.icon)}"></i>
                </div>
                <div class="doc-card-body">
                    <h3 class="doc-card-title">${escapeHtml(doc.title)}</h3>
                    <p class="doc-card-desc">${escapeHtml(doc.description)}</p>
                    <div class="doc-card-footer">
                        <div>
                            <span class="doc-card-tag">${escapeHtml(categoryName)}</span>
                            ${formattedDate ? `<span class="doc-card-date">${escapeHtml(formattedDate)}</span>` : ''}
                        </div>
                        <div class="doc-card-actions">
                            <a href="${escapeHtml(doc.downloadUrl)}" download="${escapeHtml(doc.fileName)}" class="doc-card-btn doc-card-btn-primary" title="Скачать документ" onclick="trackDocumentDownload(${doc.id})">
                                <i class="fas fa-download"></i> Скачать
                            </a>
                            <a href="${escapeHtml(doc.downloadUrl)}" target="_blank" rel="noopener noreferrer" class="doc-card-btn doc-card-btn-secondary" title="Открыть в новой вкладке">
                                <i class="fas fa-external-link-alt"></i>
                            </a>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

function setupDocumentFilters() {
    const catBtns = document.querySelectorAll('.doc-cat-btn');
    const documents = window.allDocuments || [];
    window.documentCategory = 'all';
    
    catBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            catBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            
            const category = btn.dataset.category;
            window.documentCategory = category;
            const searchTerm = document.getElementById('searchInput')?.value.toLowerCase() || '';
            const filtered = documents.filter(doc =>
                (category === 'all' || doc.category === category) &&
                (`${doc.title || ''} ${doc.description || ''}`).toLowerCase().includes(searchTerm)
            );
            
            displayDocuments(filtered);
        });
    });
}

function setupDocumentSearch() {
    const searchInput = document.getElementById('searchInput');
    const documents = window.allDocuments || [];
    
    if (!searchInput) return;
    
    searchInput.addEventListener('input', (e) => {
        const searchTerm = e.target.value.toLowerCase();
        
        const filtered = documents.filter(doc =>
            (window.documentCategory === 'all' || doc.category === window.documentCategory) &&
            (`${doc.title || ''} ${doc.description || ''}`).toLowerCase().includes(searchTerm)
        );
        
        displayDocuments(filtered);
    });
}

const documentSort = document.getElementById('documentSort');
if (documentSort) {
    window.documentSort = documentSort.value;
    documentSort.addEventListener('change', event => {
        window.documentSort = event.target.value;
        const searchTerm = document.getElementById('searchInput')?.value.toLowerCase() || '';
        const category = window.documentCategory || 'all';
        const filtered = (window.allDocuments || []).filter(doc =>
            (category === 'all' || doc.category === category) &&
            (`${doc.title || ''} ${doc.description || ''}`).toLowerCase().includes(searchTerm)
        );
        displayDocuments(filtered);
    });
}

// Load and display documents
async function loadDocuments() {
    const documentsList = document.getElementById('documentsList');
    const noResults = document.getElementById('noResults');
    
    if (!documentsList) return;
    
    try {
        const response = await fetch(`${window.API_BASE_URL || '/api'}/documents`);
        if (!response.ok) throw new Error('Не удалось загрузить документы');
        
        const data = await response.json();
        const documents = (Array.isArray(data) ? data : []).map(normalizeDocument);
        
        window.allDocuments = documents;
        
        displayDocuments(documents);
        setupDocumentFilters();
        setupDocumentSearch();
        
    } catch (error) {
        console.error('Error loading documents:', error);
        documentsList.innerHTML = `
            <div class="doc-no-results" style="display:flex;">
                <i class="fas fa-exclamation-circle"></i>
                <h3>Ошибка при загрузке документов</h3>
                <p>${escapeHtml(error.message)}</p>
                <p style="margin-top: 8px; font-size: 0.9rem;">Убедитесь, что сервер запущен и выполнена миграция: <code>npm run migrate:documents</code></p>
            </div>
        `;
    }
}

// Load documents when page loads
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadDocuments);
} else {
    loadDocuments();
}

// Testimonials slider for mobile
let currentSlide = 0;
const testimonials = document.querySelectorAll('.testimonial-card');
const prevBtn = document.querySelector('.prev-btn');
const nextBtn = document.querySelector('.next-btn');

if (prevBtn && nextBtn && window.innerWidth <= 768 && testimonials.length > 0) {
    function showSlide(index) {
        testimonials.forEach((card, i) => {
            card.style.display = i === index ? 'block' : 'none';
        });
    }
    
    showSlide(0);
    
    prevBtn.addEventListener('click', () => {
        currentSlide = (currentSlide - 1 + testimonials.length) % testimonials.length;
        showSlide(currentSlide);
    });
    
    nextBtn.addEventListener('click', () => {
        currentSlide = (currentSlide + 1) % testimonials.length;
        showSlide(currentSlide);
    });
} else if (prevBtn && nextBtn) {
    prevBtn.style.display = 'none';
    nextBtn.style.display = 'none';
}

// Dynamic year in footer
const footerYear = document.querySelector('.footer-bottom p');
if (footerYear) {
    const currentYear = new Date().getFullYear();
    footerYear.innerHTML = `&copy; ${currentYear} Корпорация «Знание Севера». Все права защищены.`;
}

// Copy to clipboard functionality
const contactLinks = document.querySelectorAll('.contact-link');
contactLinks.forEach(link => {
    link.addEventListener('click', async (e) => {
        if (link.href.startsWith('tel:')) return;
        
        e.preventDefault();
        const textToCopy = link.textContent;
        
        try {
            await navigator.clipboard.writeText(textToCopy);
            const originalText = link.textContent;
            link.textContent = 'Скопировано!';
            setTimeout(() => {
                link.textContent = originalText;
            }, 2000);
        } catch (err) {
            console.error('Не удалось скопировать:', err);
        }
    });
});

// Prevent scrolling when mobile menu is open
document.body.addEventListener('touchmove', (e) => {
    if (navMenu && navMenu.classList.contains('active')) {
        e.preventDefault();
    }
}, { passive: false });