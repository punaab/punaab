document.addEventListener('DOMContentLoaded', () => {
    const menuToggle = document.getElementById('menuToggle');
    const navMenu = document.getElementById('navMenu');
    const portrait = document.getElementById('meetPortrait');
    const cards = document.querySelectorAll('.meet-form-card');

    const forms = {
        hoodie: {
            src: 'assets/punaab-hoodie.png?v=2',
            alt: 'Punaab in a hoodie'
        },
        classic: {
            src: 'assets/punaab-logo.png',
            alt: 'Classic Punaab logo'
        },
        wink: {
            src: 'assets/punaab-wink.png?v=2',
            alt: 'Punaab wink'
        }
    };

    if (menuToggle && navMenu) {
        menuToggle.addEventListener('click', () => {
            const open = navMenu.classList.toggle('active');
            menuToggle.classList.toggle('active', open);
        });
    }

    cards.forEach((card) => {
        card.addEventListener('click', () => {
            const key = card.getAttribute('data-form');
            const form = forms[key];
            if (!form || !portrait) return;

            cards.forEach((c) => c.classList.remove('is-active'));
            card.classList.add('is-active');

            portrait.classList.add('is-swapping');
            setTimeout(() => {
                portrait.src = form.src;
                portrait.alt = form.alt;
                portrait.classList.remove('is-swapping');
            }, 180);
        });
    });
});
