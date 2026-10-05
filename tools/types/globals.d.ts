// What the app hangs on window for itself
interface Window {
    [key: `__aniroll${string}`]: any;
}

// Loaded by index.html as plain scripts (js/vendor), used as globals
declare const gsap: any;
declare const ScrollTrigger: any;
declare const Lenis: any;
