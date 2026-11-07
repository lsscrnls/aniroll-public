// A look kept from the last visit ({ design, css } in localStorage, written by whatever module brings that look):
// put on before the first paint, so a reload doesn't show the default design for a moment first. A classic
// script on purpose, loaded in <head>: modules run only after the page has painted. The theme goes on here too,
// for the same reason (js/store.js applyTheme does it again later).
(function () {
    var root = document.documentElement;
    try {
        var theme = localStorage.getItem('aniroll_theme');
        if (theme === 'dark' || theme === 'light') root.setAttribute('data-theme', theme);
        // Only for the app itself: the landing page (logged out) always shows the default design
        if (!localStorage.getItem('aniroll_token')) return;
        var look = JSON.parse(localStorage.getItem('aniroll_look') || 'null');
        if (!look || !/^[a-z0-9-]{1,24}$/.test(look.design) || typeof look.css !== 'string') return;
        root.setAttribute('data-design', look.design);
        var style = document.createElement('style');
        style.id = 'look-cache';
        style.textContent = look.css;
        document.head.appendChild(style);
    } catch (e) { /* storage blocked: the default design */ }
})();
