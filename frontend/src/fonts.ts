/*
 * The web fonts, imported as modules rather than from index.css.
 *
 * Tailwind's PostCSS plugin inlines a CSS `@import` without rebasing the
 * `url(./files/...)` inside it, so the production stylesheet asked for
 * /assets/files/karla-latin-400-normal.woff2 — a file Vite never emitted —
 * and every page fell back to a system font with a console full of 404s.
 * Imported here, each fontsource stylesheet goes through Vite's own CSS
 * pipeline, which resolves those urls and emits the font files beside it.
 *
 * The matrimony home template's pair: Karla carries the text, Cormorant
 * Garamond the titles. Only the weights the template sets are loaded.
 */
import '@fontsource-variable/geist-mono';
import '@fontsource/karla/300.css';
import '@fontsource/karla/400.css';
import '@fontsource/karla/500.css';
import '@fontsource/karla/600.css';
import '@fontsource/cormorant-garamond/300.css';
import '@fontsource/cormorant-garamond/400.css';
import '@fontsource/cormorant-garamond/500.css';
import '@fontsource/cormorant-garamond/400-italic.css';
