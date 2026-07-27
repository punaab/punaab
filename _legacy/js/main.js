const LANGS = ['en', 'es', 'zh', 'ja'];
const LANG_LABELS = { en: 'EN', es: 'ES', zh: 'ZH', ja: 'JA' };

const AppState = {
    currentLang: 'en',
    currentSection: 'home',
    isMenuOpen: false,
    isLoaded: false
};

document.addEventListener('DOMContentLoaded', () => {
    initializeApp();
});

function initializeApp() {
    // Dark mode only
    document.body.setAttribute('data-theme', 'dark');
    localStorage.removeItem('portfolio-theme');

    loadPreferences();
    // Migrate old Arabic preference
    if (AppState.currentLang === 'ar' || !LANGS.includes(AppState.currentLang)) {
        AppState.currentLang = 'en';
        localStorage.setItem('portfolio-lang', 'en');
    }

    initLanguage();
    initNavigation();
    initScrollEffects();
    initFormHandlers();
    initMobileMenu();
    initRandomPunaab();
    updateLanguageUI();
    AppState.isLoaded = true;
}

function initRandomPunaab() {
    const profilePhoto = document.querySelector('.profile-photo');
    const profileFrame = document.querySelector('.profile-image-frame');
    const brandMark = document.querySelector('.brand-mark');
    const winkBuddy = document.getElementById('winkBuddy');

    // Home circle always uses the classic logo (wink stays on loader / buddy only)
    if (profilePhoto) {
        profilePhoto.src = 'assets/punaab-logo.png';
        profilePhoto.alt = 'Punaab logo';
    }
    if (profileFrame) profileFrame.classList.remove('wink-mode');
    if (brandMark) brandMark.src = 'assets/punaab-logo.png';

    if (!winkBuddy) return;

    // Peek-in buddy after a random delay, then hide again
    const showDelay = 4000 + Math.random() * 8000;
    const hideAfter = 4500 + Math.random() * 3500;

    setTimeout(() => {
        winkBuddy.classList.add('visible');
        setTimeout(() => winkBuddy.classList.remove('visible'), hideAfter);
    }, showDelay);

    winkBuddy.addEventListener('click', () => {
        winkBuddy.classList.remove('visible');
    });
}

function loadPreferences() {
    const savedLang = localStorage.getItem('portfolio-lang');
    if (savedLang) AppState.currentLang = savedLang;
}

function initLanguage() {
    const langToggle = document.getElementById('langToggle');
    if (langToggle) {
        langToggle.addEventListener('click', toggleLanguage);
    }
    setLanguage(AppState.currentLang);
}

function toggleLanguage() {
    const idx = LANGS.indexOf(AppState.currentLang);
    const newLang = LANGS[(idx + 1) % LANGS.length];
    setLanguage(newLang);
    localStorage.setItem('portfolio-lang', newLang);
}

function setLanguage(lang) {
    if (!LANGS.includes(lang)) lang = 'en';
    AppState.currentLang = lang;
    const html = document.documentElement;
    const body = document.body;

    html.setAttribute('lang', lang);
    html.setAttribute('dir', 'ltr');
    body.setAttribute('data-lang', lang);
    body.setAttribute('data-dir', 'ltr');
    body.setAttribute('data-theme', 'dark');
    updateLanguageUI();
}

function updateLanguageUI() {
    const lang = AppState.currentLang;

    document.querySelectorAll('[data-text-en]').forEach((element) => {
        const text =
            element.getAttribute(`data-text-${lang}`) ||
            element.getAttribute('data-text-en');
        if (text) element.textContent = text;
    });

    document.querySelectorAll('[data-placeholder-en]').forEach((element) => {
        const placeholder =
            element.getAttribute(`data-placeholder-${lang}`) ||
            element.getAttribute('data-placeholder-en');
        if (placeholder) element.setAttribute('placeholder', placeholder);
    });

    const langToggle = document.getElementById('langToggle');
    if (langToggle) {
        const langText = langToggle.querySelector('.lang-text');
        if (langText) {
            langText.textContent = LANG_LABELS[lang] || 'EN';
        }
        langToggle.setAttribute('aria-label', `Language: ${LANG_LABELS[lang]}`);
        langToggle.title = `Language: ${LANG_LABELS[lang]} (click to change)`;
    }
}

function initNavigation() {
    const navLinks = document.querySelectorAll('.nav-link[href^="#"]');
    navLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const targetId = link.getAttribute('href');
            const targetSection = document.querySelector(targetId);
            
            if (targetSection) {
                const headerHeight = document.querySelector('.main-header').offsetHeight;
                const targetPosition = targetSection.offsetTop - headerHeight;
                
                window.scrollTo({
                    top: targetPosition,
                    behavior: 'smooth'
                });
                
                updateActiveNavLink(link);
                if (AppState.isMenuOpen) {
                    toggleMobileMenu();
                }
            }
        });
    });
    
    window.addEventListener('scroll', handleScroll);
    window.addEventListener('scroll', updateHeaderOnScroll);
}

function handleScroll() {
    const sections = document.querySelectorAll('section[id]');
    const scrollPosition = window.scrollY + 100;
    
    sections.forEach(section => {
        const sectionTop = section.offsetTop;
        const sectionHeight = section.offsetHeight;
        const sectionId = section.getAttribute('id');
        
        if (scrollPosition >= sectionTop && scrollPosition < sectionTop + sectionHeight) {
            AppState.currentSection = sectionId;
            updateActiveNavLink(null, sectionId);
        }
    });
}

function updateActiveNavLink(clickedLink, sectionId = null) {
    const navLinks = document.querySelectorAll('.nav-link');
    navLinks.forEach(link => {
        link.classList.remove('active');
        if (clickedLink && link === clickedLink) {
            link.classList.add('active');
        } else if (sectionId) {
            const linkSection = link.getAttribute('data-section');
            if (linkSection === sectionId) {
                link.classList.add('active');
            }
        }
    });
}

function updateHeaderOnScroll() {
    const header = document.querySelector('.main-header');
    if (window.scrollY > 50) {
        header.classList.add('scrolled');
    } else {
        header.classList.remove('scrolled');
    }
}

function initScrollEffects() {
    const observerOptions = {
        threshold: 0.1,
        rootMargin: '0px 0px -100px 0px'
    };
    
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('visible');
                observer.unobserve(entry.target);
            }
        });
    }, observerOptions);
    
    const fadeElements = document.querySelectorAll('.fade-in');
    fadeElements.forEach(element => observer.observe(element));
    
    const sections = document.querySelectorAll('.section');
    sections.forEach(section => observer.observe(section));
}

function initFormHandlers() {
    const contactForm = document.getElementById('contactForm');
    if (contactForm) {
        contactForm.addEventListener('submit', handleFormSubmit);
    }
}

function handleFormSubmit(e) {
    e.preventDefault();
    const formData = new FormData(e.target);
    const data = Object.fromEntries(formData);
    console.log('Form submitted:', data);
    
    const messages = {
        en: 'Message sent successfully!',
        es: '¡Mensaje enviado con éxito!',
        zh: '消息发送成功！',
        ja: 'メッセージを送信しました！'
    };
    alert(messages[AppState.currentLang] || messages.en);
    e.target.reset();
}

function initMobileMenu() {
    const menuToggle = document.getElementById('menuToggle');
    if (menuToggle) {
        menuToggle.addEventListener('click', toggleMobileMenu);
    }
    
    document.addEventListener('click', (e) => {
        const navMenu = document.getElementById('navMenu');
        const menuToggle = document.getElementById('menuToggle');
        
        if (AppState.isMenuOpen && 
            !navMenu.contains(e.target) && 
            !menuToggle.contains(e.target)) {
            toggleMobileMenu();
        }
    });
}

function toggleMobileMenu() {
    AppState.isMenuOpen = !AppState.isMenuOpen;
    const navMenu = document.getElementById('navMenu');
    const menuToggle = document.getElementById('menuToggle');
    
    if (navMenu) {
        navMenu.classList.toggle('active', AppState.isMenuOpen);
    }
    
    if (menuToggle) {
        menuToggle.classList.toggle('active', AppState.isMenuOpen);
    }
}

function generateParticles() {
    const particlesContainer = document.getElementById('particles');
    if (!particlesContainer) return;
    
    const codeSymbols = ['{', '}', '[', ']', '(', ')', '<', '>', '/', '*', '=', '+', '-', ';', ':', '&', '|', '%', '$', '#', '@'];
    const particleCount = 20;
    
    for (let i = 0; i < particleCount; i++) {
        const particle = document.createElement('div');
        particle.className = 'particle';
        particle.textContent = codeSymbols[Math.floor(Math.random() * codeSymbols.length)];
        particle.style.left = Math.random() * 100 + '%';
        particle.style.animationDelay = Math.random() * 15 + 's';
        particle.style.animationDuration = (10 + Math.random() * 10) + 's';
        particlesContainer.appendChild(particle);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    generateParticles();
});

